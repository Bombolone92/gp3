/**
 * Cap table math - pure functions over plain data, no I/O.
 *
 * The working set is a `db` snapshot: { company, classes, stakeholders,
 * securities }. Securities are one array with a `kind` discriminator (every
 * kind may also carry attachments: [{ id, name, path, size, addedAt }] -
 * file references the math never touches):
 *
 *   shares  { id, kind, label, stakeholderId, classId, quantity, pricePerShare,
 *             date, vestingMonths?, cliffMonths?, vestingStart?,
 *             vestingBase? (the position the schedule is measured against,
 *             when a repurchase took shares out of its unvested tail),
 *             vestingOffset? (earlier installments allocated to other
 *             exercise certificates, subtracted from the schedule base),
 *             vestingFrequency?: 'quarterly' | 'annual',
 *             vestingTranches?: [{ date, quantity }],
 *             accelTrigger?: 'single' | 'double', accelPct?, filed83b?,
 *             date83b? (the original purchase date a transfer remainder's
 *             83(b) window ran from), closedAt?,
 *             closedReason?: 'transfer' | 'repurchase',
 *             repurchasedQty?, repurchasePricePerShare? (the terms a company
 *             repurchase closed on - it issues no buyer certificate to hold
 *             them), fromTransferId?, transferPricePerShare? }
 *   option  { id, kind, label, stakeholderId, planId? | outsidePlan?,
 *             quantity, strike, grantDate, vestingStart?,
 *             vestingMonths, cliffMonths, exercised, cancelled?,
 *             cancelledDate? (the first forfeiture), vestingStoppedAt?,
 *             cancellations?: [{ quantity, date }] (only once there is more
 *             than one), expires?, exerciseBy?, optionType?: 'iso',
 *             earlyExercise?, vestingFrequency?, vestingTranches?,
 *             accelTrigger?, accelPct? }
 *   rsu     { id, kind, label, stakeholderId, planId? | outsidePlan?,
 *             classId (the class it settles
 *             into), quantity, grantDate, vestingStart?, vestingMonths, cliffMonths,
 *             settled, cancelled?, cancelledDate?, cancellations?,
 *             vestingFrequency?,
 *             vestingTranches?, accelTrigger?, accelPct?,
 *             liquidityCondition? (settles only on a liquidity event) }
 *   warrant { id, kind, label, stakeholderId, classId, quantity, strike, date,
 *             expires, cancelled?, cancelledDate?, cancellations? }
 *   safe    { id, kind, label, stakeholderId, principal, valuationCap, discount,
 *             safeType: 'pre' | 'post', date }
 *   note    { id, kind, label, stakeholderId, principal, valuationCap, discount,
 *             interestRate, date, maturityDate? }
 *
 * Conventions (documented here, encoded in tests):
 *  - "Outstanding" counts issued share certificates only.
 *  - "Fully diluted" adds option grants, unsettled RSUs and warrants and, when
 *    asked, the unallocated pool. Warrants never touch the employee option
 *    pool: they come from accelerators, venture debt, and advisor deals, not
 *    the plan. RSUs do draw it - they are plan awards like options.
 *  - SAFEs and notes are excluded from both until a priced round converts
 *    them (their share count is undetermined before that) - they appear in
 *    the convertibles section and in round modeling.
 *  - Option exercise is tracked on the grant (`exercised`). Exercised shares
 *    stay inside the grant's quantity until a certificate is actually issued
 *    for them (`shares.fromOptionId`), at which point the certificate carries
 *    them instead - so outstanding vs diluted never double-counts either way.
 *  - Cancelled options leave both the diluted base and the pool draw: those
 *    shares are back on the shelf for the next hire. A plan award draws the
 *    reserve of the plan it names (`planId`), and one marked `outsidePlan`
 *    draws none; what a forfeiture, exercise, repurchase or transfer hands
 *    back is the plan's recycling rule to say - see the plans section.
 *  - RSU settlement works the way exercise does: units stay inside the award's
 *    quantity until a certificate is issued for them (`shares.fromRsuId`),
 *    which is what keeps outstanding and diluted from double-counting. An RSU
 *    has no strike, so nothing is paid to settle one.
 */

import { monthsBetween, accrualYears, addMonthsISO, addDaysISO, daysBetween, nextBusinessDay, tidy, todayISO } from './util.js';
import { validateFinancing, validateProRata, electedDb, termDate, FinancingError } from './financing.js';
import { negotiatedWaterfall } from './financing-waterfall.js';

export const STAKEHOLDER_KINDS = [
  { value: 'founder', label: 'Founder', icon: 'crown' },
  { value: 'investor', label: 'Investor', icon: 'landmark' },
  { value: 'employee', label: 'Employee', icon: 'briefcase' },
  { value: 'advisor', label: 'Advisor', icon: 'compass' },
  { value: 'entity', label: 'Company / fund', icon: 'building' },
];

export function stakeholderKindInfo(kind) {
  return STAKEHOLDER_KINDS.find((k) => k.value === kind) || STAKEHOLDER_KINDS[2];
}

/* ---------- Vesting ---------- */

/** Months between vesting steps. Absent or unknown means monthly. */
const VESTING_INTERVAL_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };

export const VESTING_FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
];

/** The custom tranche list on a security, or null when it vests by months. */
export function vestingTranches(security) {
  const list = security?.vestingTranches;
  return Array.isArray(list) && list.length ? list : null;
}

/**
 * The position a schedule is measured against, which is not always what the
 * security holds. A repurchase out of the unvested tail leaves the whole
 * schedule behind on a smaller certificate - a 900-share remainder still
 * earning against the 1,000 it was written for, with the shares the company
 * bought back simply never arriving. `vestingBase` records that for a
 * time-based schedule; a tranche list records it in the tranches themselves.
 */
export function vestingPosition(security) {
  const qty = Math.max(0, Math.round(Number(security?.quantity) || 0));
  const tranches = vestingTranches(security);
  if (tranches) {
    return Math.max(qty, tranches.reduce(
      (a, t) => a + Math.max(0, Math.round(Number(t?.quantity) || 0)), 0));
  }
  return Math.max(qty, Math.round(Number(security?.vestingBase) || 0));
}

/** Preserve a certificate's existing repurchase tail, without letting an
 * ordinary award's old quantity authorize an oversized replacement schedule. */
export function vestingScheduleLimit(existing, quantity) {
  const written = vestingPosition(existing);
  return existing?.kind === 'shares' && written > existing.quantity
    ? Math.max(quantity, written)
    : quantity;
}

/** Whether a security carries a vesting schedule at all. */
export function hasVesting(security) {
  return Math.round(Number(security?.vestingMonths) || 0) > 0 || !!vestingTranches(security);
}

/**
 * The schedule’s service clock: an explicit `vestingStart`, otherwise the
 * grant date or share issue date. The grant/issue date itself is unchanged.
 */
export function vestingStartDate(security) {
  return security.vestingStart || security.grantDate || security.date || '';
}

/**
 * Shares vested on a certificate or grant as of an ISO date.
 *
 * Three schedule shapes, in order of precedence:
 *  - Custom tranches (`vestingTranches`): each dated tranche vests on its day.
 *  - Time-based (`vestingMonths`): nothing before the cliff month, then
 *    straight-line by vesting step - monthly unless `vestingFrequency` says
 *    quarterly or annual - everything at/after the final month. A cliff that
 *    falls between steps still vests its full catch-up on the cliff day.
 *    `vestingBase` measures that straight line against a larger position than
 *    the certificate now holds, clamped to what it holds - which is what a
 *    repurchase out of the unvested tail leaves behind.
 *  - No schedule → fully vested, which is what every certificate without one
 *    means.
 *
 * Partial cancellations remove the last unvested installments. A recorded
 * departure, expiration, or cancellation of all unvested units stops vesting.
 */
export function vestedQuantity(security, asOf) {
  const stopped = vestingStopDate(security);
  const until = stopped && stopped < asOf ? stopped : asOf;
  let limit = Math.max(0, Math.round(Number(security.quantity) || 0));
  // Vested options that later lapse were still earned; only cancellations
  // of unvested installments reduce the schedule's eventual vested count.
  if (security.cancelledDate) {
    limit = scheduledVestedQuantity(security, VESTING_HORIZON);
    for (const c of cancellationHistory(security)) {
      const date = stopped && stopped < c.date ? stopped : c.date;
      limit -= Math.min(c.quantity, Math.max(0, limit - scheduledVestedQuantity(security, date)));
    }
  }
  return Math.min(limit, scheduledVestedQuantity(security, until));
}

/** The date service or all future vesting ended, independent of a partial
 * cancellation. Old full-forfeiture records retain their original stop. */
export function vestingStopDate(security) {
  let stop = security.vestingStoppedAt || '';
  if (!security.cancelledDate) return stop;
  const history = cancellationHistory(security);
  // Older schedule-only records used this date without a quantity.
  if (!history.length) return stop && stop < security.cancelledDate ? stop : security.cancelledDate;
  let cancelled = 0;
  const scheduled = scheduledVestedQuantity(security, VESTING_HORIZON);
  const cutoff = security.kind === 'option' ? exerciseCutoff(security) : '';
  for (const c of history) {
    cancelled += c.quantity;
    if (c.date === cutoff || scheduled - cancelled <= scheduledVestedQuantity(security, c.date)) {
      if (!stop || c.date < stop) stop = c.date;
      break;
    }
  }
  return stop;
}

function scheduledVestedQuantity(security, asOf) {
  const qty = Math.max(0, Math.round(Number(security.quantity) || 0));
  const tranches = vestingTranches(security);
  if (tranches) {
    let vested = 0;
    for (const t of tranches) {
      if (t?.date && t.date <= asOf) vested += Math.max(0, Math.round(Number(t.quantity) || 0));
    }
    return Math.min(qty, vested);
  }
  const total = Math.round(Number(security.vestingMonths) || 0);
  if (total <= 0) return qty;
  const elapsed = monthsBetween(vestingStartDate(security), asOf);
  const cliff = Math.round(Number(security.cliffMonths) || 0);
  if (elapsed < cliff) return 0;
  if (elapsed >= total) return qty;
  const interval = VESTING_INTERVAL_MONTHS[security.vestingFrequency] || 1;
  const stepped = Math.max(cliff, Math.floor(elapsed / interval) * interval);
  /* Clamped to what the certificate holds, so the shares a repurchase took
     out of the unvested tail simply never arrive. */
  const offset = Math.max(0, Math.round(Number(security.vestingOffset) || 0));
  return Math.min(qty, Math.max(0, Math.floor((vestingPosition(security) * stepped) / total) - offset));
}

/* Acceleration terms recorded on a security. 'single' fires on a change of
   control alone; 'double' also needs a termination, which an exit model
   assumes happens - that is the scenario the clause was written for. */
export const ACCELERATION_TRIGGERS = [
  { value: '', label: 'None' },
  { value: 'single', label: 'Single trigger' },
  { value: 'double', label: 'Double trigger' },
];

export function hasAcceleration(security) {
  return security?.accelTrigger === 'single' || security?.accelTrigger === 'double';
}

/**
 * Vested count assuming a change of control fires the security's recorded
 * acceleration: the stated percentage of whatever is still unvested vests on
 * top. No acceleration terms → plain vested count.
 */
export function acceleratedVested(security, asOf) {
  const outstanding = security.kind === 'option' || security.kind === 'rsu'
    ? grantOutstanding(security)
    : Math.max(0, Math.round(Number(security.quantity) || 0));
  const vested = Math.min(outstanding, vestedQuantity(security, asOf));
  if (!hasAcceleration(security)) return vested;
  const pct = Math.min(100, Math.max(0, Number(security.accelPct) || 100)) / 100;
  return Math.min(outstanding, vested + Math.round((outstanding - vested) * pct));
}

/**
 * The portion still to vest; 0 for anything without a schedule.
 *
 * With `securities` given, an option grant nets out what its exercises
 * already turned into certificates - an early-exercised certificate carries
 * the grant's schedule and reports its own unvested balance, so leaving the
 * grant's count whole would count those same unvested shares twice (the same
 * convention grantDiluted applies to the diluted base). Without the array
 * the grant reads standalone, as before.
 */
export function unvestedQuantity(security, asOf, securities = null) {
  /* An RSU's settled units are shares already, and shares no longer being
     earned: the certificate comes out fully vested and carries no schedule.
     Ordinarily they sit inside the vested balance, so the award's unvested
     balance is the answer on its own. Not always, though - an award whose
     date was moved later, or whose schedule was lengthened, after a
     settlement reads as having vested less by today than it has settled, and
     the settled units then counted as still being earned here while the
     vesting forecast (which nets them the way the diluted base does) said
     they were gone. With `securities` given - the array, or the
     certifiedByRsu index over it - the settled units come off first. */
  if (security.kind === 'rsu') {
    const outstanding = rsuOutstanding(security);
    const vested = rsuVested(security, asOf);
    if (!securities || !security.id) return Math.max(0, outstanding - vested);
    const certified = securities instanceof Map
      ? securities.get(security.id) || 0
      : certifiedFromRsu(securities, security.id);
    return Math.max(0, outstanding - Math.max(vested, certified));
  }
  if (security.kind === 'option') {
    const outstanding = grantOutstanding(security);
    const vested = grantVested(security, asOf);
    if (!securities) return Math.max(0, outstanding - vested);
    // The id guard matters: a grant without one must not "match" every
    // certificate whose fromOptionId is equally absent.
    const certs = security.id ? securities.filter((s) => (
      s.kind === 'shares' && s.fromOptionId === security.id && !s.fromTransferId)) : [];
    if (!certs.length) return Math.max(0, outstanding - vested);
    const certified = certs.reduce((a, s) => a + issuedQty(s), 0);
    const certifiedVested = certs.reduce(
      (a, s) => a + Math.min(issuedQty(s), vestedQuantity(s, asOf)), 0);
    // What still sits on the grant, less the vested balance that stayed
    // with it (a fully-vested exercise certificate took no schedule along).
    const diluted = Math.max(0, outstanding - certified);
    const vestedOnGrant = Math.max(0, vested - certifiedVested);
    return Math.max(0, diluted - vestedOnGrant);
  }
  // A closed (transferred) certificate has nothing left to vest here; its
  // successors carry whatever schedule survived.
  if (security.closedAt) return 0;
  const qty = Math.max(0, Math.round(Number(security.quantity) || 0));
  return Math.max(0, qty - vestedQuantity(security, asOf));
}

/**
 * Unvested equity across certificates and option grants. Ownership math is
 * deliberately untouched by vesting - unvested shares are still outstanding
 * shares, and unvested options still occupy the diluted base. This is
 * reporting: how much of what's on the table is still being earned.
 */
export function unvestedTotal(securities, asOf) {
  // One pass to group exercise certificates by grant; handing each grant
  // only its own certificates avoids rescanning the array per grant.
  const certsByGrant = new Map();
  for (const s of securities) {
    if (s.kind === 'shares' && s.fromOptionId && !s.fromTransferId) {
      const list = certsByGrant.get(s.fromOptionId);
      if (list) list.push(s);
      else certsByGrant.set(s.fromOptionId, [s]);
    }
  }
  const certifiedRsu = certifiedByRsu(securities);
  return securities.reduce((a, s) => {
    if (s.kind === 'shares') return a + unvestedQuantity(s, asOf);
    if (s.kind === 'rsu') return a + unvestedQuantity(s, asOf, certifiedRsu);
    if (s.kind === 'option') return a + unvestedQuantity(s, asOf, certsByGrant.get(s.id) || []);
    return a;
  }, 0);
}

/* ---------- Vesting forecast ---------- */

/** How far ahead the forecast looks by default. */
export const FORECAST_MONTHS = 24;

/**
 * The longest time-based schedule a record keeps, in months: fifty years,
 * well past any plan. Not a limit anyone reaches on purpose - it exists
 * because a schedule's length was unbounded, and everything that walks a
 * schedule month by month (the expense report's vesting steps, the coming-up
 * list's full-vest search) walked a 1e9-month import for as long as the tab
 * stayed open.
 */
export const MAX_VESTING_MONTHS = 600;

/** How long a stakeholder's and a share class's name are kept. The CSV
 *  planner cuts names to the same length before it compares them, so a name
 *  that is only distinct past the cut is one holder, not two. */
export const STAKEHOLDER_NAME_MAX = 120;
export const CLASS_NAME_MAX = 80;
/** How long a stakeholder's email is kept: the form's maxlength, and what the
 *  CSV planner refuses past, since an address cut short is no address. */
export const EMAIL_MAX = 120;

/**
 * Every security with a live vesting schedule, each paired with the quantity
 * still on that schedule and a way to read its vested count on any date.
 *
 * The netting is `unvestedQuantity`'s, deliberately: an early-exercised
 * certificate carries its grant's schedule and reports its own vesting, so
 * the shares it took are subtracted from the grant rather than counted twice.
 * That keeps the forecast's unvested balance equal to `unvestedTotal`, which
 * is the number the dashboard and the holder page already show.
 */
function schedules(securities) {
  const certsByGrant = new Map();
  for (const s of securities) {
    if (s.kind === 'shares' && s.fromOptionId && !s.fromTransferId) {
      const list = certsByGrant.get(s.fromOptionId);
      if (list) list.push(s);
      else certsByGrant.set(s.fromOptionId, [s]);
    }
  }
  const certifiedRsu = certifiedByRsu(securities);
  const out = [];
  for (const s of securities) {
    if (!hasVesting(s)) continue;
    if (s.kind === 'shares') {
      if (isClosed(s)) continue;
      const total = qty(s);
      if (total > 0) out.push({ security: s, total, vestedAt: (d) => Math.min(total, vestedQuantity(s, d)) });
    } else if (s.kind === 'option') {
      const certs = certsByGrant.get(s.id) || [];
      const certified = certs.reduce((a, c) => a + issuedQty(c), 0);
      const total = Math.max(0, grantOutstanding(s) - certified);
      if (total > 0) {
        out.push({
          security: s,
          total,
          vestedAt: (d) => {
            const certifiedVested = certs.reduce(
              (a, c) => a + Math.min(issuedQty(c), vestedQuantity(c, d)), 0);
            return Math.min(total, Math.max(0, grantVested(s, d) - certifiedVested));
          },
        });
      }
    } else if (s.kind === 'rsu') {
      /* Settled units left the award for their certificates, which carry no
         schedule - so what is still on one is the unsettled balance, and its
         vested count is what has vested beyond what was already settled. The
         same netting as the option branch; without it a half-settled award
         read "500 of 1,000 vested" beside a grant in the same position that
         read "0 of 500". */
      const certified = certifiedRsu.get(s.id) || 0;
      const total = Math.max(0, rsuOutstanding(s) - certified);
      if (total > 0) {
        out.push({
          security: s,
          total,
          vestedAt: (d) => Math.min(total, Math.max(0, rsuVested(s, d) - certified)),
        });
      }
    }
  }
  return out;
}

/** Shares on a vesting schedule right now, whatever their kind. */
export function scheduledShares(securities) {
  return schedules(securities).reduce((a, x) => a + x.total, 0);
}

/**
 * The vesting curve: how much vests in each of the next `months` calendar
 * months, and the cumulative vested position against everything on a
 * schedule.
 *
 * Built on the same tranche and schedule machinery every other vesting figure
 * in this file uses - by asking each security what it has vested on a date
 * rather than re-deriving the shape - so custom tranches, cliffs, quarterly
 * and annual steps, and a cancellation that froze the clock are all respected
 * for free.
 *
 * The first bucket runs from `from` to the end of its own month, so shares
 * that vested earlier this month are already counted as vested and never
 * appear as upcoming. Acceleration is not applied: it fires on a change of
 * control, which is an exit scenario rather than a forecast.
 *
 * Each row: { month: 'YYYY-MM', end, vesting, vested, unvested }.
 */
export function vestingForecast(securities, { from, months = FORECAST_MONTHS } = {}) {
  const empty = {
    rows: [], granted: 0, vestedNow: 0, unvestedNow: 0, vestingTotal: 0, peak: null,
  };
  if (!from || !(months > 0)) return empty;
  const list = schedules(securities);
  const granted = list.reduce((a, x) => a + x.total, 0);
  if (!granted) return empty;

  const vestedOn = (date) => list.reduce((a, x) => a + x.vestedAt(date), 0);
  const monthStart = `${from.slice(0, 7)}-01`;
  const vestedNow = vestedOn(from);

  const rows = [];
  let previous = vestedNow;
  for (let i = 0; i < months; i++) {
    // The last day of month i: the day before the first of the next one.
    const end = addDaysISO(addMonthsISO(monthStart, i + 1), -1);
    if (!end) break;
    const vested = Math.max(previous, vestedOn(end));
    rows.push({
      month: end.slice(0, 7),
      end,
      vesting: vested - previous,
      vested,
      unvested: Math.max(0, granted - vested),
    });
    previous = vested;
  }

  const peak = rows.reduce((best, r) => (r.vesting > (best?.vesting || 0) ? r : best), null);
  return {
    rows,
    granted,
    vestedNow,
    unvestedNow: Math.max(0, granted - vestedNow),
    vestingTotal: rows.reduce((a, r) => a + r.vesting, 0),
    peak,
  };
}

/* ---------- Transfers ---------- */

/**
 * A certificate a transfer or repurchase has closed. It stays on the books
 * for history - its shares live on in the successor certificates (or, for a
 * repurchase, were retired) - but it contributes nothing to any current
 * count. `dbAsOf` reopens it for dates before the transfer.
 */
export function isClosed(security) {
  return !!security?.closedAt;
}

/**
 * What a company repurchase paid for the shares it retired, read off the
 * certificate it closed: a repurchase issues no buyer certificate, so unlike
 * a sale it has nowhere else to record its terms. Null for anything else,
 * and for a repurchase recorded before they were stored.
 */
export function repurchaseTerms(security) {
  if (security?.closedReason !== 'repurchase') return null;
  const quantity = Math.max(0, Math.round(Number(security.repurchasedQty) || 0));
  if (quantity <= 0) return null;
  const pricePerShare = Math.max(0, Number(security.repurchasePricePerShare) || 0);
  return { quantity, pricePerShare, consideration: quantity * pricePerShare };
}

/* ---------- Aggregates ---------- */

/* A certificate at the size it was issued, whatever became of it since. */
const issuedQty = (s) => Math.max(0, Math.round(Number(s.quantity) || 0));

/* Closed certificates count zero here, which is what makes every aggregate
   in this file - outstanding, diluted, ownership, preferences, proceeds -
   read the successor certificates instead of double-counting both legs. */
const qty = (s) => (s.closedAt ? 0 : issuedQty(s));

export function sharesOutstanding(securities) {
  return securities.filter((s) => s.kind === 'shares').reduce((a, s) => a + qty(s), 0);
}

/* ---------- Option grant lifecycle ---------- */

const cancelledQty = (grant) => Math.max(0, Math.round(Number(grant.cancelled) || 0));

/**
 * Every forfeiture an award has recorded, oldest first, as
 * `[{ quantity, date }]`.
 *
 * A grant cancelled once carries the `cancelled`/`cancelledDate` pair it
 * always did, and reads back as a one-entry history. The list only appears
 * once a second cancellation would otherwise have to overwrite the first -
 * a departure that forfeits the unvested balance, then an expiration that
 * takes what was left. Each is effective on its own day, so a historical
 * snapshot can put back only the ones that had not happened yet.
 */
export function cancellationHistory(award) {
  const list = Array.isArray(award?.cancellations) ? award.cancellations : [];
  if (list.length) return list;
  const quantity = cancelledQty(award || {});
  if (quantity <= 0) return [];
  return [{ quantity, date: award.cancelledDate || securityDate(award) }];
}

/** Options a grant still holds: granted, less whatever was cancelled back. */
export function grantOutstanding(grant) {
  return Math.max(0, qty(grant) - cancelledQty(grant));
}

/**
 * Vested options a grant still holds, never more than survived cancellation.
 *
 * And never more than had vested when the right to exercise ended: once the
 * term or a post-termination window has closed, nothing more becomes
 * exercisable, whatever the schedule says - the unexercised options lapsed,
 * vested or not, on that day. Read past the cutoff, a lapsed grant went on
 * "vesting" on the register, the holder statement, the unvested tile, the
 * forecast and the calendar while the actions sheet, measuring on the last
 * exercisable day, said less - until someone recorded the lapse. The
 * schedule as granted is untouched: the expense report reads it through
 * vestedQuantity.
 */
export function grantVested(grant, asOf) {
  const cutoff = grant?.kind === 'option' ? exerciseCutoff(grant) : '';
  const until = cutoff && asOf && cutoff < asOf ? cutoff : asOf;
  return Math.min(grantOutstanding(grant), vestedQuantity(grant, until));
}

/** Options already exercised, clamped to what the grant still holds. */
export function grantExercised(grant) {
  return Math.min(grantOutstanding(grant), Math.max(0, Math.round(Number(grant.exercised) || 0)));
}

/** Certificates issued out of a grant's exercises. */
export function certificatesFromGrant(securities, grantId) {
  return securities.filter((s) => s.kind === 'shares' && s.fromOptionId === grantId);
}

/**
 * Options a grant has already turned into shares: the certificates issued
 * directly out of its exercises, at the size they were issued.
 *
 * Read at issued size, not current size, because an exercise is permanent.
 * Once the holder bought those options they left the grant for good; whether
 * the shares are later sold on or repurchased and retired is share history,
 * and counting a closed certificate as zero here would hand the grant its
 * exercised options back as though they had never been exercised.
 *
 * Transfer successors inherit `fromOptionId` so the lineage survives a sale,
 * but they re-present shares this sum already counted on the original
 * certificate, so they are skipped rather than counted twice.
 */
function certifiedFromGrant(securities, grantId) {
  return securities.reduce((a, s) => (
    s.kind === 'shares' && s.fromOptionId === grantId && !s.fromTransferId
      ? a + issuedQty(s)
      : a), 0);
}

/**
 * Shares certified out of each option grant, indexed in a single pass -
 * the same rule as certifiedFromGrant (originals at issued size, transfer
 * successors skipped), kept in step with it or the waterfall would pay out
 * a different share count than the cap table shows. Every aggregate that
 * nets grants against their certificates takes this index; asking
 * certifiedFromGrant per grant instead rescans the whole array each time,
 * which is quadratic across a render's worth of grants.
 */
export function certifiedByGrant(securities) {
  const byGrant = new Map();
  for (const s of securities) {
    if (s.kind !== 'shares' || !s.fromOptionId || s.fromTransferId) continue;
    byGrant.set(s.fromOptionId, (byGrant.get(s.fromOptionId) || 0) + issuedQty(s));
  }
  return byGrant;
}

/**
 * The share count a grant still contributes to the diluted base. Exercised
 * options that already became certificates are counted on those certificates,
 * so exercising never double-counts; exercises recorded without a certificate
 * stay on the grant.
 *
 * `securities` may be the securities array, or the certifiedByGrant index
 * over it - callers looping over many grants pass the index so one pass
 * serves them all.
 */
export function grantDiluted(grant, securities) {
  const certified = securities instanceof Map
    ? securities.get(grant.id) || 0
    : certifiedFromGrant(securities, grant.id);
  return Math.max(0, grantOutstanding(grant) - certified);
}

/**
 * The last day a grant can still be exercised: its expiration, or the
 * post-termination exercise deadline a departure set - whichever lands
 * first. Empty when neither exists.
 */
export function exerciseCutoff(grant) {
  const dates = [grant?.expires, grant?.exerciseBy].filter(Boolean);
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : '';
}

/**
 * Where a grant stands: 'cancelled' (nothing survived), 'exercised' (all of
 * what survived is exercised), 'expired' (past its expiration or its
 * post-termination window with options still unexercised),
 * 'partially-exercised', or 'active'.
 */
export function grantStatus(grant, asOf) {
  const remaining = grantOutstanding(grant);
  if (remaining <= 0) return 'cancelled';
  const exercised = grantExercised(grant);
  if (exercised >= remaining) return 'exercised';
  const cutoff = exerciseCutoff(grant);
  if (cutoff && asOf && cutoff < asOf) return 'expired';
  if (exercised > 0) return 'partially-exercised';
  return 'active';
}

/* ---------- Restricted stock units ---------- */

/**
 * An RSU's lifecycle counters are an option grant's arithmetic under the
 * award's own vocabulary: units left after forfeitures, units vested, and
 * units already settled into shares. Same primitives, so the two kinds can
 * never drift apart.
 */
export const rsuOutstanding = (award) => grantOutstanding(award);
export const rsuVested = (award, asOf) => grantVested(award, asOf);

/** Units already turned into shares, clamped to what the award still holds. */
export function rsuSettled(award) {
  return Math.min(rsuOutstanding(award), Math.max(0, Math.round(Number(award.settled) || 0)));
}

/**
 * Shares certified out of each RSU award, indexed in one pass - the same
 * rule (and the same reason) as certifiedByGrant.
 */
export function certifiedByRsu(securities) {
  const byAward = new Map();
  for (const s of securities) {
    if (s.kind !== 'shares' || !s.fromRsuId || s.fromTransferId) continue;
    byAward.set(s.fromRsuId, (byAward.get(s.fromRsuId) || 0) + issuedQty(s));
  }
  return byAward;
}

/** Certificates issued out of an award's settlements. */
export function certificatesFromRsu(securities, awardId) {
  return securities.filter((s) => s.kind === 'shares' && s.fromRsuId === awardId);
}

/**
 * The share count an RSU award still contributes to the diluted base: units
 * outstanding, less the ones that already became certificates.
 *
 * `securities` may be the securities array or the certifiedByRsu index over
 * it, exactly like grantDiluted.
 */
export function rsuDiluted(award, securities) {
  const certified = securities instanceof Map
    ? securities.get(award.id) || 0
    : certifiedFromRsu(securities, award.id);
  return Math.max(0, rsuOutstanding(award) - certified);
}

function certifiedFromRsu(securities, awardId) {
  return securities.reduce((a, s) => (
    s.kind === 'shares' && s.fromRsuId === awardId && !s.fromTransferId
      ? a + issuedQty(s)
      : a), 0);
}

/** Whether an award only settles once a liquidity event happens. */
export function hasLiquidityCondition(award) {
  return award?.kind === 'rsu' && award.liquidityCondition === true;
}

/**
 * Where an award stands: 'cancelled' (nothing survived), 'settled' (every
 * surviving unit is now shares), 'partially-settled', or 'active'.
 */
export function rsuStatus(award, asOf) {
  const remaining = rsuOutstanding(award);
  if (remaining <= 0) return 'cancelled';
  const settled = rsuSettled(award);
  if (settled >= remaining) return 'settled';
  if (settled > 0) return 'partially-settled';
  return 'active';
}

/* A date no schedule runs past, for reading what an award will ever vest. */
const VESTING_HORIZON = '9999-12-31';

/**
 * The most an award will ever vest as its record stands: everything on its
 * surviving schedule, or what had vested by an explicit stop, and never
 * more than it still holds. On a grant without early exercise nothing can
 * legitimately have been exercised past it, and nothing can ever be settled
 * past it on an RSU award.
 */
export function vestingCeiling(award) {
  /* The schedule as written, frozen at a recorded stop - not cut at the
     exercise window the way grantVested reads a date past it. The window
     is what lapses the options; read through it, a grant whose schedule
     was lengthened after an exercise and then expired had a ceiling
     already below its counter before the lapse was recorded, and the lapse
     that the guards refuse for exactly that then passed as no drop. */
  return Math.min(grantOutstanding(award), vestedQuantity(award, VESTING_HORIZON));
}

/**
 * The first exercise a grant made ahead of its vesting: the exercise
 * certificate on whose date the options bought so far had outrun what had
 * vested by then, as `{ certificate, exercised, vested }` - or null when
 * every exercise was covered. Only an early-exercise grant can legitimately
 * carry one, which is what makes the provision load-bearing on the record:
 * turned off while such a certificate stands, the grant says only vested
 * options are exercisable beside its own certificate saying otherwise, and
 * the next cancellation - a departure - freezes its vesting below what was
 * bought and is refused with nothing the user can do about it.
 *
 * Read off the certificates, which are the exercises that carry a date; an
 * exercise recorded on the counter alone is undated and is held to the
 * final ceiling instead. Transfer successors re-present shares already
 * counted on the certificate they came off.
 */
export function exerciseAheadOfVesting(award, securities) {
  const units = award?.kind === 'rsu';
  if ((award?.kind !== 'option' && !units) || !award.id) return null;
  /* And an RSU award's settlement certificates against the same rule: a
     settlement is refused past what had vested on its day, and a certificate
     edited earlier or larger afterwards said otherwise. */
  const certs = datedExercises(award, securities);
  let exercised = 0;
  for (const certificate of certs) {
    exercised += issuedQty(certificate);
    const vested = units ? rsuVested(award, certificate.date) : grantVested(award, certificate.date);
    if (exercised > vested) return { certificate, exercised, vested };
  }
  return null;
}

/**
 * The certificates that date an award's exercises (its settlements, for an
 * RSU award), oldest first: the ones issued directly out of it, read at
 * issued size. A transfer successor re-presents shares already counted on
 * the certificate it came off, and a certificate with no date dates nothing.
 */
function datedExercises(award, securities) {
  const units = award.kind === 'rsu';
  return (securities || [])
    .filter((s) => s.kind === 'shares' && (units ? s.fromRsuId : s.fromOptionId) === award.id
      && !s.fromTransferId && s.date)
    .sort((a, b) => a.date.localeCompare(b.date) || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0));
}

/**
 * How many options an exercise dated `date` can cover without any exercise
 * on the grant running ahead of the vesting of its own day (units and a
 * settlement, for an RSU award), and the day whose vesting sets that bound.
 *
 * An exercise is held to what had vested by its date, less what had been
 * exercised by then: the certificates dated on or before it, plus every
 * exercise recorded on the counter alone, which carries no date and so
 * counts against every day. The exercises already on file after `date` are
 * measured again with this one in front of them, so a backfilled exercise
 * cannot put a later certificate ahead of the schedule that covered it when
 * it was recorded - and when it is a later one that binds, `on` names its
 * day, so the refusal can say which exercise the new one would outrun.
 *
 * Netting the whole counter instead, whatever its dates, refused a valid
 * history entered out of order: January's 50 exercised out of the 100 vested
 * by then were recorded first, and April's 25 - exactly what had vested by
 * April - were refused as unvested, on both kinds of award.
 *
 * `certifying`: options already on the counter that the caller is about to
 * date with this certificate, so they leave the undated balance as they
 * gain a day.
 */
export function exerciseRoom(award, securities, date, { certifying = 0 } = {}) {
  const units = award?.kind === 'rsu';
  if ((award?.kind !== 'option' && !units) || !date) return { room: 0, on: date || '' };
  const certs = datedExercises(award, securities);
  const dated = certs.reduce((a, c) => a + issuedQty(c), 0);
  const counter = units ? rsuSettled(award) : grantExercised(award);
  const undated = Math.max(0, Math.max(0, counter - dated) - Math.max(0, Math.round(Number(certifying) || 0)));
  const vestedOn = (d) => (units ? rsuVested(award, d) : grantVested(award, d));
  const days = [...new Set([date, ...certs.filter((c) => c.date > date).map((c) => c.date)])];
  let room = Infinity;
  let on = date;
  for (const d of days) {
    const before = certs.reduce((a, c) => (c.date <= d ? a + issuedQty(c) : a), 0);
    const left = vestedOn(d) - before - undated;
    if (left < room) {
      room = left;
      on = d;
    }
  }
  return { room: Math.max(0, room), on };
}

/** Allocate the grant's remaining vesting installments to an exercise.
 * Previously every early certificate received a proportional copy of the
 * whole grant, including installments already bought on earlier certificates.
 * Original certificates retain their allocation after a transfer/repurchase;
 * successors must not consume the same installments a second time.
 */
export function exerciseVestingSchedule(grant, securities, quantity, { certifying = 0 } = {}) {
  const original = { ...grant, cancelledDate: '', vestingStoppedAt: '' };
  const certs = securities.filter((s) => s.kind === 'shares' && s.fromOptionId === grant.id && !s.fromTransferId);
  const certified = certs.reduce((sum, s) => sum + issuedQty(s), 0);
  const undated = Math.max(0, grantExercised(grant) - certified - certifying);
  // Keep a regular schedule exact through stock splits. Each certificate
  // owns a slice of the original schedule: base minus earlier allocations.
  // Legacy or manually changed schedules use the explicit residual below.
  let offset = undated;
  const prefix = certs.every((s) => {
    const matches = !hasVesting(s) || (!vestingTranches(s)
      && s.vestingMonths === grant.vestingMonths && s.cliffMonths === grant.cliffMonths
      && vestingStartDate(s) === vestingStartDate(grant)
      && (s.vestingFrequency || 'monthly') === (grant.vestingFrequency || 'monthly')
      && vestingPosition(s) === issuedQty(grant)
      && (s.vestingOffset || 0) === offset);
    offset += issuedQty(s);
    return matches;
  });
  if (prefix && !vestingTranches(grant)) {
    return {
      vestingMonths: grant.vestingMonths, cliffMonths: grant.cliffMonths,
      vestingStart: vestingStartDate(grant), vestingBase: issuedQty(grant),
      ...(offset ? { vestingOffset: offset } : {}),
      ...(grant.vestingFrequency ? { vestingFrequency: grant.vestingFrequency } : {}),
    };
  }
  const dates = new Set();
  for (const s of [original, ...certs]) {
    const tranches = vestingTranches(s);
    if (tranches) for (const t of tranches) dates.add(t.date);
    else if (hasVesting(s)) {
      const start = vestingStartDate(s);
      for (let m = 0; m <= Math.min(MAX_VESTING_MONTHS, s.vestingMonths); m += 1) {
        dates.add(addMonthsISO(start, m));
      }
    }
  }
  const days = [...dates].filter(Boolean).sort();
  const available = days.map((date) => Math.min(quantity, Math.max(0,
    vestedQuantity(original, date) - undated
      - certs.reduce((sum, s) => sum + vestedQuantity(s, date), 0))));
  // A corrected/legacy certificate may have different vesting dates. An
  // installment must stay available on every later date, not just today.
  for (let i = available.length - 2; i >= 0; i -= 1) available[i] = Math.min(available[i], available[i + 1]);
  const tranches = [];
  let allocated = 0;
  for (let i = 0; i < days.length; i += 1) {
    if (available[i] > allocated) tranches.push({ date: days[i], quantity: available[i] - allocated });
    allocated = available[i];
  }
  if (allocated !== quantity) throw new Error('The remaining vesting schedule does not cover this exercise. Review the grant and its existing certificates.');
  return { vestingTranches: tranches };
}

/** Unsettled RSU units sitting in the diluted base. */
export function rsusDiluted(securities) {
  const certified = certifiedByRsu(securities);
  return securities.reduce((a, s) => (s.kind === 'rsu' ? a + rsuDiluted(s, certified) : a), 0);
}

/* ---------- Early exercise and 83(b) elections ---------- */

/** The filing window: 30 days from issuance, no extensions, ever. */
export const DAYS_83B = 30;

/**
 * Whether a certificate starts the 83(b) clock: restricted stock, meaning
 * shares that reverse-vest - founder stock and early-exercised options.
 */
export function needs83b(security) {
  return security?.kind === 'shares' && hasVesting(security);
}

/**
 * The last day the election can be filed for a certificate. A transfer
 * remainder carries `date83b` - the date of the original purchase it
 * continues - because a partial sale doesn't restart the window.
 */
export function deadline83b(security) {
  const anchor = security?.date83b || security?.date;
  return anchor ? addDaysISO(anchor, DAYS_83B) : '';
}

/**
 * Where a certificate stands with its 83(b): null when none is called for,
 * otherwise { state: 'filed' | 'open' | 'missed', ... }. 'open' carries the
 * deadline and days left; the app records and reminds, it never files.
 *
 * A missed window can be `acknowledged`: the holder confirmed the election was
 * not filed, which is a fact worth recording rather than a reminder worth
 * repeating. The status itself is unchanged - the shares are still restricted
 * stock with no election on them - so every view keeps reporting it.
 */
export function status83b(security, asOf) {
  if (!needs83b(security)) return null;
  if (security.filed83b) return { state: 'filed', date: security.filed83b };
  const deadline = deadline83b(security);
  if (!deadline) return null;
  if (asOf && asOf <= deadline) {
    return { state: 'open', deadline, daysLeft: daysBetween(asOf, deadline) };
  }
  return { state: 'missed', deadline, acknowledged: security.missed83b === true };
}

/* ---------- Exercise economics ---------- */

/* An ISO's gain is taxed as a long-term capital gain only on a qualifying
   disposition, which needs both holding periods met: two years from the grant
   and one year from the exercise. */
export const ISO_QUALIFY_GRANT_MONTHS = 24;
export const ISO_QUALIFY_EXERCISE_MONTHS = 12;

/**
 * The first day an ISO's shares can be sold as a qualifying disposition:
 * the later of two years from grant and one year from exercise. Empty when
 * either date is missing.
 */
export function qualifyingDispositionDate(grant, exerciseDate) {
  const granted = grant?.grantDate || grant?.date || '';
  if (!granted || !exerciseDate) return '';
  const fromGrant = addMonthsISO(granted, ISO_QUALIFY_GRANT_MONTHS);
  const fromExercise = addMonthsISO(exerciseDate, ISO_QUALIFY_EXERCISE_MONTHS);
  if (!fromGrant || !fromExercise) return '';
  return fromGrant > fromExercise ? fromGrant : fromExercise;
}

/**
 * What an exercise costs and what it is worth on paper: the strike paid, the
 * fair market value in force on the exercise date, and the bargain spread
 * between them - which is usually the larger number, and the reason exercises
 * produce surprises.
 *
 * This is inputs and arithmetic, in keeping with how this app treats a 409A:
 * it reads back the valuation the user recorded and multiplies. It computes
 * no tax, applies no rate, and takes no position. `fmv` is null when no
 * valuation was in force on the date, in which case so is the spread - a
 * missing 409A is reported, never guessed at.
 *
 * `strike` overrides the grant's own, for an exercise already recorded on a
 * certificate: what was paid is what that certificate says.
 */
export function exerciseEconomics(db, grant, { quantity, date, strike = null }) {
  const qty = Math.max(0, Math.round(Number(quantity) || 0));
  const price = Math.max(0, Number(strike ?? grant?.strike) || 0);
  const fmv = currentFMV(db.company, date);
  const spreadPerShare = fmv ? fmv.fmvPerShare - price : null;
  const iso = isISO(grant);
  return {
    quantity: qty,
    strike: price,
    cost: qty * price,
    fmv,
    spreadPerShare,
    spread: spreadPerShare === null ? null : spreadPerShare * qty,
    iso,
    qualifyingDate: iso ? qualifyingDispositionDate(grant, date) : '',
  };
}

/* ---------- ISO / NSO classification ---------- */

/**
 * Whether a grant is an incentive stock option. The field is opt-in: a grant
 * without one is an NSO, which keeps every record written before the field
 * existed meaning what it always meant.
 */
export function isISO(grant) {
  return grant?.kind === 'option' && grant.optionType === 'iso';
}

/** The IRS ceiling on ISO value first becoming exercisable per year. */
export const ISO_ANNUAL_LIMIT = 100_000;

/**
 * Value of a holder's ISOs first becoming exercisable in each calendar year,
 * as a Map of year → { value, estimated }. "First exercisable" follows the
 * vesting schedule (a grant without one is exercisable in full on its grant
 * date), with forfeitures read the same way the vesting math reads them.
 *
 * This is the number the $100K rule caps: past it, the excess is an NSO by
 * law whether anyone noticed or not.
 *
 * The rule measures aggregate fair market value *at the time the option was
 * granted* (IRC 422(d); Treas. Reg. 1.422-4(a) and (b)(2)), not the exercise
 * price. The two usually agree - an ISO cannot be granted below fair market
 * value, and grants are written at it - but a strike deliberately set above
 * it, as a 10% owner's must be, is not the basis: 95,000 shares at a $1.10
 * strike over a recorded $1 valuation measured $104,500 and read as over the
 * limit when the basis was $95,000.
 *
 * `estimated` marks a year that fell back to the strike because no valuation
 * on or before the grant date is on record. The strike is the closest figure
 * available and can never understate the basis, but it is not the recorded
 * valuation the rule asks for, so the warnings say which one they used.
 */
export function isoLimitValueByYear(db, stakeholderId) {
  const byYear = new Map();
  const bump = (year, value, estimated) => {
    if (!(value > 0)) return;
    const prev = byYear.get(year);
    byYear.set(year, {
      value: (prev?.value || 0) + value,
      estimated: !!prev?.estimated || estimated,
    });
  };
  for (const s of db?.securities || []) {
    if (!isISO(s) || s.stakeholderId !== stakeholderId) continue;
    const granted = s.grantDate || s.date || '';
    const fmv = granted ? currentFMV(db.company, granted) : null;
    const estimated = !fmv;
    const perShare = fmv ? fmv.fmvPerShare : Math.max(0, Number(s.strike) || 0);
    if (perShare <= 0) continue;
    /* An early-exercise grant is exercisable in full from the day it is
       granted - that is what the provision means - so the whole of it first
       becomes exercisable in the grant year, whatever its vesting schedule
       says about when the shares stop being repurchasable. */
    if (!hasVesting(s) || s.earlyExercise === true) {
      if (granted) bump(Number(granted.slice(0, 4)), qty(s) * perShare, estimated);
      continue;
    }
    const tranches = vestingTranches(s);
    const start = tranches ? tranches[0]?.date : vestingStartDate(s);
    if (!start) continue;
    const end = tranches
      ? tranches[tranches.length - 1].date
      : addMonthsISO(start, Math.round(Number(s.vestingMonths) || 0));
    const stopped = vestingStopDate(s);
    const stop = stopped && stopped < end ? stopped : end;
    /* Never before the grant year. A schedule can start before the option
       does - prior service credited on a new hire's grant, a founder's
       reverse-vesting date - and nothing is exercisable before the option
       exists, so whatever the schedule says was earned by then first becomes
       exercisable in the grant year. Left unclamped, a 150,000-option grant
       whose schedule half-landed the year before it was written read as two
       75,000 years and cleared the $100,000 limit it was over. The same
       clamp the reporting module's vestingSteps applies. */
    const firstYear = Math.max(
      Number(start.slice(0, 4)),
      granted ? Number(granted.slice(0, 4)) : 0);
    const lastYear = Math.max(firstYear, Number(stop.slice(0, 4)));
    let prev = 0;
    for (let y = firstYear; y <= lastYear; y++) {
      const vested = vestedQuantity(s, `${y}-12-31`);
      bump(y, (vested - prev) * perShare, estimated);
      prev = vested;
    }
  }
  return byYear;
}

/** Calendar years where a holder's ISOs run past the $100K limit. */
export function isoOverLimitYears(db, stakeholderId) {
  return [...isoLimitValueByYear(db, stakeholderId).entries()]
    .filter(([, v]) => v.value > ISO_ANNUAL_LIMIT)
    .map(([year, v]) => ({ year, value: v.value, estimated: v.estimated }))
    .sort((a, b) => a.year - b.year);
}

/**
 * The over-limit years this particular grant contributes to - the per-row
 * flag. A holder can be over in a year one grant never touches, and flagging
 * that grant would send the user to the wrong record.
 */
/**
 * The parenthetical the ISO warnings add when the figure rests on the strike
 * rather than a recorded valuation - the rule asks for the grant-date fair
 * market value, and saying which number was used is the difference between
 * a finding and a guess. Empty when every contributing grant had a 409A.
 */
export function isoBasisNote(overYears) {
  return overYears.some((o) => o.estimated)
    ? ', measured at the strike where no 409A covers the grant date'
    : '';
}

export function isoGrantOverYears(db, grant, over = isISO(grant) ? isoOverLimitYears(db, grant.stakeholderId) : []) {
  if (!isISO(grant)) return [];
  if (!over.length) return [];
  const own = isoLimitValueByYear({ ...db, securities: [grant] }, grant.stakeholderId);
  return over.filter((o) => (own.get(o.year)?.value || 0) > 0);
}

/* ---------- Aggregates (continued) ---------- */

/**
 * Options drawn out of the pool: granted, less cancelled. Exercised options
 * stay drawn - those shares left the pool for good when they were granted.
 */
export function optionsGranted(securities) {
  return securities.filter((s) => s.kind === 'option').reduce((a, s) => a + grantOutstanding(s), 0);
}

/** Option shares still sitting in the diluted base as options. */
export function optionsDiluted(securities) {
  const certified = certifiedByGrant(securities);
  return securities.reduce((a, s) => (s.kind === 'option' ? a + grantDiluted(s, certified) : a), 0);
}

/** Original exercise certificates count even after transfer or repurchase.
 * Successors carry provenance but do not exercise the warrant a second time. */
export function warrantExercised(warrant, securities = [], asOf = '9999-12-31') {
  const certificates = securities instanceof Map ? securities.get(warrant.id) || [] : securities;
  return certificates.reduce((n, s) => n + (s.kind === 'shares' && !s.fromTransferId && s.fromWarrantId
    && s.fromWarrantId === warrant.id && (!s.date || s.date <= asOf) ? issuedQty(s) : 0), 0);
}

/** Expiration is effective after the last exercise day. Snapshots carry their
 * own date; a raw collection is the current position. No source record is
 * removed or rewritten when its remaining rights expire. */
export function warrantRemaining(warrant, securities, asOf = warrant.snapshotDate || todayISO()) {
  if ((warrant.date && warrant.date > asOf) || (warrant.expires && warrant.expires < asOf)) return 0;
  const cancelled = cancellationHistory(warrant).filter((c) => c.date <= asOf)
    .reduce((n, c) => n + c.quantity, 0);
  /* Every certificate in the list, whatever its date, the way a grant nets
     its exercises: a snapshot has already dropped the certificates dated
     after its day, and in the live table the certificate is already counted
     among the shares outstanding - netted only up to today, a future-dated
     exercise sat in the shares total and inside the warrant's remaining
     rights at once, and the split preview and hiring plan read it twice. */
  return Math.max(0, qty(warrant) - cancelled - warrantExercised(warrant, securities));
}

/** Exercise certificates by the warrant they came off, built in one pass. */
export function certifiedByWarrant(securities) {
  const byWarrant = new Map();
  for (const s of securities) {
    if (s.kind !== 'shares' || !s.fromWarrantId || s.fromTransferId) continue;
    if (!byWarrant.has(s.fromWarrantId)) byWarrant.set(s.fromWarrantId, []);
    byWarrant.get(s.fromWarrantId).push(s);
  }
  return byWarrant;
}

export function warrantsOutstanding(securities, asOf) {
  /* Indexed once, the way the option and RSU legs are: netting every warrant
     against the whole list scanned it once per warrant, and the fully
     diluted count - three times per keystroke on the round model - spent
     most of its time there on a table of a few thousand records. */
  const byWarrant = certifiedByWarrant(securities);
  return securities.filter((s) => s.kind === 'warrant')
    .reduce((a, s) => a + warrantRemaining(s, byWarrant, asOf), 0);
}

/**
 * Shares the plan has committed: option grants plus RSU awards, less whatever
 * was cancelled back. Settled and exercised awards stay drawn - those shares
 * left the pool for good the day they were granted.
 */
export function poolDrawn(securities) {
  return securities.reduce((a, s) => (
    s.kind === 'option' || s.kind === 'rsu' ? a + grantOutstanding(s) : a), 0);
}

/**
 * Only plan awards draw down the employee pool - warrants never do.
 *
 * `pool` is the company record, or - for a caller that has only the one
 * number - the size of a single reserve. Given the company, the answer is
 * the unallocated reserve of every plan still open to new awards, each held
 * at zero where its awards have outrun it (see planBalances); given a
 * number, it is that reserve less everything drawn, which is what the one
 * company-wide pool always read.
 */
export function poolRemaining(pool, securities) {
  if (pool && typeof pool === 'object') return planBalances({ company: pool, securities }).total.unallocated;
  return Math.max(0, Math.round(Number(pool) || 0) - poolDrawn(securities));
}

/* ---------- Equity incentive plans ---------- */

/**
 * A company keeps its plan reserves on the company record:
 *
 *   plans: [{ id, name, adopted, classId, status: 'active' | 'retired',
 *             retiredAt?, expires?, awardTypes: ['option' | 'rsu'],
 *             reserve, reserveHistory: [{ date, before, after, seq, kind,
 *             reason?, transferId?, planId?, splitId? }],
 *             recycling: { cancellation, expiration, exercise, settlement,
 *             repurchase, transfer } }]
 *
 * `reserve` is the plan's own authorizations net of dated transfers, in today's units,
 * and can be negative when it transfers on recycled inflows. Those inflows
 * offset the debit in its authorized balance. `reserveHistory` records
 * every dated change to it in the order recorded: the
 * adoption, resizes, round top-ups, transfers between plans (linked by
 * `transferId`, naming the other plan in `planId`), and the restatement a
 * split made (`splitId`). Each entry carries the size before and after it
 * in the units of its own day, which is what lets a snapshot of an earlier
 * date read the reserve as it stood - see reserveAsOf.
 *
 * An award names its plan in `planId`, or says it sits outside every plan
 * with `outsidePlan: true`. Its plan's committed count is what the awards
 * themselves record: granted, less whatever the plan's recycling rules hand
 * back. Nothing about a forfeiture is written down twice - the movement is
 * read off the award's own history (see awardMovements), so an undo, an
 * as-of date or a split reconciles on its own.
 *
 * `company.poolAuthorized` and `company.poolHistory` are the aggregate of
 * the plans, kept in step by the store for everything written before plans
 * existed. A company that has only those reads as one plan - see plansOf.
 */

/** The id a company's one pre-existing reserve is read under. */
export const LEGACY_PLAN_ID = 'plan-legacy';
export const LEGACY_PLAN_NAME = 'Equity Incentive Plan';
export const PLAN_NAME_MAX = 80;
export const PLAN_REASON_MAX = 200;

/** The award kinds a plan can be written for. */
export const PLAN_AWARD_TYPES = [
  { value: 'option', label: 'Option grants', noun: 'option grants' },
  { value: 'rsu', label: 'RSU awards', noun: 'RSU awards' },
];

/**
 * The lifecycle events a plan's recycling rules speak to. Each rule says
 * where the shares an event touches go: back into the plan's available
 * reserve ('return'), out of the reserve for good ('retire'), or into
 * another plan (that plan's id) - the pour-over a successor plan is written
 * with.
 */
export const RECYCLING_EVENTS = [
  { value: 'cancellation', label: 'Cancellation', hint: 'Unvested awards forfeited on a departure, or cancelled by hand.' },
  { value: 'expiration', label: 'Expiration', hint: 'Vested options that lapsed unexercised when the grant’s window closed.' },
  { value: 'exercise', label: 'Exercise', hint: 'Options the holder bought. Exercised options stay drawn from the plan unless this says otherwise.' },
  { value: 'settlement', label: 'Settlement', hint: 'RSU units settled into shares. Settled units stay drawn from the plan unless this says otherwise.' },
  { value: 'repurchase', label: 'Repurchase', hint: 'Shares from an exercise or settlement the company bought back.' },
  { value: 'transfer', label: 'Transfer', hint: 'Shares from an exercise or settlement sold on to another holder.' },
];

export const RECYCLING_RULES = [
  { value: 'return', label: 'Return to this plan' },
  { value: 'retire', label: 'Leave the reserve for good' },
];

/**
 * The convention the one company-wide pool always followed: cancelled and
 * lapsed awards go back on the shelf, and exercised or settled awards stay
 * drawn from the reserve whatever happens to the shares afterwards.
 */
export const DEFAULT_RECYCLING = Object.freeze({
  cancellation: 'return', expiration: 'return',
  exercise: 'retire', settlement: 'retire', repurchase: 'retire', transfer: 'retire',
});

/** A plan's rule for an event: 'return', 'retire', or a successor plan's id. */
export function recyclingRule(plan, event) {
  const rule = plan?.recycling?.[event];
  return rule === undefined || rule === null || rule === '' ? (DEFAULT_RECYCLING[event] || 'retire') : String(rule);
}

/**
 * A plan's net reserve before derived recycling, in today's units: the figure on
 * the record, or the end of its dated history when a record carries only
 * that.
 */
export function planReserve(plan) {
  const n = Number(plan?.reserve);
  if (Number.isFinite(n)) return Math.round(n);
  const last = (Array.isArray(plan?.reserveHistory) ? plan.reserveHistory : []).at(-1);
  return last ? Math.round(Number(last.after) || 0) : 0;
}

/** Restate a net reserve, including transfers of shares received by recycling. */
export function scalePlanReserve(value, factor) {
  return value === 0 ? 0 : Math.sign(value) * Math.max(1, Math.round(Math.abs(value) * factor));
}

/** The award kinds a plan is written for; a plan that says nothing takes both. */
export function planAwardTypes(plan) {
  const types = (Array.isArray(plan?.awardTypes) ? plan.awardTypes : [])
    .filter((t) => t === 'option' || t === 'rsu');
  return types.length ? [...new Set(types)] : ['option', 'rsu'];
}

/** Whether a plan is still open to new awards: not retired. */
export function planIsOpen(plan) {
  return !!plan && plan.status !== 'retired';
}

/**
 * Whether a plan can hold an award of `kind` dated `date`: it is written for
 * that kind, was adopted by then, had not expired, and - once retired - the
 * award dates from before the retirement. With no date, only the kind and
 * whether the plan is still open are asked.
 */
export function planAccepts(plan, kind, date = '') {
  if (!plan || !planAwardTypes(plan).includes(kind)) return false;
  if (!date) return planIsOpen(plan);
  if (plan.adopted && date < plan.adopted) return false;
  if (plan.expires && date > plan.expires) return false;
  if (plan.status === 'retired' && plan.retiredAt && date > plan.retiredAt) return false;
  if (plan.status === 'retired' && !plan.retiredAt) return false;
  return true;
}

/* Why planAccepts said no, in a sentence that names the plan. */
export function planRefusal(plan, kind, date = '') {
  const noun = kind === 'rsu' ? 'RSU award' : 'option grant';
  const only = PLAN_AWARD_TYPES.filter((t) => planAwardTypes(plan).includes(t.value)).map((t) => t.noun);
  if (!planAwardTypes(plan).includes(kind)) return `${plan.name} is written for ${only.join(' and ')} only.`;
  if (date && plan.adopted && date < plan.adopted) return `${plan.name} was adopted on ${plan.adopted}, after this ${noun} is dated.`;
  if (date && plan.expires && date > plan.expires) return `${plan.name} expired on ${plan.expires}, before this ${noun} is dated.`;
  if (plan.status === 'retired') {
    return plan.retiredAt && (!date || date > plan.retiredAt)
      ? `${plan.name} was retired on ${plan.retiredAt}${date ? ', before this ' + noun + ' is dated' : ''}.`
      : `${plan.name} has been retired.`;
  }
  return '';
}

/*
 * The one plan a company kept before plans existed, built from the pool
 * fields on its record - and remembered per company object, since the math
 * asks for it on every render. Revalidated against the two fields it reads,
 * so a company mutated in place reads its new pool.
 */
const legacyPlans = new WeakMap();
export function legacyPlan(company) {
  if (!company || typeof company !== 'object') return null;
  const reserve = Math.max(0, Math.round(Number(company.poolAuthorized) || 0));
  const history = Array.isArray(company.poolHistory) ? company.poolHistory : [];
  const known = legacyPlans.get(company);
  if (known && known.reserve === reserve && known.history === history) return known.plan;
  /* Adopted on no recorded date: the pool never had one, and reading its
     first resize as the adoption would refuse a grant backfilled from before
     it - which the one pool always took. */
  const plan = !(reserve > 0) && !history.length ? null : {
    id: LEGACY_PLAN_ID,
    name: LEGACY_PLAN_NAME,
    adopted: '',
    classId: '',
    status: 'active',
    awardTypes: ['option', 'rsu'],
    reserve,
    reserveHistory: history.map((c, i) => {
      const entry = {
        date: c.date, before: Math.max(0, Math.round(Number(c.before) || 0)),
        after: Math.max(0, Math.round(Number(c.after) || 0)),
        kind: i === 0 && !(Number(c.before) > 0) ? 'adoption' : 'resize',
      };
      if (Number(c.seq) > 0) entry.seq = Number(c.seq);
      return entry;
    }),
    recycling: { ...DEFAULT_RECYCLING },
    createdAt: 0,
  };
  legacyPlans.set(company, { reserve, history, plan });
  return plan;
}

/**
 * The plans a company's awards draw from: the ones on its record, or the
 * one its pool fields describe when it has none - so a company written
 * before plans existed does exactly what it did, to the share. Nothing
 * reserved and no history is no plan at all.
 */
export function plansOf(company) {
  const plans = Array.isArray(company?.plans) ? company.plans : [];
  if (plans.length) return plans;
  const legacy = legacyPlan(company);
  return legacy ? [legacy] : [];
}

/** A plan by id, or null. */
export function planById(company, planId) {
  return plansOf(company).find((p) => p.id === planId) || null;
}

/**
 * Which plan an award draws from, as `{ planId, candidates }`.
 *
 * An award that names a plan on the list draws from it; one that says it
 * sits outside every plan draws from none. An award that says neither - a
 * record written before plans existed, a row of a spreadsheet with no plan
 * column - takes the one plan when there is one, as every award did under
 * the single pool. Among several it takes the only plan that could hold an
 * award of its kind on its date; when more than one could, `candidates`
 * lists them and `planId` is null, and the import that brought it in is
 * asked to say which (see the store). No plan at all is outside.
 */
export function resolvePlan(award, plans) {
  const list = Array.isArray(plans) ? plans : [];
  if (award?.kind !== 'option' && award?.kind !== 'rsu') return { planId: null, candidates: [] };
  if (award.outsidePlan === true) return { planId: null, candidates: [] };
  if (award.planId && list.some((p) => p.id === award.planId)) return { planId: award.planId, candidates: [] };
  if (!list.length) return { planId: null, candidates: [] };
  if (list.length === 1) return { planId: list[0].id, candidates: [] };
  const candidates = list.filter((p) => planAccepts(p, award.kind, securityDate(award)));
  return { planId: candidates.length === 1 ? candidates[0].id : null, candidates };
}

/** The plan an award draws from, or null for one outside every plan. */
export function awardPlanId(award, plans) {
  return resolvePlan(award, plans).planId;
}

/*
 * Every event that has ever moved a plan's reserve, in the order it was
 * applied: the company's splits - read through the exact figures the plan
 * wrote down for each, or, for the one pre-existing reserve, through the
 * rounding note the split itself left - and the plan's own dated changes.
 * Splits from before the sequence existed sort first, in date order.
 */
function reserveEvents(plan, company) {
  const entries = Array.isArray(plan?.reserveHistory) ? plan.reserveHistory : [];
  const noted = new Map(entries.filter((e) => e.splitId).map((e) => [e.splitId, e]));
  const splits = (company?.splits || []).map((split, i) => ({
    date: split.date, seq: Number(split.seq) || 0, i, split, entry: noted.get(split.id) || null,
  }));
  const changes = entries.filter((e) => !e.splitId).map((change, i) => ({
    date: change.date, seq: Number(change.seq) || 0, i: splits.length + i, change,
  }));
  return [...splits, ...changes].sort((a, b) => a.seq - b.seq || a.i - b.i);
}

/*
 * Whether the aggregate rounding note a split left (`poolBefore`/`poolAfter`)
 * is this plan's to read where the plan wrote no figure of its own. A split
 * recorded since plans existed writes every plan's figure into its history;
 * one from before that restated the one pre-existing reserve alone - so the
 * note is that reserve's, whether or not the company has adopted other
 * plans since. A company with one plan reads the note whatever the plan is
 * called, as the pool always did.
 */
function readsSplitNote(plan, company) {
  return plan?.id === LEGACY_PLAN_ID || plansOf(company).length <= 1;
}

/**
 * A plan's reserve as it stood on a date, in the units of that date.
 *
 * Walked back through the events dated after `asOf` in the order they were
 * applied - each change reads the size before it, a split the size the plan
 * wrote down before the restatement - and forward again through any among
 * them that had already happened by that date (see splitWalk), so a
 * historical split entered behind a later-dated resize still reads right. A
 * reserve set before its changes were recorded reads its current size on
 * every earlier date, restated through the splits alone, as the pool did.
 * The aggregate rounding note a split left (`poolBefore`/`poolAfter`) stands
 * in where the plan has no figure of its own, which is only ever the one
 * pre-existing reserve.
 */
export function reserveAsOf(plan, company, asOf) {
  const current = planReserve(plan);
  if (!asOf) return current;
  const events = reserveEvents(plan, company);
  const first = events.findIndex((e) => e.date > asOf);
  if (first < 0) return current;
  const tail = events.slice(first);
  const noted = readsSplitNote(plan, company);
  let value = current;
  for (const e of tail.slice().reverse()) {
    if (e.change) value = Math.round(Number(e.change.before) || 0);
    else if (e.entry) value = Math.round(Number(e.entry.before) || 0);
    else if (noted && e.split.poolAfter > 0 && value === e.split.poolAfter) value = e.split.poolBefore;
    else value = scalePlanReserve(value, e.split.den / e.split.num);
  }
  for (const e of tail) {
    if (e.date > asOf) continue;
    if (e.split) {
      value = scalePlanReserve(value, e.split.num / e.split.den);
      continue;
    }
    /* A change is recorded in the units of its day - after every split
       applied before it. Read on a date the walk left some of those splits
       undone, its size scales back through them. */
    let f = 1;
    for (const x of tail) if (x.split && x.date > asOf && x.seq < e.seq) f *= x.split.den / x.split.num;
    const after = Math.round(Number(e.change.after) || 0);
    value = scalePlanReserve(after, f);
  }
  return value;
}

/*
 * The event a forfeiture is: an expiration when it falls on the day the
 * grant's window closed (its term, or the post-termination deadline a
 * departure set), a cancellation otherwise. Units have no window to close.
 */
function forfeitureEvent(award, forfeiture) {
  if (award.kind !== 'option') return 'cancellation';
  const cutoff = exerciseCutoff(award);
  return cutoff && forfeiture.date === cutoff ? 'expiration' : 'cancellation';
}

/**
 * Every movement of a plan's balances that the awards themselves record,
 * worked out from the records rather than written down beside them.
 *
 * A grant draws its quantity from its plan on its grant date. Each later
 * event on the award - a forfeiture, an exercise or settlement (dated by its
 * certificate; the counter's undated remainder is placed on the grant date
 * and flagged), a repurchase or a transfer of the shares those produced -
 * is read through the plan's rule for it: 'return' hands the shares back
 * (committed falls), 'retire' leaves them drawn (a movement of nothing,
 * kept so the ledger can say so), and a successor plan's id pours them
 * over (they leave this plan's authorized and committed counts together and
 * arrive in the other plan's authorized count, on the same day, once).
 *
 * Each row: { planId, date, event, quantity, rule, awardId, label,
 * authorized, committed, counterpartyPlanId?, undated? } - `authorized` and
 * `committed` being the signed effect on that plan's two figures.
 */
export function awardMovements(db, plans = plansOf(db.company)) {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const out = [];
  const certs = new Map();
  const legs = new Map();
  for (const s of db.securities) {
    if (s.kind !== 'shares') continue;
    const awardId = s.fromOptionId || s.fromRsuId;
    if (awardId) certs.set(awardId, [...(certs.get(awardId) || []), s]);
    if (s.fromTransferId) legs.set(s.fromTransferId, [...(legs.get(s.fromTransferId) || []), s]);
  }
  const push = (plan, award, event, quantity, date, extra = {}) => {
    if (!(quantity > 0)) return;
    const rule = recyclingRule(plan, event);
    const base = { planId: plan.id, date, event, quantity, rule, awardId: award.id, label: award.label, ...extra };
    if (rule === 'retire') out.push({ ...base, authorized: 0, committed: 0 });
    else if (rule === 'return' || !byId.has(rule) || rule === plan.id) {
      out.push({ ...base, rule: 'return', authorized: 0, committed: -quantity });
    } else {
      out.push({ ...base, authorized: -quantity, committed: -quantity, counterpartyPlanId: rule });
      out.push({
        ...base, planId: rule, rule: 'pour-over', authorized: quantity, committed: 0, counterpartyPlanId: plan.id,
      });
    }
  };
  for (const s of db.securities) {
    if (s.kind !== 'option' && s.kind !== 'rsu') continue;
    const planId = awardPlanId(s, plans);
    if (!planId) continue;
    const plan = byId.get(planId);
    const units = s.kind === 'rsu';
    const granted = securityDate(s);
    const quantity = issuedQty(s);
    out.push({
      planId, date: granted, event: 'grant', quantity, rule: 'draw', awardId: s.id, label: s.label,
      authorized: 0, committed: quantity,
    });
    for (const c of cancellationHistory(s)) push(plan, s, forfeitureEvent(s, c), c.quantity, c.date || granted);
    const mine = certs.get(s.id) || [];
    const originals = mine.filter((c) => !c.fromTransferId && (units ? c.fromRsuId : c.fromOptionId) === s.id);
    let dated = 0;
    for (const c of originals) {
      dated += issuedQty(c);
      push(plan, s, units ? 'settlement' : 'exercise', issuedQty(c), c.date || granted, { certificateId: c.id });
    }
    const undated = (units ? rsuSettled(s) : grantExercised(s)) - dated;
    if (undated > 0) push(plan, s, units ? 'settlement' : 'exercise', undated, granted, { undated: true });
    // Once issuance returns or pours over a share, it no longer draws this
    // plan. Its later sale or repurchase cannot return that same share again.
    if (recyclingRule(plan, units ? 'settlement' : 'exercise') !== 'retire') continue;
    const certificates = new Map(mine.map((c) => [c.id, c]));
    const stillDrawn = (certificate) => {
      const seen = new Set();
      let child = certificate;
      while (child.fromTransferId && !seen.has(child.id)) {
        seen.add(child.id);
        const parent = certificates.get(child.fromTransferId);
        if (!parent) break;
        // Only the sold branch was recycled. The original holder's retained
        // shares still draw the plan and can be recycled on their own later.
        if (parent.closedReason !== 'repurchase' && parent.stakeholderId !== child.stakeholderId
          && recyclingRule(plan, 'transfer') !== 'retire') return false;
        child = parent;
      }
      return true;
    };
    /* The shares an exercise or settlement produced, wherever they went
       since: a certificate the company bought back, or one sold on. A
       transfer leg carries the award's provenance too, so its own later
       repurchase or sale is read here as well. */
    for (const c of mine) {
      if (!c.closedAt || !stillDrawn(c)) continue;
      const children = legs.get(c.id) || [];
      if (c.closedReason === 'repurchase') {
        const retired = Number(c.repurchasedQty) > 0
          ? Math.min(issuedQty(c), Math.round(Number(c.repurchasedQty)))
          : Math.max(0, issuedQty(c) - children.reduce((a, l) => a + issuedQty(l), 0));
        push(plan, s, 'repurchase', retired, c.closedAt, { certificateId: c.id });
      } else {
        const sold = children.filter((l) => l.stakeholderId !== c.stakeholderId).reduce((a, l) => a + issuedQty(l), 0);
        push(plan, s, 'transfer', sold || Math.max(0, issuedQty(c) - children.reduce((a, l) => a + issuedQty(l), 0)), c.closedAt, { certificateId: c.id });
      }
    }
  }
  return out;
}

/**
 * Every plan's balances as the records stand, and the company's aggregate.
 *
 * Per plan: `reserve` is what the plan itself authorized; `authorized` adds
 * what other plans' rules poured into it and takes off what its own rules
 * poured out; `committed` is what its awards draw - granted, less what the
 * rules handed back; `available` is the difference, and may be negative
 * where imported awards outran the reserve. `eligible` says whether the plan
 * is still open to new awards, which is what decides whether its available
 * shares sit in the fully diluted count (a retired plan's do not).
 *
 * `total` sums the plans; `total.unallocated` is the fully diluted count's
 * pool row: every open plan's available shares, none below zero. `outside`
 * counts the awards that draw from no plan at all.
 *
 * For a past date, hand this the snapshot dbAsOf builds: its awards, their
 * forfeitures and every plan's reserve already read as of that day.
 */
export function planBalances(db, { plans = plansOf(db.company) } = {}) {
  const movements = awardMovements(db, plans);
  const rows = plans.map((plan) => {
    const mine = movements.filter((m) => m.planId === plan.id);
    let committed = 0;
    let pouredIn = 0;
    let pouredOut = 0;
    let granted = 0;
    let returned = 0;
    let retired = 0;
    let awards = 0;
    for (const m of mine) {
      committed += m.committed;
      if (m.authorized > 0) pouredIn += m.authorized;
      else if (m.authorized < 0) pouredOut -= m.authorized;
      if (m.event === 'grant') { granted += m.quantity; awards += 1; }
      else if (m.rule === 'retire') retired += m.quantity;
      else if (m.rule !== 'pour-over') returned += m.quantity;
    }
    const reserve = planReserve(plan);
    const authorized = reserve + pouredIn - pouredOut;
    const eligible = planIsOpen(plan);
    return {
      plan, planId: plan.id, name: plan.name, reserve, pouredIn, pouredOut, authorized, committed,
      available: authorized - committed, granted, returned, retired, awards, eligible,
      unallocated: eligible ? Math.max(0, authorized - committed) : 0,
    };
  });
  const total = rows.reduce((a, r) => ({
    reserve: a.reserve + r.reserve, authorized: a.authorized + r.authorized, committed: a.committed + r.committed,
    available: a.available + r.available, unallocated: a.unallocated + r.unallocated, granted: a.granted + r.granted,
  }), { reserve: 0, authorized: 0, committed: 0, available: 0, unallocated: 0, granted: 0 });
  let outsideCount = 0;
  let outsideOutstanding = 0;
  for (const s of db.securities) {
    if ((s.kind !== 'option' && s.kind !== 'rsu') || awardPlanId(s, plans)) continue;
    outsideCount += 1;
    outsideOutstanding += grantOutstanding(s);
  }
  return { plans: rows, total, outside: { count: outsideCount, outstanding: outsideOutstanding }, movements };
}

/** One plan's balances, or null. */
export function planBalance(db, planId) {
  return planBalances(db).plans.find((r) => r.planId === planId) || null;
}

/**
 * Refuse an award write that creates or worsens a plan shortfall on any day.
 * A later top-up or return cannot fund an earlier grant. Existing imported
 * overruns remain correctable when the edit leaves them no worse.
 *
 * Sweep the dated movements once, including intervening grants and resizes.
 * Before a split, use exact snapshots for the affected days: today's rounded
 * counts cannot reconstruct the original units by division alone.
 */
export function planCapacityError(db, securities) {
  if (!plansOf(db.company).length || securities === db.securities) return null;
  const hit = reserveShortfall(db, { ...db, securities });
  if (!hit) return null;
  /* The sweep reads each day in its own units, so a day before a split is
     in that day's shares while the award is typed in today's: said alone,
     "500 more shares" on a 1-for-7 table was 71 of the shares the user
     types. Both are said when they differ, as the reserve refusals do. */
  const factor = hit.date ? unsplitFactor(db.company, hit.date) : 1;
  const today = factor === 1 ? hit.shortfall : Math.ceil(hit.shortfall / factor - 1e-9);
  return `${hit.plan.name} would have ${hit.shortfall} more shares committed than reserved${hit.date ? ` on ${hit.date}` : ''}`
    + `${today !== hit.shortfall ? ` (${today} in today’s shares)` : ''}. `
    /* "The award" named the wrong record when the write was a certificate
       edit that moved an exercise's return: the record being saved is what
       has to move, whatever kind it is. */
    + 'Correct this record, or record the reserve available on that date first.';
}

/**
 * The first day a change to the table leaves a plan with more committed
 * than reserved, and worse off than it was: `{ plan, date, shortfall,
 * reserve }` - the reserve as it stood that day, in the day's units - or
 * null. `before` and `after` are whole tables: the same company under
 * different securities (an award written), or the same securities under a
 * different company (a reserve resized or moved as of a past date). Either
 * way a later top-up or return cannot fund an earlier draw, and a reserve
 * shrunk as of June cannot be smaller than what June's grants had drawn -
 * held only to today's commitments, such a resize wrote a shortfall that
 * every later award dated inside it was then refused for.
 * A plan `after` has and `before` does not - the first pool, adopted as of
 * a past date over awards already on the table - reserved nothing before,
 * so every day from its adoption on that it reads short is a shortfall the
 * adoption writes. The days before that are not its to answer for: there was
 * no plan to be short, and the one pool has always taken a grant dated
 * before it was adopted (see poolResized). Swept too, a pool of 500 adopted
 * today over a 100-option grant from last year was refused as smaller than
 * the 100 it "had granted from it" on the grant date.
 *
 * Sweep the dated movements once, including intervening grants and resizes.
 * Before a split, use exact snapshots for the affected days: today's rounded
 * counts cannot reconstruct the original units by division alone.
 */
export function reserveShortfall(before, after) {
  const plans = plansOf(after.company);
  if (!plans.length) return null;
  const priors = new Map(plansOf(before.company).map((p) => [p.id, p]));
  const books = new Map(plans.map((p) => [p.id, new Map()]));
  const day = (book, date) => {
    if (!book.has(date)) book.set(date, { before: 0, after: 0 });
    return book.get(date);
  };
  /* Each table's movements under its own plans' rules. Read under the
     after-table's rules on both sides, a recycling rule turned from return
     to retire left the two books identical, and the change was never swept:
     a return that had funded a later grant was re-committed on its day
     without a word (see #assertReservesHold). */
  for (const [key, source] of [['before', before], ['after', after]]) {
    for (const m of awardMovements(source, key === 'after' ? plans : plansOf(source.company))) {
      const book = books.get(m.planId);
      if (book) day(book, m.date)[key] += m.authorized - m.committed;
    }
  }
  const splits = after.company.splits || [];
  const lastSplit = splits.reduce((last, s) => (s.date > last ? s.date : last), '');
  const snapshots = new Map();
  for (const plan of plans) {
    const prior = priors.get(plan.id) || null;
    const book = books.get(plan.id);
    const moved = !prior
      || [...book.values()].some((v) => v.before !== v.after)
      || planReserve(plan) !== planReserve(prior)
      || (plan.reserveHistory?.length || 0) !== (prior.reserveHistory?.length || 0);
    if (!moved) continue;
    for (const e of reserveEvents(plan, after.company)) day(book, e.date);
    if (prior) for (const e of reserveEvents(prior, before.company)) day(book, e.date);
    /* The day a plan with no prior came to be: its adoption, or the first
       reserve it wrote down. Every day before it is read past, running totals
       kept, since nothing was there to be short. */
    const since = prior ? '' : plan.adopted
      || reserveEvents(plan, after.company).filter((e) => e.change).map((e) => e.date).sort()[0] || '';
    let ranBefore = 0;
    let ranAfter = 0;
    for (const [date, change] of [...book].sort(([a], [b]) => a.localeCompare(b))) {
      ranBefore += change.before;
      ranAfter += change.after;
      if (!prior && date < since) continue;
      let was;
      let now;
      if (date && date < lastSplit) {
        if (!snapshots.has(date)) {
          snapshots.set(date, [before, after].map((source) =>
            new Map(planBalances(dbAsOf(source, date)).plans.map((p) => [p.planId, p.available]))));
        }
        const [oldRows, newRows] = snapshots.get(date);
        was = oldRows.get(plan.id) || 0;
        now = newRows.get(plan.id) || 0;
      } else {
        /* No prior: the plan did not exist, so nothing was short - the same
           zero the snapshot above reads for a plan the earlier table lacks.
           Compared against itself, a first pool dated back over the awards
           it now holds passed every day, and wrote the shortfall. */
        was = prior ? reserveAsOf(prior, before.company, date) + ranBefore : 0;
        now = reserveAsOf(plan, after.company, date) + ranAfter;
      }
      if (now < 0 && now < was) {
        return { plan, date, shortfall: -now, reserve: reserveAsOf(plan, after.company, date) };
      }
    }
  }
  return null;
}

/**
 * How a plan got from nothing to where it stands: every dated movement of
 * its authorized and committed counts, with the running balance after each,
 * in today's share units. The reserve's own changes come off its history
 * and the award movements off the awards; a split is a restatement, so it
 * appears with the rounding it left and nothing else.
 *
 * Rows: { date, kind, label, detail, authorized, committed, available,
 * balance: { authorized, committed, available } }, oldest first; ties in
 * date keep the reserve's changes ahead of the awards'. `opening` is the
 * empty plan and `closing` its balances today, and `reconciles` says that
 * opening plus every row's movement is exactly the closing - which it is by
 * construction, and the test suite holds it to.
 */
export function planLedger(db, planId) {
  const company = db.company;
  const plan = planById(company, planId);
  if (!plan) return null;
  const all = planBalances(db);
  const balances = all.plans.find((r) => r.planId === planId) || null;
  const splits = new Map((company.splits || []).map((sp) => [sp.id, sp]));
  // Legacy reserves predate per-plan split entries (and sometimes all dated
  // history). Recover their recorded states from the same walk as reserveAsOf.
  let openingReserve = planReserve(plan);
  const noted = readsSplitNote(plan, company);
  const entries = reserveEvents(plan, company).reverse().map((event) => {
    const recorded = event.change || event.entry;
    if (recorded) {
      openingReserve = Number(recorded.before) || 0;
      return recorded;
    }
    const after = openingReserve;
    const split = event.split;
    openingReserve = noted && split.poolAfter > 0 && after === split.poolAfter
      ? split.poolBefore : scalePlanReserve(after, split.den / split.num);
    return { date: split.date, before: openingReserve, after, kind: 'split', splitId: split.id };
  }).reverse();
  /* A change recorded before a split is in the units of its day; restated
     through every split recorded since, it reads in today's. The figure the
     split wrote down after rounding is what the plan actually held, so the
     row for the split carries only the difference the rounding made. */
  const laterSplits = (index) => entries.slice(index + 1).filter((e) => e.splitId && splits.has(e.splitId)).map((e) => splits.get(e.splitId));
  const restate = (value, index) => laterSplits(index).reduce((v, sp) => scalePlanReserve(v, sp.num / sp.den), value);
  const rows = [];
  let previous = 0;
  if (openingReserve !== 0) {
    previous = restate(openingReserve, -1);
    rows.push({ date: '', order: 0, kind: 'opening', label: 'Reserve before recorded history',
      detail: 'No original reserve date recorded', authorized: previous, committed: 0 });
  }
  entries.forEach((e, i) => {
    const after = restate(Math.round(Number(e.after) || 0), i);
    const delta = after - previous;
    previous = after;
    const split = e.splitId ? splits.get(e.splitId) : null;
    const counterparty = e.planId ? planById(company, e.planId) : null;
    rows.push({
      date: e.date, order: 0, kind: e.kind || 'resize',
      label: e.kind === 'adoption' ? 'Reserve at adoption'
        : e.kind === 'split' ? (split ? `${split.num}-for-${split.den} split` : 'Split')
          : e.kind === 'transfer' ? (delta < 0 ? `Transfer to ${counterparty?.name || 'another plan'}` : `Transfer from ${counterparty?.name || 'another plan'}`)
            : e.kind === 'top-up' ? 'Round top-up' : e.kind === 'retirement' ? 'Retired' : 'Reserve resized',
      detail: e.reason || (e.kind === 'split' ? 'Restated; the movement is the rounding it left' : ''),
      authorized: delta, committed: 0,
    });
  });
  for (const m of all.movements.filter((x) => x.planId === planId)) {
    const detail = m.event === 'grant' ? 'Drawn from the plan'
      : m.rule === 'retire' ? 'Stays drawn; nothing returns to the reserve'
        : m.rule === 'pour-over' ? `Poured over from ${planById(company, m.counterpartyPlanId)?.name || 'another plan'}`
          : m.counterpartyPlanId ? `Poured over into ${planById(company, m.counterpartyPlanId)?.name || 'another plan'}`
            : 'Returned to the reserve';
    rows.push({
      /* A pour-in is its own kind of movement on the plan it lands in: the
         event happened on another plan's award, and labelled by that event
         a plan that never exercised anything showed an "Exercise" row. */
      date: m.date, order: 1, kind: m.rule === 'pour-over' ? 'pour-over' : m.event,
      label: `${m.label}: ${EVENT_LABEL[m.event] || m.event}${m.undated ? ' (no certificate yet)' : ''}`,
      detail, authorized: m.authorized, committed: m.committed, quantity: m.quantity, awardId: m.awardId, informational: m.rule === 'retire',
    });
  }
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.order - b.order);
  let authorized = 0;
  let committed = 0;
  for (const r of rows) {
    authorized += r.authorized;
    committed += r.committed;
    r.available = r.authorized - r.committed;
    r.balance = { authorized, committed, available: authorized - committed };
  }
  const closing = balances
    ? { authorized: balances.authorized, committed: balances.committed, available: balances.available }
    : { authorized: 0, committed: 0, available: 0 };
  return {
    plan, rows, opening: { authorized: 0, committed: 0, available: 0 }, closing,
    reconciles: authorized === closing.authorized && committed === closing.committed,
  };
}

const EVENT_LABEL = {
  grant: 'granted', cancellation: 'cancelled', expiration: 'expired', exercise: 'exercised',
  settlement: 'settled', repurchase: 'repurchased', transfer: 'transferred',
};

/** The date a plan can first be retired: the day of its latest award or reserve change. */
export function planLastActivity(db, planId) {
  const plan = planById(db.company, planId);
  if (!plan) return '';
  const dates = [(plan.reserveHistory || []).map((e) => e.date), db.securities
    .filter((s) => (s.kind === 'option' || s.kind === 'rsu') && awardPlanId(s, plansOf(db.company)) === planId)
    .map((s) => securityDate(s))].flat().filter(Boolean);
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : plan.adopted || '';
}

/**
 * The new reserve a destination plan needs so that the company's
 * unallocated count lands exactly on `unallocatedAfter` once a round closes:
 * its own reserve plus the top-up, plus whatever its awards had outrun the
 * reserve by, since a negative available reads as nothing in the count.
 */
export function topUpReserve(db, planId, unallocatedAfter) {
  const balances = planBalances(db);
  const target = balances.plans.find((r) => r.planId === planId);
  if (!target) return null;
  const others = balances.total.unallocated - target.unallocated;
  const need = Math.max(0, Math.round(Number(unallocatedAfter) || 0) - others);
  // The reserve that leaves exactly `need` available, and never a smaller one.
  return Math.max(target.reserve, target.reserve - target.available + need);
}

/** Instruments that occupy a slot in the fully diluted base. */
export function countsInDiluted(security) {
  return security.kind === 'shares' || security.kind === 'option'
    || security.kind === 'rsu' || security.kind === 'warrant';
}

/**
 * Both plan-award indexes over one securities array, built in a pass each.
 *
 * Option grants and RSU awards net against certificates of their own kind,
 * under different keys - so a caller walking a mixed array has to hand each
 * kind its own index. Handing an award the option index reads its certified
 * units back as zero, which counts the shares it already settled into twice:
 * once on the certificate, once inside the award. `dilutedShares` takes this
 * pair and dispatches, so the mistake is not available to make.
 */
export function certifiedIndexes(securities) {
  return { byGrant: certifiedByGrant(securities), byRsu: certifiedByRsu(securities), byWarrant: certifiedByWarrant(securities) };
}

/** Shares one security contributes to the diluted base. Takes the securities
 *  array, the `certifiedIndexes` pair over it, or - for a caller handling one
 *  kind - that kind's own index. */
export function dilutedShares(security, securities) {
  if (security.kind === 'shares') return qty(security);
  if (security.kind === 'warrant') return warrantRemaining(security, securities?.byWarrant || securities);
  /* The pair, when given one: each kind is handed the index built for it.
     A bare array or a single kind's Map passes straight through, which is
     what keeps every existing caller reading exactly as it did. */
  const pair = securities && !Array.isArray(securities) && !(securities instanceof Map)
    ? securities : null;
  if (security.kind === 'option') return grantDiluted(security, pair ? pair.byGrant : securities);
  if (security.kind === 'rsu') return rsuDiluted(security, pair ? pair.byRsu : securities);
  return 0;
}

/**
 * Fully diluted share count: issued shares + live options + unsettled RSUs +
 * warrants (+ the unallocated pool unless excluded). `pool` is the company
 * record, or a single reserve's size - see poolRemaining.
 */
export function fullyDiluted(securities, pool, { includePool = true } = {}) {
  return sharesOutstanding(securities)
    + optionsDiluted(securities)
    + rsusDiluted(securities)
    + warrantsOutstanding(securities)
    + (includePool ? poolRemaining(pool, securities) : 0);
}

export function issuedInClass(securities, classId) {
  return securities
    .filter((s) => s.kind === 'shares' && s.classId === classId)
    .reduce((a, s) => a + qty(s), 0);
}

/**
 * How far a class would run past its authorized count once `quantity` more
 * shares are issued into it: `{ name, issued, authorized, over }`, or null
 * when the class is unknown or has no authorized count on file. `excluding`
 * names a certificate whose current size is left out, for an edit that
 * resizes or reclasses that certificate.
 *
 * Issuing past the charter is a real state, not a rounding error - the
 * classes table says "over authorized" once it has happened - so every
 * sheet that issues shares says it before the write instead, the way the
 * round close does. Nothing here refuses: the record follows the paper.
 */
export function authorizedOverrun(db, classId, quantity, { excluding = null } = {}) {
  const cls = (db.classes || []).find((c) => c.id === classId);
  if (!cls || !(cls.authorized > 0)) return null;
  const issued = db.securities.reduce((a, s) => (
    s.kind === 'shares' && s.classId === classId && s.id !== excluding ? a + qty(s) : a), 0);
  const adding = Math.max(0, Math.round(Number(quantity) || 0));
  return { name: cls.name, issued, authorized: cls.authorized, over: Math.max(0, issued + adding - cls.authorized) };
}

/** A SAFE or note that a closed round has already turned into shares. */
export function isConverted(security) {
  return !!security.convertedAt;
}

/**
 * A note whose maturity has been recorded as dealt with: repaid, extended in
 * writing, or settled outside the app. The instrument stays exactly where it
 * was - this records that the date was handled, nothing more.
 */
export function isMatured(security) {
  return !!security.maturedAt;
}

/** Live convertibles: the ones still waiting for a priced round. */
export function convertibles(securities) {
  return securities.filter((s) => (s.kind === 'safe' || s.kind === 'note') && !isConverted(s));
}

/**
 * The earliest anti-dilution certificate dated after `asOf`, with its class -
 * a down round already on the books that adjusted a conversion price after
 * the day a round is being modeled on. A class's conversion price carries no
 * history, so the snapshot of that day (see dbAsOf) drops the round's minted
 * shares while the class still reads the price the round lowered it to: a
 * round priced on it measures protection from a price not yet in force, and
 * sizes its own adjustment against shares that are not there. Null when no
 * adjustment postdates the day.
 */
export function adjustedAfter(db, asOf) {
  let hit = null;
  for (const s of db.securities) {
    if (!isAntiDilutionShares(s) || !(securityDate(s) > asOf)) continue;
    if (!hit || securityDate(s) < securityDate(hit)) hit = s;
  }
  if (!hit) return null;
  return { certificate: hit, date: securityDate(hit), cls: db.classes.find((c) => c.id === hit.classId) || null };
}

/**
 * The instrument a modeled round would convert that a round already on the
 * books converted after the model date: the live record, with the day it
 * converted. The model reads the table as of its date (see dbAsOf), so dated
 * before a recorded round it reads that round's instruments as live again and
 * lists them converting; the close refuses to convert one twice. Null when
 * every modeled conversion is of an instrument still live today.
 */
export function convertedAfter(result, asOf, db) {
  for (const c of result?.conversions || []) {
    const live = db.securities.find((s) => s.id === c.securityId);
    if (live?.convertedAt && live.convertedAt > asOf) return live;
  }
  return null;
}

/**
 * Principal a convertible instrument represents (notes accrue simple
 * interest, actual days over 365). Interest stops the day a note converts -
 * the balance became shares then - so a converted note reads the same on
 * every later date.
 */
export function convertibleValue(security, asOf) {
  const principal = Math.max(0, Number(security.principal) || 0);
  if (security.kind !== 'note') return principal;
  const until = security.convertedAt && (!asOf || security.convertedAt < asOf)
    ? security.convertedAt
    : asOf;
  const rate = Math.max(0, Number(security.interestRate) || 0) / 100;
  return principal * (1 + rate * accrualYears(security.date, until));
}

/* ---------- Ownership tables ---------- */

/**
 * Per-stakeholder ownership rows for a base ('outstanding' | 'diluted').
 * Rows carry both the share count in that base and its fraction of the
 * base total; `includePool` adds the unallocated pool as its own row
 * (only meaningful for the diluted base).
 */
export function ownershipByStakeholder(db, { base = 'diluted', includePool = true } = {}) {
  const usePool = base === 'diluted' && includePool;
  const certified = base === 'diluted' ? certifiedIndexes(db.securities) : null;
  const counts = new Map();
  for (const s of db.securities) {
    let n = 0;
    if (s.kind === 'shares') n = qty(s);
    else if (base === 'diluted') n = dilutedShares(s, certified);
    if (n > 0) counts.set(s.stakeholderId, (counts.get(s.stakeholderId) || 0) + n);
  }
  const reserves = usePool ? planBalances(db) : null;
  const pool = reserves ? reserves.total.unallocated : 0;
  const total = [...counts.values()].reduce((a, b) => a + b, 0) + pool;
  const holders = new Map(db.stakeholders.map((h) => [h.id, h]));
  const rows = [];
  for (const [stakeholderId, n] of counts) {
    if (n <= 0) continue;
    const holder = holders.get(stakeholderId) || null;
    rows.push({
      stakeholderId,
      name: holder?.name || 'Unknown holder',
      kind: holder?.kind || 'other',
      shares: n,
      pct: total > 0 ? n / total : 0,
    });
  }
  rows.sort((a, b) => b.shares - a.shares || a.name.localeCompare(b.name));
  if (pool > 0) {
    rows.push({
      stakeholderId: null, name: 'Option pool (unallocated)', kind: 'pool',
      shares: pool, pct: total > 0 ? pool / total : 0,
      // Which plans the unallocated shares sit in - see poolRows.
      plans: poolRows(reserves, total),
    });
  }
  return { rows, total };
}

/**
 * The unallocated reserve, one row per plan that holds any: the breakdown
 * the cap table lists under the aggregate pool row the ownership tables
 * keep. A company with one plan has one row, named after it.
 */
export function poolRows(balances, total) {
  return balances.plans
    .filter((r) => r.unallocated > 0)
    .map((r) => ({ planId: r.planId, name: r.name, shares: r.unallocated, pct: total > 0 ? r.unallocated / total : 0 }));
}

/**
 * Per-class ownership rows for the same bases. Option grants, unsettled RSU
 * awards, warrants and the unallocated pool appear as pseudo-classes in the
 * diluted base so the rows always sum to the base total - the same total
 * `fullyDiluted` and `ownershipByStakeholder` report, which is what lets the
 * two groupings of one ownership chart agree with each other.
 */
export function ownershipByClass(db, { base = 'diluted', includePool = true } = {}) {
  const rows = [];
  let total = sharesOutstanding(db.securities);
  for (const cls of db.classes) {
    const n = issuedInClass(db.securities, cls.id);
    if (n > 0) rows.push({ classId: cls.id, name: cls.name, shares: n, kind: cls.kind });
  }
  if (base === 'diluted') {
    const granted = optionsDiluted(db.securities);
    if (granted > 0) rows.push({ classId: 'options', name: 'Options granted', shares: granted, kind: 'options' });
    total += granted;
    /* Unsettled units, like option grants: they hold no shares in their class
       yet, so they read as their own row rather than inflating the class they
       will settle into. Left out entirely, they went missing from the base -
       every class's percentage came out high, and the pool row shrank by the
       units the award had drawn with nothing to show where they went. */
    const units = rsusDiluted(db.securities);
    if (units > 0) rows.push({ classId: 'rsus', name: 'RSUs outstanding', shares: units, kind: 'rsus' });
    total += units;
    // Warrants sit outside their underlying class until exercised, so they
    // read as their own row rather than inflating that class's issued count.
    const warrants = warrantsOutstanding(db.securities);
    if (warrants > 0) rows.push({ classId: 'warrants', name: 'Warrants', shares: warrants, kind: 'warrants' });
    total += warrants;
    if (includePool) {
      const reserves = planBalances(db);
      const pool = reserves.total.unallocated;
      if (pool > 0) rows.push({ classId: 'pool', name: 'Option pool (unallocated)', shares: pool, kind: 'pool', reserves });
      total += pool;
    }
  }
  for (const r of rows) {
    r.pct = total > 0 ? r.shares / total : 0;
    if (r.reserves) {
      r.plans = poolRows(r.reserves, total);
      delete r.reserves;
    }
  }
  return { rows, total };
}

/**
 * Most recent priced share issuance → { pricePerShare, date } or null.
 * `classIds` (a Set) restricts the search to those share classes, and `asOf`
 * to issuances that had happened by that date.
 *
 * Ties on the same day go to the highest price: when a round closes, the
 * discounted certificates its SAFEs convert into are issued the same day as
 * the new money, and the round price is the headline number - not the
 * discount the early investors got.
 */
export function latestPricedIssuance(securities, classIds = null, asOf = null) {
  let latest = null;
  for (const s of securities) {
    if (s.kind !== 'shares' || !(Number(s.pricePerShare) > 0)) continue;
    // A certificate dated ahead of the question is a round that has not
    // closed yet, not the latest one that has.
    if (asOf && s.date > asOf) continue;
    /* A transfer successor inherits its source's issue price under the
       transfer's date - old money wearing a new date, not a pricing event.
       Counting it would let a secondary sale of 2023 stock reset the
       implied valuation and flag a "round since the 409A" that never
       happened. */
    if (s.fromTransferId) continue;
    /* An exercise or settlement certificate is issued at the grant's strike
       (or at nothing), years after that price was set. In a company that has
       only ever priced common, one exercise rewrote the implied valuation
       from par to the strike; it is the grant's terms, not a round. */
    if (s.fromOptionId || s.fromRsuId || s.fromWarrantId) continue;
    if (classIds && !classIds.has(s.classId)) continue;
    if (!latest
      || s.date > latest.date
      || (s.date === latest.date && Number(s.pricePerShare) > Number(latest.pricePerShare))) {
      latest = s;
    }
  }
  return latest ? { pricePerShare: Number(latest.pricePerShare) || 0, date: latest.date } : null;
}

/**
 * Implied valuation: latest round price × fully diluted shares (null when
 * unpriced). Preferred issuances set the price whenever any exist: routine
 * par-value common certificates (advisor or founder shares at $0.0001)
 * issued after a priced round must not reset the company's valuation.
 * Companies that have only ever priced common fall back to that price.
 */
export function impliedValuation(db) {
  const preferred = new Set(db.classes.filter((c) => c.kind === 'preferred').map((c) => c.id));
  const priced = (preferred.size ? latestPricedIssuance(db.securities, preferred) : null)
    || latestPricedIssuance(db.securities);
  if (!priced) return null;
  return priced.pricePerShare * fullyDiluted(db.securities, db.company);
}

/* ---------- Fair market value (409A) ---------- */

/** A 409A older than this is past its standard refresh trigger. */
export const FMV_MAX_AGE_MONTHS = 12;

/**
 * The fair market value in force on a date: the most recent recorded
 * valuation dated on or before it. Null when none applies yet.
 *
 * This reads back the number the user got from their valuation provider.
 * Nothing here computes a 409A.
 *
 * The whole stored record comes back, with the two fields the math cares
 * about normalized. Returning a hand-picked subset instead would drop
 * whatever the record carries that this file has no opinion on - the
 * attachments, in particular, which callers use to offer the 409A report
 * behind the number.
 */
export function currentFMV(company, asOf) {
  let best = null;
  for (const v of company?.valuations || []) {
    if (!(Number(v.fmvPerShare) > 0) || !v.date) continue;
    if (asOf && v.date > asOf) continue;
    if (!best || v.date > best.date) best = v;
  }
  return best
    ? { ...best, fmvPerShare: Number(best.fmvPerShare), note: best.note || '' }
    : null;
}

/**
 * The current FMV plus the two standard reasons it needs refreshing: age
 * past twelve months, and a priced round closing after it was set and on or
 * before `asOf`. Preferred issuances are what count as a round - a par-value
 * common certificate issued afterwards is not a new valuation event.
 */
export function fmvStatus(db, asOf) {
  const current = currentFMV(db.company, asOf);
  if (!current) return { current: null, months: 0, stale: false, roundSince: null };
  const preferred = new Set(db.classes.filter((c) => c.kind === 'preferred').map((c) => c.id));
  /* Bounded by the date being asked about, exactly as `currentFMV` above is.
     A Series A certificate dated for a close three months out would otherwise
     read as a round that has already overtaken the 409A: a refresh warning on
     the dashboard tile, a warning in the 409A card, and a row on a page whose
     whole subject is records whose date has passed. */
  const priced = preferred.size ? latestPricedIssuance(db.securities, preferred, asOf) : null;
  const months = monthsBetween(current.date, asOf);
  return {
    current,
    months,
    stale: months >= FMV_MAX_AGE_MONTHS,
    roundSince: priced && priced.date > current.date ? priced : null,
  };
}

/**
 * Total capital raised: cash paid for shares plus convertible principal.
 *
 * A convertible is counted once, as the principal that was actually paid
 * in, whether or not it has converted - the certificate it turned into is
 * skipped rather than the instrument. Counting the certificate instead
 * measured it at shares x conversion price, which for a note is principal
 * plus every dollar of accrued interest: money the company never received,
 * added to "capital raised" the day the round closed. Only when the source
 * instrument is gone does the certificate stand in for it.
 *
 * A transfer is counted the same way, on the certificate the money was paid
 * to the company for. Counting the surviving legs instead made a repurchase
 * look like unraising: the shares stop being outstanding, so 100 shares
 * bought back off a $1,000 issuance dropped capital raised to $900, and a
 * full buyback erased the financing entirely. The cash came in once and
 * history keeps it; what a buyback costs is a separate figure.
 */
// A confirmed check is independent of whole-share rounding, later stock
// splits and price corrections. Older certificates carry only count × price.
const issuedCapital = (s) => s.cashInvested ?? issuedQty(s) * (Number(s.pricePerShare) || 0);

export function capitalRaised(securities) {
  const ids = new Set(securities.map((s) => s.id));
  let total = 0;
  for (const s of securities) {
    if (s.kind === 'shares') {
      if (s.fromConvertibleId && ids.has(s.fromConvertibleId)) continue;
      if (s.fromTransferId && ids.has(s.fromTransferId)) continue;
      total += issuedCapital(s);
    } else if (s.kind === 'safe' || s.kind === 'note') {
      total += Number(s.principal) || 0;
    }
  }
  return total;
}

/* ---------- Convertible conversion ---------- */

/** A YC post-money SAFE - its cap divides by the post-conversion capitalization. */
export function isPostMoneySafe(security) {
  return security?.kind === 'safe' && security.safeType === 'post';
}

/**
 * The ownership a capped post-money SAFE guarantees its holder:
 * principal / cap of the company capitalization at conversion. That number
 * is fixed the day the SAFE is signed, which is the whole point of the
 * instrument - so it's worth showing before any round is modeled.
 * Null for anything else (pre-money and uncapped SAFEs promise a price, not
 * a percentage).
 */
export function postMoneyOwnership(security) {
  if (!isPostMoneySafe(security)) return null;
  const cap = Number(security.valuationCap) || 0;
  const principal = Math.max(0, Number(security.principal) || 0);
  if (!(cap > 0) || !(principal > 0)) return null;
  return principal / cap;
}

/**
 * Price at which a SAFE/note converts in a priced round.
 *
 *   capPrice      = valuationCap / capBasis
 *   discountPrice = roundPPS * (1 - discount%)
 *   conversion    = min(capPrice, discountPrice, roundPPS)
 *
 * `capBasis` is the pre-round fully diluted count for pre-money instruments
 * (notes and pre-money SAFEs) and the company capitalization for post-money
 * SAFEs - the YC definition, which already includes the shares every
 * converting instrument receives but excludes the new money and the new pool
 * top-up. `companyCap` defaults to `preRoundFD` so callers holding only
 * pre-money instruments can ignore it.
 *
 * A missing cap or discount simply doesn't constrain the price.
 */
export function conversionPrice(security, roundPPS, preRoundFD, companyCap = preRoundFD) {
  let price = roundPPS;
  const cap = Number(security.valuationCap) || 0;
  const basis = isPostMoneySafe(security) ? companyCap : preRoundFD;
  if (cap > 0 && basis > 0) price = Math.min(price, cap / basis);
  const discount = Number(security.discount) || 0;
  if (discount > 0) price = Math.min(price, roundPPS * (1 - discount / 100));
  return price;
}

/* Runaway guard for the capitalization fixed point below: post-money SAFEs
   whose caps sum to 100%+ of the company have no finite solution (they claim
   more than everything), so the search is bounded rather than divergent. */
const MAX_CAP_MULTIPLE = 1000;

/* A capped post-money SAFE fixes its holder's ownership at principal / cap.
   Once the live SAFEs' claims sum to (nearly) the whole company the model
   has no meaningful solution - and near the line it converges too slowly to
   trust - so modelRound refuses and says why instead of printing noise. The
   practical trigger is a typo: a $250k SAFE against an $80k cap claims 312%. */
const MAX_POST_MONEY_CLAIM = 0.95;

/** Combined ownership fraction that capped post-money SAFEs promise. */
function postMoneyClaim(converts) {
  return converts.reduce((a, c) => {
    const cap = Number(c.security.valuationCap) || 0;
    return isPostMoneySafe(c.security) && cap > 0 ? a + c.value / cap : a;
  }, 0);
}

/**
 * Shares every convertible turns into at a given round price, plus the
 * company capitalization that produced them.
 *
 * Post-money SAFE caps divide by a capitalization that already counts the
 * shares those SAFEs receive, so the number is self-referential and gets its
 * own fixed point. Every term is non-decreasing in the capitalization, so
 * plain iteration converges whenever the post-money SAFEs claim under 100%
 * of the company - the ordinary case.
 */
function convertedShares(converts, pps, fdPre) {
  const limit = fdPre * MAX_CAP_MULTIPLE;
  let companyCap = fdPre;
  for (let i = 0; i < 80; i++) {
    /* Split by whether an instrument's count moves with the capitalization.
       A post-money SAFE whose cap binds converts into value x cap / cap price,
       which is value x companyCap / valuationCap: proportional to the very
       count being solved for. Everything else converts into a count that
       stands still. For a given set of binding caps the fixed point is then
       exact - companyCap = (fdPre + still) / (1 - sum of value / cap) - so
       the pass jumps there and checks which caps bind at that count. A cap
       that binds keeps binding as the count grows and one that did not may
       start to, so the set only ever grows and the passes settle in a few
       steps whatever the claim. Plain iteration crept toward the same point
       by a factor of the claim per pass: at a 90% claim eighty passes were
       still 16,000 shares short, and modelRound's outer loop restarted them
       from scratch every time. */
    let still = 0;
    let claim = 0;
    for (const c of converts) {
      const price = conversionPrice(c.security, pps, fdPre, companyCap);
      if (!(price > 0)) continue;
      const cap = Number(c.security.valuationCap) || 0;
      if (isPostMoneySafe(c.security) && cap > 0 && price === cap / companyCap) claim += c.value / cap;
      else still += c.value / price;
    }
    const next = Math.min(limit, claim < 1 ? (fdPre + still) / (1 - claim) : limit);
    const settled = Math.abs(next - companyCap) < 1e-6;
    companyCap = next;
    if (settled) break;
  }
  return { shares: companyCap - fdPre, companyCap };
}

/* ---------- Option pool forecast ---------- */

/** How far ahead the pool forecast looks by default. */
export const POOL_FORECAST_MONTHS = 18;

/**
 * Shares one planned row needs: its per-hire size times its headcount.
 *
 * A percentage row is measured against today's fully diluted count, which is
 * the only base a plan can be sized against before the round that changes it -
 * and the same base the round model's pool target uses.
 */
export function plannedShares(db, row, { fd = null } = {}) {
  const headcount = Math.max(1, Math.round(Number(row?.headcount) || 1));
  if (row?.sizeMode === 'pct') {
    const pct = Math.max(0, Number(row.pct) || 0);
    /* The same count for every row, and not a cheap one - it rebuilds every
       plan's balances over the whole register - so a caller sizing a plan's
       worth of rows measures it once and hands it in. */
    const base = fd === null ? fullyDiluted(db.securities, db.company) : fd;
    return Math.round(pct * base) * headcount;
  }
  return Math.max(0, Math.round(Number(row?.shares) || 0)) * headcount;
}

/**
 * The option pool drawn down month by month against a hiring plan.
 *
 * A grant is made when a hire starts, so each planned row lands whole in its
 * start month; vesting has nothing to do with it, because the pool is drawn on
 * the day a grant is signed. Rows whose month has already passed - or which
 * never named one - land in the first month, since those are hires the plan is
 * already waiting on.
 *
 * Each row: { month, granted, remaining, short }. `dryMonth` is the first
 * month the plan asks for more than is there, `shortfall` is how many shares
 * the pool would have to grow by to cover the whole plan, and `beyond` is the
 * part of the plan that starts after the last month shown - counted in the
 * shortfall, drawn in no row.
 */
export function poolForecast(db, plan = [], { from, months = POOL_FORECAST_MONTHS } = {}) {
  const available = poolRemaining(db.company, db.securities);
  const empty = {
    rows: [], available, planned: 0, shortfall: 0, dryMonth: null, unscheduled: 0, beyond: 0,
  };
  if (!from || !(months > 0)) return empty;
  const start = from.slice(0, 7);

  const fd = fullyDiluted(db.securities, db.company);
  const sized = plan.map((row) => ({ row, shares: plannedShares(db, row, { fd }) }))
    .filter((x) => x.shares > 0);
  const planned = sized.reduce((a, x) => a + x.shares, 0);
  if (!planned) return { ...empty, planned: 0 };

  const byMonth = new Map();
  let unscheduled = 0;
  for (const { row, shares } of sized) {
    const month = row.startMonth && row.startMonth > start ? row.startMonth : start;
    if (!row.startMonth || row.startMonth < start) unscheduled += shares;
    byMonth.set(month, (byMonth.get(month) || 0) + shares);
  }

  const rows = [];
  let drawn = 0;
  let dryMonth = null;
  for (let i = 0; i < months; i++) {
    const month = addMonthsISO(`${start}-01`, i).slice(0, 7);
    const granted = byMonth.get(month) || 0;
    drawn += granted;
    const remaining = available - drawn;
    if (remaining < 0 && !dryMonth) dryMonth = month;
    rows.push({ month, granted, remaining: Math.max(0, remaining), short: Math.max(0, -remaining) });
  }
  /* A plan whose last hires fall outside the horizon still needs those
     shares, so the shortfall is measured against the whole plan rather than
     against the part that happens to fit in the chart. */
  const shortfall = Math.max(0, planned - available);
  const beyond = Math.max(0, planned - rows.reduce((a, r) => a + r.granted, 0));
  return { rows, available, planned, shortfall, dryMonth, unscheduled, beyond };
}

/* ---------- Anti-dilution ---------- */

/** Conversion-price protection a preferred class can carry. */
export const ANTI_DILUTION_TERMS = [
  { value: 'none', label: 'None' },
  { value: 'broad', label: 'Broad-based weighted average' },
  { value: 'ratchet', label: 'Full ratchet' },
];

/** Whether a class's conversion price is protected against a down round. */
export function hasAntiDilution(cls) {
  return cls?.kind === 'preferred'
    && (cls.antiDilution === 'broad' || cls.antiDilution === 'ratchet');
}

/**
 * The conversion price in force for a class: the adjusted one once a down
 * round has lowered it, else the original issue price. This is the price the
 * next adjustment measures against, and the one the class's protection is
 * triggered below.
 */
export function conversionPriceOf(cls) {
  const adjusted = Number(cls?.conversionPrice) || 0;
  return adjusted > 0 ? adjusted : Math.max(0, Number(cls?.pricePerShare) || 0);
}

/**
 * A certificate minted by an anti-dilution adjustment rather than bought.
 * It carries no invested capital, so a class's liquidation preference is
 * untouched by an adjustment while its as-converted count rises - which is
 * exactly what a lowered conversion price does.
 */
export function isAntiDilutionShares(security) {
  return security?.kind === 'shares' && security.antiDilution === true;
}

/**
 * Whether a certificate in a protected class was bought at the class's own
 * issue price - the shares the protection is written for. A certificate
 * issued into the class at a lower price already carries its discount: the
 * SAFE or note that converted at its cap or discount in the round that
 * created the class, or a later tranche closed cheaper. Counted as bought at
 * the class price, those shares were handed adjustment shares for a price
 * they never paid - a $0.50 conversion certificate protected against a
 * $0.50 round - while the waterfall, which reads each certificate's own
 * price, already returned them only what they paid. Sizes agree to the last
 * digit on the price the round wrote, so the tolerance only covers what a
 * split's division leaves behind.
 */
function boughtAtIssue(security, issuePrice) {
  return Math.abs((Number(security.pricePerShare) || 0) - issuePrice) <= issuePrice * 1e-9;
}

/**
 * What each protected class needs to know before an adjustment can be sized:
 * the conversion price in force, the original issue price the ratio is
 * measured from, the shares actually bought at it, and the shares a previous
 * adjustment already minted.
 */
function protectedClasses(db) {
  const out = [];
  for (const cls of db.classes) {
    if (!hasAntiDilution(cls)) continue;
    const issuePrice = Math.max(0, Number(cls.pricePerShare) || 0);
    const current = conversionPriceOf(cls);
    if (!(issuePrice > 0) || !(current > 0)) continue;
    let bought = 0;
    let minted = 0;
    for (const s of db.securities) {
      if (s.kind !== 'shares' || s.classId !== cls.id) continue;
      if (isAntiDilutionShares(s)) minted += qty(s);
      else if (boughtAtIssue(s, issuePrice)) bought += qty(s);
    }
    if (bought <= 0) continue;
    out.push({ cls, terms: cls.antiDilution, issuePrice, current, bought, minted });
  }
  return out;
}

/**
 * The conversion price a class falls to when shares are issued below it.
 *
 * Full ratchet: the new price, however few shares were sold at it.
 * Broad-based weighted average: the standard formula,
 *
 *     CP2 = CP1 x (A + B) / (A + C)
 *
 * where A is the fully diluted count before the round (broad-based, so
 * options, warrants, RSUs and the unallocated pool are all in it), B is the
 * shares the new money would have bought at the old conversion price, and C
 * is the shares it actually buys. Narrow-based variants, carve-outs, and
 * exceptions schedules are deliberately not modeled.
 */
function adjustedConversionPrice(entry, { price, investment, broadBase }) {
  if (entry.terms === 'ratchet') return price;
  const would = entry.current > 0 ? investment / entry.current : 0;
  const actual = price > 0 ? investment / price : 0;
  const denominator = broadBase + actual;
  if (!(denominator > 0)) return entry.current;
  return entry.current * ((broadBase + would) / denominator);
}

/** Whole shares an adjustment mints for one class at a given round price. */
function adjustmentFor(entry, { price, investment, broadBase }) {
  // Protection only triggers below the conversion price in force.
  if (!(price > 0) || price >= entry.current) return null;
  const next = adjustedConversionPrice(entry, { price, investment, broadBase });
  if (!(next > 0) || next >= entry.current) return null;
  // The class's whole as-converted count at the new price, less what it holds.
  const target = Math.round((entry.bought * entry.issuePrice) / next);
  const shares = target - entry.bought - entry.minted;
  if (shares <= 0) return null;
  return { entry, before: entry.current, after: next, shares };
}

/**
 * Split an adjustment across the class's holders, pro rata by the shares
 * each of them bought at the issue price - the shares the adjustment is
 * for (see boughtAtIssue). Largest remainder, so the parts add up to the
 * whole.
 */
function splitAdjustment(db, entry, shares) {
  const held = new Map();
  let total = 0;
  for (const s of db.securities) {
    if (s.kind !== 'shares' || s.classId !== entry.cls.id) continue;
    if (isAntiDilutionShares(s) || !boughtAtIssue(s, entry.issuePrice)) continue;
    const n = qty(s);
    if (n <= 0) continue;
    held.set(s.stakeholderId, (held.get(s.stakeholderId) || 0) + n);
    total += n;
  }
  if (!total) return [];
  const rows = [...held.entries()].map(([stakeholderId, n]) => {
    const exact = (n / total) * shares;
    const whole = Math.floor(exact);
    return { stakeholderId, quantity: whole, remainder: exact - whole };
  });
  let left = shares - rows.reduce((a, r) => a + r.quantity, 0);
  for (const r of [...rows].sort((a, b) => b.remainder - a.remainder)) {
    if (left <= 0) break;
    r.quantity += 1;
    left -= 1;
  }
  return rows.filter((r) => r.quantity > 0).map(({ stakeholderId, quantity }) => ({ stakeholderId, quantity }));
}

/**
 * The anti-dilution adjustments a round at `pps` triggers: one entry per
 * protected class whose conversion price the round falls below, with the
 * shares it mints and who they go to.
 *
 * Each entry: { classId, name, terms, conversionPriceBefore,
 * conversionPriceAfter, issuePrice, shares, holders: [{ stakeholderId,
 * quantity }] }.
 */
export function antiDilutionAdjustments(db, { pps, investment = 0 } = {}) {
  const price = Math.max(0, Number(pps) || 0);
  const invest = Math.max(0, Number(investment) || 0);
  const broadBase = fullyDiluted(db.securities, db.company);
  const out = [];
  for (const entry of protectedClasses(db)) {
    const adjustment = adjustmentFor(entry, { price, investment: invest, broadBase });
    if (!adjustment) continue;
    out.push({
      classId: entry.cls.id,
      name: entry.cls.name,
      terms: entry.terms,
      issuePrice: entry.issuePrice,
      conversionPriceBefore: adjustment.before,
      conversionPriceAfter: adjustment.after,
      shares: adjustment.shares,
      holders: splitAdjustment(db, entry, adjustment.shares),
    });
  }
  return out;
}

/* ---------- Round modeling ---------- */

/** The largest post-round pool share the model accepts as a target. */
const MAX_POOL_TARGET = 0.9;

/**
 * Model a priced round. Returns the pro-forma cap table without mutating
 * anything - the caller renders it (and may later apply it). Null when there
 * is nothing to model. Three unsatisfiable shapes are refused instead of
 * rendered: `{ overclaim }` when capped post-money SAFEs promise (nearly)
 * the whole company, `{ valueClaim }` when the convertibles' discounted
 * value reaches (nearly) the whole pre-money, and `{ unpriceable }` when
 * the terms admit no positive share price at all (typically a pool top-up
 * larger than the pre-money can fund).
 *
 * Inputs:
 *   preMoney    pre-money valuation ($)
 *   investment  new money in ($)
 *   poolPct     target unallocated option pool as a fraction of post-round
 *               fully diluted (0 to skip a top-up; an existing larger pool
 *               is never shrunk)
 *   asOf        ISO date the table is read as of, and note interest accrues to
 *
 * Method (standard fixed pre-money convention):
 *   PPS = preMoney / (pre-round FD + conversion shares + pool increase
 *                     + anti-dilution shares)
 * Conversion shares, the pool increase, and any anti-dilution adjustment all
 * depend on PPS, so the value is found by fixed-point iteration; every term is
 * monotone in PPS, and in practice it converges to a stable price in a handful
 * of passes.
 *
 * The adjustment sits in the pre-money denominator on purpose: that is what
 * makes its shares dilute the existing holders rather than the new money,
 * which is the whole point of the protection - and it is what the investors
 * negotiating a pre-money valuation are pricing against.
 * Pre-money instrument caps divide by the pre-round FD (including the
 * existing unallocated pool, excluding the new-round top-up); post-money
 * SAFE caps divide by the company capitalization, which adds every
 * converting instrument's shares on top of that.
 */
export function modelRound(db, inputs) {
  const rights = db.securities.flatMap((s) => (s.proRata || []).map((r) => ({ ...r, security: s })));
  const negotiated = inputs.financing || rights.length || db.securities.some((s) => s.mfn);
  /* The table as it stood on the model date, the way the negotiated model
     has always read it (see modelNegotiatedRound, which snapshots for
     itself): certificates dated after the date drop out of the pre-round
     base, forfeitures and conversions that had not happened yet are put
     back, and each warrant reads its balance on the day. Only the warrants
     were dated before, so a certificate dated after the model date - a
     round already scheduled to close - was priced into the base while the
     notes stopped accruing on the date itself. */
  if (!negotiated) return modelRoundBase(inputs.asOf ? dbAsOf(db, inputs.asOf) : db, inputs);
  try {
    return modelNegotiatedRound(db, inputs, rights);
  } catch (err) {
    if (err instanceof FinancingError) return { unsupported: err.message };
    throw err;
  }
}

/**
 * A round modeled under explicit dated assumptions - see validateFinancing.
 *
 * The base model prices the whole round; this wrapper decides what the whole
 * round is and who the new money's shares go to:
 *
 *  - The table is read as of the model date, with the scenario's selected
 *    MFN elections in force on the instruments they name (`appliedMFN` lists
 *    each with the original terms beside it), before anything is priced.
 *  - Elected pro-rata checks are part of the round. In 'fixed' mode they fit
 *    inside the entered investment and the rest goes to other investors; in
 *    'additional' mode they are added to it. Either way the price, the
 *    conversions, the anti-dilution and the pool top-up are solved once over
 *    the whole round - a percentage is never carved out after the fact.
 *  - Each right eligible on the date and for this financing reports its
 *    basis and fraction, the most it entitles the holder to, the amount
 *    elected, the whole shares that buys at the round price, and the unmet
 *    or overallocated difference. An election above its entitlement, or one
 *    that buys no whole share, comes back as `unsupported` for the form.
 *
 * A right or election the terms cannot honour - unknown, outside its window,
 * a convention the app does not model - is a FinancingError, which modelRound
 * returns as `{ unsupported }` the way the base model returns its own refusals.
 */
function modelNegotiatedRound(db, inputs, rights) {
  const financing = validateFinancing(inputs.financing);
  if (!financing) throw new FinancingError('Set a financing ID, round size convention and explicit participation/MFN elections.');
  const asOf = inputs.asOf;
  if (!asOf) throw new FinancingError('Select the financing model date.');
  termDate(asOf, 'Model date');
  db.securities.forEach((s) => validateProRata(s.proRata));
  const ids = new Set();
  for (const r of rights) {
    if (ids.has(r.id)) throw new FinancingError('Pro-rata right IDs must be unique across instruments.');
    ids.add(r.id);
  }

  const { db: effective, applied } = electedDb(dbAsOf(db, asOf), financing, asOf);
  const electedTotal = financing.elections.reduce((a, e) => a + e.amount, 0);
  const investment = (Number(inputs.investment) || 0) + (financing.roundMode === 'additional' ? electedTotal : 0);
  if (electedTotal > investment + 1e-7) {
    throw new FinancingError('Elected checks exceed the fixed round. Reduce elections or explicitly choose additional mode.');
  }
  const result = modelRoundBase(effective, { ...inputs, investment });
  if (!result?.pps) return result;

  /* Each right, measured on its own denominator against the whole round. */
  const eligible = rights.filter((r) => r.start <= asOf && (!r.end || r.end >= asOf)
    // A post-money side letter applies only in its SAFE's conversion round.
    // Keep the recorded right for history, but an already-converted SAFE
    // must not prevent an unrelated later financing with no election.
    && !(r.basis === 'yc-post-money' && r.security.convertedAt && r.security.convertedAt <= asOf)
    && r.security.date <= asOf && (r.financings.includes('*') || r.financings.includes(financing.id)));
  const elections = new Map(financing.elections.map((e) => [e.rightId, e.amount]));
  const certified = certifiedIndexes(effective.securities);
  const holderShares = (id) => effective.securities.filter((s) => s.stakeholderId === id)
    .reduce((a, s) => a + dilutedShares(s, certified), 0);
  const allocations = eligible.map((r) => {
    const source = effective.securities.find((s) => s.id === r.security.id) || r.security;
    let fraction;
    if (r.basis === 'fixed') {
      fraction = r.fraction;
    } else if (r.basis === 'pre-round-fd') {
      fraction = holderShares(source.stakeholderId) / result.fdPre;
    } else if (r.basis === 'yc-original') {
      /* The original YC right attaches to the financing after the one the
         SAFE converts in; in its own conversion round it is not yet live. */
      if (source.kind !== 'safe') throw new FinancingError(`${r.id}: original YC rights must name a SAFE.`);
      if (!source.convertedAt || source.convertedAt >= asOf) {
        if (elections.get(r.id)) throw new FinancingError(`${r.id}: original YC rights apply only after its conversion round.`);
        fraction = 0;
      } else {
        fraction = holderShares(source.stakeholderId) / result.fdPre;
      }
    } else {
      // yc-post-money: the SAFE's own conversion shares over the company capitalization.
      if (source.kind !== 'safe' || source.safeType !== 'post' || source.convertedAt) {
        throw new FinancingError(`${r.id}: YC post-money side-letter rights require a live post-money SAFE.`);
      }
      fraction = (result.conversions.find((c) => c.securityId === source.id)?.shares || 0) / result.companyCap;
    }
    const entitlement = Math.min(investment * fraction, r.limit ?? Infinity);
    const elected = elections.get(r.id) || 0;
    elections.delete(r.id);
    const shares = Math.round(elected / result.pps);
    return {
      rightId: r.id, securityId: source.id, stakeholderId: source.stakeholderId, basis: r.basis,
      fraction, entitlement, elected, shares,
      unmet: Math.max(0, entitlement - elected),
      overallocated: Math.max(0, elected - entitlement),
      cashRounding: elected - shares * result.pps,
    };
  });
  if (elections.size) throw new FinancingError(`Unknown or ineligible participation right: ${[...elections.keys()].join(', ')}.`);

  /* The new money's shares are the sum of each check rounded on its own - the
     certificates the close will write - so the post-round count and every
     holder's share of it are re-read off that total. */
  const remaining = investment - electedTotal;
  const remainingShares = Math.round(remaining / result.pps);
  const totalShares = remainingShares + allocations.reduce((a, r) => a + r.shares, 0);
  const postFD = result.postFD - result.investorShares + totalShares;
  const dilution = result.dilution
    .filter((r) => r.stakeholderId !== '__new__')
    .map((r) => ({ ...r, after: r.after * result.postFD / postFD }));
  for (const a of allocations) {
    let row = dilution.find((r) => r.stakeholderId === a.stakeholderId);
    if (!row) {
      row = { stakeholderId: a.stakeholderId, name: db.stakeholders.find((h) => h.id === a.stakeholderId)?.name || 'Unknown holder', before: 0, after: 0 };
      dilution.push(row);
    }
    row.after += a.shares / postFD;
  }
  // Ahead of the pool row, where the base model places the new money.
  const poolRow = dilution.findIndex((r) => r.stakeholderId === '__pool__');
  dilution.splice(poolRow < 0 ? dilution.length : poolRow, 0, {
    stakeholderId: '__new__',
    name: allocations.some((a) => a.elected > 0) ? 'Other investors' : 'New investors',
    before: 0, after: remainingShares / postFD,
  });
  const problems = allocations.filter((a) => a.overallocated > 1e-6 || (a.elected > 0 && a.shares === 0));
  /* What is left after the elected checks has to buy a whole share too: the
     close writes it as one certificate, and one of no shares is refused. A
     round whose elections left a few hundred dollars over at a four-figure
     price read as closable - the total bought shares - and then could not
     close: the open row bought nothing, and removing it left the checks short
     of the round. Without elections the base figures already say so. */
  const leftover = allocations.some((a) => a.elected > 0) && remaining > 0 && remainingShares < 1;
  return {
    ...result,
    postFD,
    investorShares: totalShares,
    investorPct: totalShares / postFD,
    dilution,
    financing: {
      ...financing, investment, allocations, remaining, remainingShares, appliedMFN: applied,
      cashRounding: investment - totalShares * result.pps,
    },
    ...(problems.length
      ? { unsupported: 'Some elections exceed entitlement or buy less than one whole share. Adjust the highlighted allocations before closing.' }
      : leftover
        ? { unsupported: 'The money left for other investors after the elected checks buys no whole share at the round price. Raise the round, or lower the elected checks.' }
        : {}),
    modelInputs: { ...inputs, financing },
    modelDate: asOf,
  };
}

function modelRoundBase(db, { preMoney, investment, poolPct = 0, asOf }) {
  const pre = Math.max(0, Number(preMoney) || 0);
  const invest = Math.max(0, Number(investment) || 0);
  const targetPool = Math.min(MAX_POOL_TARGET, Math.max(0, Number(poolPct) || 0));
  const fdPre = fullyDiluted(db.securities, db.company);
  if (pre <= 0 || fdPre <= 0) return null;

  const converts = convertibles(db.securities).map((s) => ({
    security: s,
    value: convertibleValue(s, asOf),
  }));
  /* Refuse an unsatisfiable model rather than iterating into noise: the
     caller shows the claim and points at the instruments. */
  const overclaim = postMoneyClaim(converts);
  if (overclaim >= MAX_POST_MONEY_CLAIM) return { overclaim };

  /* The discount leg fails the same way capped post-money SAFEs do. Every
     convertible converts at or below the round price, so its holders absorb
     at least value / (1 - discount) dollars of the pre-money valuation.
     Once those floors reach (nearly) the whole pre-money, no positive share
     price can satisfy the model - and near the line the iteration below
     converges too slowly to trust. */
  const valueClaim = converts.reduce((a, c) => {
    const discount = Math.min(99, Math.max(0, Number(c.security.discount) || 0));
    return a + c.value / (1 - discount / 100);
  }, 0);
  if (valueClaim >= MAX_POST_MONEY_CLAIM * pre) return { valueClaim: valueClaim / pre };

  const existingPool = poolRemaining(db.company, db.securities);
  /* The classes whose conversion price this round could fall below, gathered
     once: the iteration below re-sizes their adjustment on every pass. */
  const protectedList = protectedClasses(db);
  const broadBase = fdPre;

  /* One pass of the fixed point: everything a share price implies, and the
     price those quantities imply in turn. Run to convergence below, and once
     more on the settled price so the model reports quantities that price
     actually produces. */
  const pass = (price) => {
    const { shares, companyCap: cap } = convertedShares(converts, price, fdPre);
    const investor = invest / price;
    const adjustment = protectedList.reduce((a, entry) => {
      const adj = adjustmentFor(entry, { price, investment: invest, broadBase });
      return a + (adj ? adj.shares : 0);
    }, 0);
    // Pool top-up so unallocated pool hits targetPool of post-round FD:
    // (existingPool + poolAdd) = targetPool * (fdPre + conversion + adjustment
    //                                          + poolAdd + investor)
    const basePost = fdPre + shares + adjustment + investor;
    const pool = targetPool > 0
      ? Math.max(0, (targetPool * basePost - existingPool) / (1 - targetPool))
      : 0;
    return {
      conversionShares: shares, companyCap: cap, investorShares: investor,
      adjustmentShares: adjustment, poolAdd: pool,
      nextPPS: pre / (fdPre + shares + adjustment + pool),
    };
  };

  let pps = pre / fdPre;
  /* Enough passes for the worst case the guard above admits - the loop
     contracts roughly by valueClaim / pre-money per pass, so a claim at the
     0.95 ceiling needs some hundreds of them - while the ordinary case
     still breaks out after a handful. */
  let settledPPS = false;
  for (let i = 0; i < 2000; i++) {
    const { nextPPS } = pass(pps);
    /* Measured against the price itself, not in absolute dollars. A cap
       table with ten billion shares prices its round in hundredths of a
       cent, where an absolute 1e-9 stops a hundred thousand shares short of
       the fixed point - and a stock split, which changes nothing about the
       round, was enough to put it there. */
    const settled = Math.abs(nextPPS - pps) <= 1e-12 * nextPPS;
    pps = nextPPS;
    if (settled) { settledPPS = true; break; }
  }
  let { conversionShares, companyCap, investorShares, adjustmentShares, poolAdd } = pass(pps);
  /* The pool top-up scales with the investment, which the guards above
     can't see - a 20% pool target on a raise several times the pre-money
     needs more new pool shares than the whole pre-money can pay for, and
     the iteration collapses toward a zero price. A model that never
     settled, or settled against the runaway clamp, is refused too. */
  if (!settledPPS
    || !(fdPre + conversionShares + adjustmentShares + poolAdd < fdPre * MAX_CAP_MULTIPLE)) {
    return { unpriceable: true };
  }

  investorShares = Math.round(investorShares);
  poolAdd = Math.round(poolAdd);
  /* Re-derived from the settled price, so the shares reported are the shares
     the adjustment actually mints - and so each class's own figures (the new
     conversion price, and who the shares go to) come from one place. */
  const adjustments = antiDilutionAdjustments(db, { pps, investment: invest });
  adjustmentShares = adjustments.reduce((a, x) => a + x.shares, 0);

  const conversions = converts.map((c) => {
    const price = conversionPrice(c.security, pps, fdPre, companyCap);
    return {
      securityId: c.security.id,
      stakeholderId: c.security.stakeholderId,
      label: c.security.label,
      kind: c.security.kind,
      safeType: c.security.safeType || null,
      value: c.value,
      price,
      shares: price > 0 ? Math.round(c.value / price) : 0,
    };
  });
  /* The total is the sum of the certificates the close will actually write -
     each instrument's shares rounded on its own - not the fixed point's
     fractional total rounded once. Two SAFEs at .4 and .3 of a share summed
     to .7 and rounded up, so the summary reported one share more than the
     conversion table beneath it listed, and a fully diluted count the cap
     table would never show once the round closed. */
  conversionShares = conversions.reduce((a, c) => a + c.shares, 0);
  const postFD = fdPre + conversionShares + adjustmentShares + poolAdd + investorShares;

  // Before/after ownership per stakeholder (diluted base, pool included).
  const before = ownershipByStakeholder(db, { base: 'diluted', includePool: true });
  const certified = certifiedIndexes(db.securities);
  const afterCounts = new Map();
  for (const s of db.securities) {
    const n = dilutedShares(s, certified);
    if (n > 0) afterCounts.set(s.stakeholderId, (afterCounts.get(s.stakeholderId) || 0) + n);
  }
  for (const c of conversions) {
    afterCounts.set(c.stakeholderId, (afterCounts.get(c.stakeholderId) || 0) + c.shares);
  }
  /* The adjustment's shares are the protected holders' own - it lowers the
     price their existing shares convert at - so they land on their rows
     rather than on the new money's. */
  for (const a of adjustments) {
    for (const h of a.holders) {
      afterCounts.set(h.stakeholderId, (afterCounts.get(h.stakeholderId) || 0) + h.quantity);
    }
  }
  // Indexed once each: the table is one row per holder, re-modeled on every keystroke.
  const holders = new Map(db.stakeholders.map((h) => [h.id, h]));
  const holderName = (id) => holders.get(id)?.name || 'Unknown holder';
  const beforePct = new Map(before.rows.map((r) => [r.stakeholderId, r.pct]));
  const dilution = [];
  for (const [id, n] of afterCounts) {
    dilution.push({
      stakeholderId: id,
      name: holderName(id),
      before: beforePct.get(id) || 0,
      after: postFD > 0 ? n / postFD : 0,
    });
  }
  dilution.sort((a, b) => b.after - a.after || a.name.localeCompare(b.name));
  dilution.push({
    stakeholderId: '__new__', name: 'New investors',
    before: 0, after: postFD > 0 ? investorShares / postFD : 0,
  });
  const poolAfter = existingPool + poolAdd;
  if (poolAfter > 0) {
    dilution.push({
      stakeholderId: '__pool__', name: 'Option pool (unallocated)',
      before: before.rows.find((r) => r.kind === 'pool')?.pct || 0,
      after: postFD > 0 ? poolAfter / postFD : 0,
    });
  }

  return {
    /* Converged to 1e-12 relative, which leaves residue inside the fifteen
       digits tidy() keeps: an exact $1.75 came out 1.7500000000000098, and
       once the round closed the class and its certificates prefilled their
       edit sheets with 1.75000000000001. Twelve digits are more than any
       price carries and past where the iteration's noise lives. */
    pps: Number.isFinite(pps) ? Number(pps.toPrecision(12)) : pps,
    fdPre,
    companyCap,
    postFD,
    postMoney: pre + invest,
    investorShares,
    investorPct: postFD > 0 ? investorShares / postFD : 0,
    poolAdd,
    poolAfter,
    conversionShares,
    conversions,
    antiDilution: adjustments,
    antiDilutionShares: adjustmentShares,
    dilution,
  };
}

/**
 * The smallest post-round pool target that leaves at least `planned` shares
 * unallocated once a round on these terms closes.
 *
 * The target is a share of the post-round fully diluted count, and the
 * top-up it calls for changes that count, so the percentage cannot simply be
 * divided out. Iterating target = planned / post-round count settles only
 * while the count moves less than the target does. With a raise several
 * times the pre-money each pass overshoots the last, and once out of passes
 * the loop handed back whatever target it happened to be at - one that left
 * the plan uncovered, or one the terms could not price at all - and the
 * field was filled in as though the plan were covered.
 *
 * Both things the search depends on are monotone in the target: the pool
 * left after close never shrinks as the target rises, and terms that price
 * at one target price at every lower one. So the answer is bracketed and
 * bisected, rounded up to the hundredth of a percent the field holds, and
 * modeled once more at that value, which is what comes back.
 *
 * Returns { poolPct, model } when a target covers the plan. Otherwise
 * poolPct is null and `priceable` says whether the terms price with no
 * top-up at all - the message the caller shows depends on which.
 */
export function poolTargetToCover(db, { preMoney, investment, planned, asOf, financing }) {
  const need = Math.max(0, Math.round(Number(planned) || 0));
  const at = (poolPct) => {
    const m = modelRound(db, { preMoney, investment, poolPct, asOf, financing });
    return m && !m.unsupported && !m.unpriceable && !m.overclaim && !m.valueClaim ? m : null;
  };
  /* Covered means covered once the round closes. A close writes the top-up
     it modeled and leaves the reserve alone when it modeled none - so a
     model that asks for nothing leaves the LIVE unallocated count, not the
     pool its own date read. Dated before a grant that has since drawn the
     pool, the model read the pool whole, called the plan covered, and the
     close wrote no top-up while the plan stayed short. */
  const live = poolRemaining(db.company, db.securities);
  const covers = (m) => !!m && (m.poolAdd > 0 ? m.poolAfter >= need : live >= need);
  /* Rounded up, never to nearest: a hundredth of a percent of a post-round
     count is a four-figure share number, and rounded to nearest the target
     landed just under, with the card the user had just pressed going on
     saying the plan was short by the difference. */
  const field = (t) => Math.ceil(t * 10000 - 1e-6) / 10000;

  const base = at(0);
  if (!base) return { poolPct: null, priceable: false };
  /* Already covered: the target is what the plan comes to as a share of the
     post-round count, and it asks for no top-up, so the model stays as it
     is. Rounded up to the field where that still asks for nothing; where the
     plan sits within a hundredth of a percent of the pool, rounding up sat
     just above the pool's share and bought a top-up of a few dozen shares
     the plan did not need, so it rounds down instead. */
  if (covers(base)) {
    const up = field(need / base.postFD);
    const model = at(up);
    if (model && model.poolAdd === 0) return { poolPct: up, model };
    const down = Math.floor((need / base.postFD) * 10000 + 1e-6) / 10000;
    return { poolPct: down, model: at(down) || base };
  }

  let lo = 0; // prices, and does not cover
  let hi = MAX_POOL_TARGET; // covers, or does not price
  for (let i = 0; i < 40 && hi - lo > 1e-7; i++) {
    const mid = (lo + hi) / 2;
    const m = at(mid);
    if (m && !covers(m)) lo = mid;
    else hi = mid;
  }
  const t = field(hi);
  const model = t <= MAX_POOL_TARGET ? at(t) : null;
  return covers(model) ? { poolPct: t, model } : { poolPct: null, priceable: true };
}

/* ---------- Point in time ---------- */

/** The date a security came onto the cap table. */
export function securityDate(security) {
  return security.date || security.grantDate || '';
}

/**
 * The cap table snapshot as it stood on a date: securities issued after it
 * drop out, and a cancellation that had not happened yet is rolled back
 * (restoring the forfeited installments). A departure
 * that had not happened yet rewinds the same way, both halves of it together:
 * the holder was still there, and the post-termination exercise deadline it
 * put on their grants did not exist.
 *
 * Everything else is already date-aware, because `vestedQuantity` and
 * `convertibleValue` take an `asOf` - callers just pass the same date they
 * pass here.
 *
 * The authorized option pool reads at the size it had on the date - see
 * poolAsOf - so a pool reserved at a 2024 round is not on the 2023 table. A
 * pool set before its resizes were recorded is carried as it stands.
 *
 * One thing deliberately does not rewind: an exercise carries no date of its
 * own - but the certificate it produced does, so a certificate issued after
 * the date drops out and the grant gets those shares back in the diluted
 * count, which is the part that matters.
 */
export function dbAsOf(db, asOf) {
  if (!asOf) return db;
  /* `exerciseBy` is written only by the departure flow, in the same commit as
     the `departed` stamp read here - so the stamp is what dates it. Without
     this the snapshot reports a deadline for a departure that, on its own
     date, had not happened: a phantom expiration on the full grant. */
  const stillHere = new Set((db.stakeholders || [])
    .filter((h) => h.departed && h.departed > asOf)
    .map((h) => h.id));

  /* An exercise or settlement is dated by its certificate. One dated after
     `asOf` is filtered out below by its own date, and the counter on the
     award it came from comes down with it: the counter carries no date, and
     read against the certificates left in the snapshot it placed those
     shares on the grant date - which, under a plan that returns exercised or
     settled shares, credited the reserve with a return that had not happened
     yet. An exercise recorded with no certificate at all has no date to
     read, and keeps counting as it always did. */
  const certifiedLater = new Map();
  for (const s of db.securities) {
    if (s.kind !== 'shares' || s.fromTransferId) continue;
    const awardId = s.fromOptionId || s.fromRsuId;
    if (!awardId || !(securityDate(s) > asOf)) continue;
    certifiedLater.set(awardId, (certifiedLater.get(awardId) || 0) + issuedQty(s));
  }

  const securities = [];
  for (const s of db.securities) {
    const issued = securityDate(s);
    if (issued && issued > asOf) continue;
    let live = s.kind === 'warrant' ? { ...s, snapshotDate: asOf } : s;
    if (s.vestingStoppedAt && s.vestingStoppedAt > asOf) {
      const { vestingStoppedAt, ...rest } = live;
      live = rest;
    }
    if (s.kind === 'option' && s.exerciseBy && stillHere.has(s.stakeholderId)) {
      const { exerciseBy, ...rest } = live;
      live = rest;
    }
    if ((s.kind === 'option' || s.kind === 'rsu') && certifiedLater.has(s.id)) {
      const key = s.kind === 'rsu' ? 'settled' : 'exercised';
      const counter = Math.max(0, Math.round(Number(live[key]) || 0));
      live = { ...live, [key]: Math.max(0, counter - certifiedLater.get(s.id)) };
    }
    /* Forfeitures that had not happened yet come back off, one at a time:
       a departure's cancellation stands in a February snapshot even after
       the April expiration took the rest. Rewinding the whole counter put
       the January options back too. */
    if (s.kind === 'option' || s.kind === 'rsu' || s.kind === 'warrant') {
      const history = cancellationHistory(s);
      if (history.length && history[history.length - 1].date > asOf) {
        const { cancelled, cancelledDate, cancellations, ...rest } = live;
        const kept = history.filter((c) => c.date <= asOf);
        if (kept.length) {
          rest.cancelled = kept.reduce((a, c) => a + c.quantity, 0);
          rest.cancelledDate = kept[0].date;
          if (kept.length > 1) rest.cancellations = kept;
        }
        securities.push(rest);
        continue;
      }
    }
    // Likewise a round that had not closed yet: the instrument was still a
    // live convertible, and the certificate it became is already filtered
    // out by its own date.
    if (s.convertedAt && s.convertedAt > asOf) {
      const { convertedAt, convertedToId, ...rest } = live;
      securities.push(rest);
      continue;
    }
    // A transfer that had not happened yet: the original certificate was
    // still open and counting, and its successors are already filtered out
    // by their own dates.
    if (s.closedAt && s.closedAt > asOf) {
      const { closedAt, closedReason, ...rest } = live;
      securities.push(rest);
      continue;
    }
    securities.push(live);
  }

  const stakeholders = stillHere.size
    ? db.stakeholders.map((h) => {
      if (!stillHere.has(h.id)) return h;
      const { departed, ...rest } = h;
      return rest;
    })
    : db.stakeholders;

  const snapshot = unsplitAsOf({ ...db, securities, stakeholders }, asOf);
  const pool = poolAsOf(db.company, asOf);
  /* Each plan's reserve as of the day, and a retirement that had not
     happened yet undone - the plan was still open, and its unallocated
     shares still sat in the fully diluted count. */
  let plans = null;
  if (Array.isArray(db.company.plans) && db.company.plans.length) {
    let moved = false;
    plans = db.company.plans.map((plan) => {
      let next = plan;
      const reserve = reserveAsOf(plan, db.company, asOf);
      if (reserve !== planReserve(plan)) next = { ...next, reserve };
      if (plan.status === 'retired' && plan.retiredAt && plan.retiredAt > asOf) {
        const { retiredAt, ...rest } = next;
        next = { ...rest, status: 'active' };
      }
      if (next !== plan) moved = true;
      return next;
    });
    if (!moved) plans = null;
  }
  if (!plans && pool === Math.max(0, Math.round(Number(snapshot.company.poolAuthorized) || 0))) return snapshot;
  return { ...snapshot, company: { ...snapshot.company, poolAuthorized: pool, ...(plans ? { plans } : {}) } };
}

/**
 * What one of today's shares was worth in the units of `asOf`: the product
 * of every split effective after that date, inverted. A quantity multiplies
 * by it and a per-share price divides, which is how a record stored in
 * restated units reads back in the units of its own day. 1 when nothing has
 * split since.
 */
export function unsplitFactor(company, asOf) {
  let f = 1;
  for (const sp of company?.splits || []) {
    if (sp.date > asOf) f *= sp.den / sp.num;
  }
  return f;
}

/**
 * The recorded splits in the order they were applied to the records, oldest
 * first. Each carries the sequence number it was recorded under; splits
 * written before that number existed were recorded in date order, which is
 * the order they are stored in.
 */
function splitsApplied(company) {
  return (company?.splits || [])
    .map((sp, i) => ({ sp, i }))
    .sort((a, b) => (Number(a.sp.seq) || 0) - (Number(b.sp.seq) || 0) || a.i - b.i)
    .map((x) => x.sp);
}

/**
 * How a stored share count walks back to the units of `asOf`: the splits to
 * undo, latest applied first, then the ones to apply again.
 *
 * A split restates every record the moment it is recorded, so the records
 * carry the splits in recording order - and each split's rounding notes
 * (`preSplit`) describe a record as it stood when that split ran. Undone by
 * date instead, a split recorded later but dated earlier (a historical split
 * entered after the fact, behind one already on file) read its note against
 * the other split's arithmetic: a 3,800,000-share certificate taken 1-for-3
 * and then 7-for-3 read back as 1,266,667 on every date before both. So the
 * walk goes back through every split applied since the earliest one dated
 * after `asOf`, and forward again through those among them that had already
 * happened by that date.
 */
function splitWalk(company, asOf) {
  const applied = splitsApplied(company);
  const first = applied.findIndex((sp) => sp.date > asOf);
  if (first < 0) return { undo: [], redo: [] };
  const tail = applied.slice(first);
  return { undo: tail.slice().reverse(), redo: tail.filter((sp) => sp.date <= asOf) };
}

/* A count restated forward again, rounded the way applySplit rounds a holding. */
const resplit = (value, sp) => (value > 0 ? Math.max(1, Math.round((value * sp.num) / sp.den)) : value);

/**
 * The authorized option pool as it stood on a date, in the units of that
 * date: every plan's reserve read as of that day (see reserveAsOf), summed.
 * A company written before plans existed reads its one pool through the same
 * walk, off the history and the rounding notes its record kept, so a pool
 * reserved at a 2024 round is not on the 2023 table.
 */
export function poolAsOf(company, asOf) {
  return plansOf(company).reduce((a, plan) => a + reserveAsOf(plan, company, asOf), 0);
}

/** Original holding in the units of a past date, including split rounding. */
export function unsplitQuantity(security, company, asOf) {
  let quantity = issuedQty(security);
  if (!asOf || quantity <= 0) return quantity;
  const { undo, redo } = splitWalk(company, asOf);
  for (const sp of undo) {
    const kept = (security.preSplit || []).find((entry) => entry.id === sp.id);
    quantity = kept ? kept.quantity : Math.max(1, Math.round(quantity * sp.den / sp.num));
  }
  for (const sp of redo) quantity = resplit(quantity, sp);
  return quantity;
}

/**
 * Undo splits recorded after `asOf`: stored records carry post-split
 * (restated) units, and a snapshot of an earlier date should read in the
 * units of its day - the certificate said 1,000,000 shares at $0.85, not
 * 10,000,000 at $0.085. Quantities, prices, class terms, and recorded 409As
 * all move back together; the pool follows its own dated history in poolAsOf.
 */
function unsplitAsOf(db, asOf) {
  const qf = unsplitFactor(db.company, asOf);
  // Reciprocal ratios cancel prices, but cannot cancel whole-share rounding.
  const { undo: undoing, redo: redoing } = splitWalk(db.company, asOf);
  if (!undoing.length) return db;
  const scaleQ = (q) => (q > 0 ? Math.max(1, Math.round(q * qf)) : q);
  /* Tidied a little coarser than the split's own division. Twelve digits
     cannot hold a third: a 3-for-1 split stores $0.0001 as $0.0000333333333333,
     short by what the twelfth digit dropped, and multiplied back it read
     $0.0000999999999999 - which the as-of export printed. Ten digits absorb
     what any run of splits can lose and hold every price anyone types, so a
     price walks back to exactly the figure it was. */
  const scaleP = (p) => (p > 0 ? tidy(p / qf, 10) : p);
  const holding = (s) => unsplitQuantity(s, db.company, asOf);
  const schedule = (s) => {
    let tranches = s.vestingTranches;
    for (const sp of undoing) {
      const kept = (s.preSplit || []).find((entry) => entry.id === sp.id);
      tranches = kept?.vestingTranches
        ? kept.vestingTranches.map((t) => ({ ...t }))
        : tranches.map((t) => ({ ...t, quantity: Math.max(1, Math.round(t.quantity * sp.den / sp.num)) }));
    }
    for (const sp of redoing) tranches = tranches.map((t) => ({ ...t, quantity: resplit(t.quantity, sp) }));
    return tranches;
  };
  /* One share count walked back through the splits, latest first, reading
     the number a split wrote down where it rounded and dividing where it did
     not - the way unsplitQuantity reads the holding itself. */
  const unwind = (value, sp, kept) => (kept > 0 ? kept : Math.max(1, Math.round(value * sp.den / sp.num)));
  /* The forfeiture history is denominated in shares too, one dated entry at a
     time. A split that rounded any of them wrote the whole history down as
     it stood, so each entry reads its own pre-split count back by its date;
     an entry recorded since the split (a lapse dated before it, cancelled
     after) is in restated units and divides like any other count. */
  const forfeitures = (s) => {
    let history = cancellationHistory(s).map((c) => ({ ...c }));
    if (!history.length) return null;
    for (const sp of undoing) {
      const kept = (s.preSplit || []).find((entry) => entry.id === sp.id);
      const pool = (kept?.cancellations || []).map((c) => ({ ...c }));
      history = history.map((c) => {
        const at = pool.findIndex((p) => p.date === c.date);
        const match = at >= 0 ? pool.splice(at, 1)[0] : null;
        return { ...c, quantity: unwind(c.quantity, sp, match?.quantity || 0) };
      });
    }
    for (const sp of redoing) history = history.map((c) => ({ ...c, quantity: resplit(c.quantity, sp) }));
    return history;
  };
  const restateForfeitures = (next, s) => {
    const history = forfeitures(s);
    if (!history) return next;
    /* Held to what the award held. Each entry unwinds through the splits on
       its own rounding, and a forfeiture recorded in restated units after a
       reverse split - 67 of 67 units, the whole award - divided back to 268
       on an award that had held 269: one unit outstanding on every earlier
       date of a fully forfeited award, or more cancelled than granted on
       another. The total stays inside the room the award had above what was
       exercised or settled, and an award with nothing left now keeps
       nothing left then; the last entries take the difference. */
    const claimed = Math.max(0, Math.round(Number(s.kind === 'rsu' ? next.settled : next.exercised) || 0));
    const room = Math.max(0, next.quantity - claimed);
    const total = history.reduce((a, c) => a + c.quantity, 0);
    const spent = (s.kind === 'rsu' ? rsuOutstanding(s) - rsuSettled(s) : grantOutstanding(s) - grantExercised(s)) <= 0;
    let diff = (spent ? room : Math.min(total, room)) - total;
    for (let i = history.length - 1; i >= 0 && diff !== 0; i -= 1) {
      const take = Math.max(-history[i].quantity, diff);
      history[i].quantity += take;
      diff -= take;
    }
    next.cancelled = history.reduce((a, c) => a + c.quantity, 0);
    next.cancelledDate = history[0].date;
    if (history.length > 1) next.cancellations = history;
    else delete next.cancellations;
    return next;
  };
  /* A base the record no longer carries can still have been written down by
     a split that restated it onto the holding - see applySplit's remember -
     so the walk starts from nothing and picks the base up where a split kept
     it; a record with no base and no such note has none on any date. */
  const vestingBase = (s) => {
    let value = Math.max(0, Math.round(Number(s.vestingBase) || 0));
    for (const sp of undoing) {
      const kept = (s.preSplit || []).find((entry) => entry.id === sp.id);
      const written = Math.round(Number(kept?.vestingBase) || 0);
      value = written > 0 ? written : (value > 0 ? unwind(value, sp, 0) : 0);
    }
    for (const sp of redoing) value = resplit(value, sp);
    return value;
  };
  const vestingOffset = (s) => {
    let value = Math.max(0, Math.round(Number(s.vestingOffset) || 0));
    for (const sp of undoing) {
      const kept = (s.preSplit || []).find((entry) => entry.id === sp.id);
      value = kept?.vestingOffset > 0 ? kept.vestingOffset : (value > 0 ? unwind(value, sp, 0) : 0);
    }
    for (const sp of redoing) value = resplit(value, sp);
    return value;
  };
  /* The count a repurchase retired, walked back like the base above: a
     split that rounded it wrote it down, and dividing instead read 3 retired
     of 8 where 4 had been. */
  const repurchased = (s) => {
    let value = Math.max(0, Math.round(Number(s.repurchasedQty) || 0));
    for (const sp of undoing) {
      const kept = (s.preSplit || []).find((entry) => entry.id === sp.id);
      value = unwind(value, sp, Math.round(Number(kept?.repurchasedQty) || 0));
    }
    for (const sp of redoing) value = resplit(value, sp);
    return value;
  };
  /* Certificates first: an award's counter is read against the certificates
     drawn off it, and each of those walks back on its own rounding. */
  const certificates = db.securities.map((s) => {
    if (s.kind !== 'shares') return s;
    const next = { ...s, quantity: holding(s), pricePerShare: scaleP(s.pricePerShare) };
    if (s.transferPricePerShare) next.transferPricePerShare = scaleP(s.transferPricePerShare);
    if (s.repurchasedQty > 0) next.repurchasedQty = repurchased(s);
    if (s.repurchasePricePerShare) next.repurchasePricePerShare = scaleP(s.repurchasePricePerShare);
    if (s.vestingTranches) next.vestingTranches = schedule(s);
    // A share count, so it rewinds with the quantity it is measured against.
    const base = vestingBase(s);
    if (base > 0) next.vestingBase = base;
    const offset = vestingOffset(s);
    if (offset > 0) next.vestingOffset = offset;
    return next;
  });
  /* An award's exercised or settled count in the units of the day: the part
     its certificates stand for is those certificates, walked back one by one
     (a split that rounded any of them wrote it down), and only the part no
     certificate papers scales on its own - the reading applySplit gives the
     counter going forward. Scaled whole, the counter rounded on its own: a
     spent 100-option grant went 1-for-3 to 13 exercised over a 40-share
     certificate kept at 40, read back as 39, and restateForfeitures then
     sized the history to the room above 39 - one option outstanding, one
     more committed and one fewer in the pool, on every date before the
     split, on a grant with nothing left. */
  const paperedNow = { option: certifiedByGrant(db.securities), rsu: certifiedByRsu(db.securities) };
  const paperedThen = { option: certifiedByGrant(certificates), rsu: certifiedByRsu(certificates) };
  const claimed = (s, key) => {
    const counter = Math.max(0, Math.round(Number(s[key]) || 0));
    const loose = Math.max(0, counter - (paperedNow[s.kind].get(s.id) || 0));
    return (paperedThen[s.kind].get(s.id) || 0) + (loose > 0 ? scaleQ(loose) : 0);
  };
  const securities = certificates.map((s) => {
    if (s.kind === 'option') {
      const next = { ...s, quantity: holding(s), strike: scaleP(s.strike) };
      const exercised = claimed(s, 'exercised');
      if (exercised > 0) next.exercised = exercised;
      if (s.vestingTranches) next.vestingTranches = schedule(s);
      return restateForfeitures(next, s);
    }
    if (s.kind === 'warrant') {
      return restateForfeitures({ ...s, quantity: holding(s), strike: scaleP(s.strike) }, s);
    }
    if (s.kind === 'rsu') {
      // Units are share counts with no price attached to restate.
      const next = { ...s, quantity: holding(s) };
      const settled = claimed(s, 'settled');
      if (settled > 0) next.settled = settled;
      if (s.vestingTranches) next.vestingTranches = schedule(s);
      return restateForfeitures(next, s);
    }
    return s;
  });
  // The pool walks back through its own dated events - see poolAsOf, which
  // dbAsOf applies whether or not a split is involved.
  const company = {
    ...db.company,
    valuations: (db.company.valuations || []).map((v) => ({ ...v, fmvPerShare: scaleP(v.fmvPerShare) })),
  };
  const classes = db.classes.map((c) => {
    const next = { ...c, authorized: scaleQ(c.authorized), pricePerShare: scaleP(c.pricePerShare) };
    // Moves with the issue price it is measured against - see recordSplit.
    // Only when the class carries one: writing the key regardless would put
    // an `undefined` conversion price on every unadjusted class.
    if (c.conversionPrice > 0) next.conversionPrice = scaleP(c.conversionPrice);
    return next;
  });
  return { ...db, securities, company, classes };
}

/**
 * Dates on which securities were issued, newest first, with a summary of
 * each - the financings and grant batches a cap table is made of. Picking
 * one and reading the table as of that date shows where things stood the
 * moment it closed.
 */
export function issuanceHistory(db) {
  const byDate = new Map();
  for (const s of db.securities) {
    const date = securityDate(s);
    if (!date) continue;
    /* Transfer successors are the same shares changing hands, already
       counted (at full original size, below) on the day they were issued.
       Listing them again would put a secondary sale in the history as a
       financing-sized issuance on the transfer date. */
    if (s.fromTransferId) continue;
    const entry = byDate.get(date) || { date, count: 0, shares: 0, amount: 0, kinds: new Set() };
    entry.count += 1;
    entry.kinds.add(s.kind);
    if (s.kind === 'shares') {
      // History reports what was issued on the day, so a certificate later
      // closed by a transfer still counts at its full original size here.
      const issued = Math.max(0, Math.round(Number(s.quantity) || 0));
      entry.shares += issued;
      /* The shares a SAFE or note converts into are new; the money behind
         them is not. That cheque is already on this list under the day the
         instrument was signed, so counting the certificate too would report
         a round as bigger than the cash that came in with it - a $5M raise
         closing over $400k of convertibles reading as $5.4M. */
      if (!s.fromConvertibleId) entry.amount += issuedCapital(s);
    } else if (s.kind === 'option' || s.kind === 'rsu' || s.kind === 'warrant') {
      entry.shares += qty(s);
    } else {
      entry.amount += Math.max(0, Number(s.principal) || 0);
    }
    byDate.set(date, entry);
  }
  return [...byDate.values()]
    .map((e) => ({ ...e, kinds: [...e.kinds] }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/* ---------- Upcoming events ---------- */

/**
 * Dated equity events falling in [from, from + horizonMonths]: vesting
 * cliffs, full-vest dates, note maturities, and expirations.
 *
 * Everything here is derived from fields already on the records, and every
 * source field is optional - a grant with no schedule, a note with no
 * maturity, and a warrant with no expiry simply contribute nothing.
 *
 * Each event: { type, date, securityId, label, kind, stakeholderId, name,
 * quantity?, amount? }, sorted by date.
 */
export function upcomingEvents(db, { from, horizonMonths = 12 } = {}) {
  if (!from) return [];
  const until = addMonthsISO(from, horizonMonths);
  if (!until) return [];
  const events = [];
  const holderName = (id) => db.stakeholders.find((h) => h.id === id)?.name || 'Unknown holder';

  const push = (event) => {
    if (!event.date || event.date < from || event.date > until) return;
    events.push({ ...event, name: holderName(event.stakeholderId) });
  };

  const certified = certifiedByGrant(db.securities);
  const certifiedRsu = certifiedByRsu(db.securities);
  /* The certificates themselves, not just their totals: netting a grant's
     vesting against them needs to know how much of each has vested on the
     day being announced, not only how many shares left the grant. */
  const certsByGrant = new Map();
  for (const s of db.securities) {
    if (s.kind === 'shares' && s.fromOptionId && !s.fromTransferId) {
      const list = certsByGrant.get(s.fromOptionId);
      if (list) list.push(s);
      else certsByGrant.set(s.fromOptionId, [s]);
    }
  }
  for (const s of db.securities) {
    const base = { securityId: s.id, label: s.label, kind: s.kind, stakeholderId: s.stakeholderId };

    if (s.kind === 'option' || s.kind === 'shares' || s.kind === 'rsu') {
      // A completed forfeiture stops future vesting; a partial one keeps it. A
      // grant's events cover only what its exercise certificates don't -
      // an early-exercised certificate runs the same schedule and emits
      // its own events for those shares.
      const outstanding = s.kind === 'option'
        ? grantDiluted(s, certified)
        : s.kind === 'rsu' ? rsuDiluted(s, certifiedRsu) : qty(s);
      /* Vesting runs until the recorded stop, or - on a grant - until the
         right to exercise ends, whichever comes first. A stop still ahead
         (a departure dated for next month) leaves every step before it real,
         and the steps after it are not: read as "stopped" outright, a cliff
         landing before the departure dropped off the calendar while the
         forecast beside it counted it; read to the end of the schedule, a
         grant whose window had closed announced it "finishes vesting" months
         after its options had lapsed. */
      const until = [vestingStopDate(s), s.kind === 'option' ? exerciseCutoff(s) : ''].filter(Boolean).sort()[0] || '';
      const stopped = outstanding <= 0 || (!!until && until < from);
      const pushVesting = (event) => { if (!until || event.date <= until) push(event); };
      /* What this security alone reports as vested on a date, netted the way
         `unvestedQuantity` and the vesting forecast net it. The quantities
         below are announcements of shares vesting, and a partly
         early-exercised grant announced its whole schedule while the
         certificate announced its share of the same shares again - a
         1,000-option grant half exercised read as 250 vesting on the grant
         plus 125 on the certificate, on a day when 250 vest in total. */
      const certs = s.kind === 'option' ? (certsByGrant.get(s.id) || []) : [];
      const settled = s.kind === 'rsu' ? (certifiedRsu.get(s.id) || 0) : 0;
      const vestedAt = (date) => {
        if (s.kind === 'option') {
          const certifiedVested = certs.reduce(
            (a, c) => a + Math.min(issuedQty(c), vestedQuantity(c, date)), 0);
          return Math.min(outstanding, Math.max(0, grantVested(s, date) - certifiedVested));
        }
        // A settled unit takes no schedule to its certificate, so the award
        // reports whatever has vested beyond what already settled.
        if (s.kind === 'rsu') return Math.min(outstanding, Math.max(0, rsuVested(s, date) - settled));
        return Math.min(outstanding, vestedQuantity(s, date));
      };
      const tranches = vestingTranches(s);
      if (tranches && !stopped) {
        /* Custom schedules: each dated tranche is its own event, and the
           last one is the day the schedule completes. Except on a certificate
           whose list adds up to more than it holds - a repurchase remainder
           keeps its source's whole schedule against the smaller position and
           vests clamped at its size - where the schedule completes at the
           tranche that reaches the position, and the ones after it vest
           nothing. vestedQuantity reads it that way; so does this list. */
        const last = tranches[tranches.length - 1];
        // Tranches are stored in date order, so the net vested count read at
        // each date less the one read at the tranche before it is what that
        // tranche actually adds here.
        let reported = 0;
        for (const t of tranches) {
          const quantity = Math.max(0, Math.round(Number(t.quantity) || 0));
          if (!t.date || quantity <= 0) continue;
          if (reported >= outstanding) break;
          const netVested = vestedAt(t.date);
          const completes = t === last || netVested >= outstanding;
          const vesting = Math.max(0, netVested - reported);
          reported = netVested;
          if (completes) {
            /* What the schedule reaches by then, not the position: a tranche
               list adding up to less than the award announced the whole award
               vesting on a day only part of it did. */
            pushVesting({ ...base, type: 'vest-complete', date: t.date, quantity: Math.min(outstanding, netVested) });
          } else if (vesting > 0) {
            // A tranche whose shares are all announced on a certificate has
            // nothing of its own to say.
            pushVesting({ ...base, type: 'tranche', date: t.date, quantity: vesting });
          }
        }
      } else if (hasVesting(s) && !stopped) {
        const start = vestingStartDate(s);
        const months = Math.round(Number(s.vestingMonths) || 0);
        const cliff = Math.round(Number(s.cliffMonths) || 0);
        /* Nothing vests before the award exists: a schedule credited with
           prior service can put its cliff before the grant date, and a
           future-dated grant then announced a cliff eleven days before the
           grant. The step vests on the day of grant, as the expense
           schedule reads it. */
        const granted = s.grantDate || s.date || '';
        const onOrAfterGrant = (d) => (granted && d && d < granted ? granted : d);
        let vestDate = onOrAfterGrant(addMonthsISO(start, months));
        /* Same clamp on a time-based schedule: a repurchase remainder measures
           its schedule against the position before the buyback (vestingBase)
           and holds fewer shares than that, so it is fully vested at the step
           that reaches what it holds - months before the schedule's last step,
           which is the date this used to name. */
        if ((s.kind === 'shares' && Number(s.vestingBase) > outstanding) || s.cancelled > 0) {
          for (let m = 1; m <= months; m++) {
            const at = addMonthsISO(start, m);
            if (vestedAt(at) >= outstanding) { vestDate = onOrAfterGrant(at); break; }
          }
        }
        const cliffDate = cliff > 0 ? onOrAfterGrant(addMonthsISO(start, cliff)) : '';
        // When the cliff is the whole schedule these are the same day; the
        // full-vest event says more, so it wins.
        /* And only when something vests on it: a 3-option grant with a
           six-month cliff over 36 vests nothing at the cliff (floor of a
           half share), and a settlement dated past the cliff can already
           have taken what would have. The tranche branch above says nothing
           for an empty tranche; the cliff said "0 vest". */
        const atCliff = cliffDate ? vestedAt(cliffDate) : 0;
        if (cliffDate && cliffDate < vestDate && atCliff > 0) {
          pushVesting({ ...base, type: 'cliff', date: cliffDate, quantity: atCliff });
        }
        pushVesting({ ...base, type: 'vest-complete', date: vestDate, quantity: outstanding });
      }
    }

    if (s.kind === 'shares' && !isClosed(s)) {
      // The most expensive deadline in startup equity: an open 83(b) window
      // on restricted stock. A transferred-away certificate stops reminding.
      const st = status83b(s, from);
      if (st?.state === 'open') push({ ...base, type: '83b-deadline', date: st.deadline, quantity: qty(s) });
    }

    if (s.kind === 'option' && grantOutstanding(s) > grantExercised(s)) {
      /* A post-termination window can close long before the ten-year term,
         and which clock is running is said on the event: a term running out
         is routine, a leaver's window closing is a departure nobody has
         finished - the distinction the needs-attention list and every
         deadline line already draw, and the calendar did not. */
      const cutoff = exerciseCutoff(s);
      push({
        ...base, type: 'expiration', date: cutoff,
        quantity: grantOutstanding(s) - grantExercised(s),
        window: !!s.exerciseBy && cutoff === s.exerciseBy,
      });
    }

    if (s.kind === 'warrant') {
      const quantity = warrantRemaining(s, db.securities, s.expires || todayISO());
      if (quantity > 0) push({ ...base, type: 'expiration', date: s.expires || '', quantity });
    }

    if (s.kind === 'note' && s.maturityDate && !isConverted(s) && !isMatured(s)) {
      push({
        ...base, type: 'maturity', date: s.maturityDate,
        amount: convertibleValue(s, s.maturityDate),
      });
    }
  }

  /* Form 3921: every ISO exercise in a calendar year has to be reported to
     the holder by the January 31 that follows. One company-level event per
     year with exercises, counted off the certificates that date them - the
     same rows the Reports view files from. */
  const grants = new Map(db.securities.filter((s) => s.kind === 'option').map((s) => [s.id, s]));
  const isoByYear = new Map();
  for (const s of db.securities) {
    if (s.kind !== 'shares' || !s.fromOptionId || s.fromTransferId || !s.date) continue;
    if (!isISO(grants.get(s.fromOptionId))) continue;
    const year = Number(s.date.slice(0, 4));
    isoByYear.set(year, (isoByYear.get(year) || 0) + 1);
  }
  for (const [year, count] of isoByYear) {
    // Copy B to the holder, on the same adjusted date form3921Deadlines gives
    // the report - a calendar and a report that disagree are worse than
    // either one being wrong on its own.
    const date = nextBusinessDay(`${year + 1}-01-31`);
    if (date < from || date > until) continue;
    events.push({
      type: 'form-3921', date, year, quantity: count,
      securityId: null, label: 'Form 3921', kind: 'filing', stakeholderId: null,
      name: db.company?.name || '',
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || String(a.label).localeCompare(String(b.label)));
  return events;
}

/* ---------- Needs attention ---------- */

/**
 * Records whose date has passed while their recorded state says otherwise -
 * the things the app already knows are overdue and would otherwise keep
 * counting.
 *
 * The moment an item needs doing is the moment it drops off `upcomingEvents`,
 * which only looks forward. This is the other half of that list:
 *
 *  - 'grant-expired'  a grant past its term or its post-termination window,
 *                     with options still unexercised: they still sit in the
 *                     diluted base and still count as drawn from the pool
 *                     until someone cancels them.
 *  - 'warrant-expired' expired unexercised rights, retained for review
 *                     but excluded from current dilution and exit proceeds.
 *  - 'note-matured'   a note past its maturity date that has not converted
 *                     and whose maturity has not been recorded as handled.
 *  - '83b-missed'     restricted stock whose 30-day window lapsed with no
 *                     election recorded and no acknowledgement that none was
 *                     filed.
 *  - 'fmv-stale'      the 409A on file is past the twelve-month refresh
 *                     trigger, or a priced round closed after it was set.
 *  - 'rsu-departed'   an RSU award still holding units that were unvested
 *                     the day its holder departed. The departure flow
 *                     cancels a leaver's unvested options in the same commit
 *                     and leaves RSU awards to their own cancel sheet, and
 *                     once that sheet was closed nothing said so again: the
 *                     units kept vesting, drawn from the pool and in the
 *                     diluted base, for a holder no longer earning them.
 *  - 'class-over-authorized' a share class holding more issued shares than
 *                     its charter authorizes. Every sheet that issues shares
 *                     says so before the write and the classes table after,
 *                     but nothing else did: the one state on the table that
 *                     needs a charter amendment sat on one page. Dated the day
 *                     the class first went over.
 *  - 'grant-departed' the same for an option grant. The departure flow
 *                     forfeits what was unvested on the day, but a grant
 *                     recorded afterwards and dated before it - a backfill,
 *                     an import, a cancellation undone - never went through
 *                     that flow, and kept vesting for a holder who had left
 *                     with nothing to say so. A grant already past its
 *                     window is the expired item's to clear, not this one's.
 *
 * Nothing here changes a record: the point is to surface and offer.
 *
 * Each item: { type, id, date, title, detail, securityId?, stakeholderId?,
 * quantity?, amount? }, most overdue first.
 */
export function attentionItems(db, { asOf } = {}) {
  if (!asOf) return [];
  const items = [];
  const holders = new Map((db.stakeholders || []).map((h) => [h.id, h]));
  const holderName = (id) => holders.get(id)?.name || 'Unknown holder';

  for (const s of db.securities) {
    if (s.kind === 'option') {
      const unexercised = grantOutstanding(s) - grantExercised(s);
      if (unexercised > 0 && grantStatus(s, asOf) === 'expired') {
        const cutoff = exerciseCutoff(s);
        // Which clock ran out matters: a ten-year term expiring is routine,
        // a post-termination window closing is a departure nobody finished.
        const postTermination = !!s.exerciseBy && s.exerciseBy === cutoff;
        items.push({
          type: 'grant-expired',
          id: `grant-expired:${s.id}`,
          securityId: s.id,
          stakeholderId: s.stakeholderId,
          date: cutoff,
          quantity: unexercised,
          title: `${s.label} expired`,
          detail: postTermination
            ? `${holderName(s.stakeholderId)}’s post-termination window closed`
            : `${holderName(s.stakeholderId)}’s grant reached the end of its term`,
        });
      }
    }

    // Keep expired rights visible for reconciliation, without dilution.
    if (s.kind === 'warrant' && s.expires && s.expires < asOf
      && warrantRemaining(s, db.securities, s.expires) > 0) {
      items.push({
        type: 'warrant-expired',
        id: `warrant-expired:${s.id}`,
        securityId: s.id,
        stakeholderId: s.stakeholderId,
        date: s.expires,
        quantity: warrantRemaining(s, db.securities, s.expires),
        title: `${s.label} expired`,
        detail: `${holderName(s.stakeholderId)}’s warrant lapsed unexercised`,
      });
    }

    if (s.kind === 'note' && s.maturityDate && !isConverted(s) && !isMatured(s)
      && s.maturityDate < asOf) {
      items.push({
        type: 'note-matured',
        id: `note-matured:${s.id}`,
        securityId: s.id,
        stakeholderId: s.stakeholderId,
        date: s.maturityDate,
        amount: convertibleValue(s, s.maturityDate),
        title: `${s.label} matured`,
        detail: `Held by ${holderName(s.stakeholderId)}`,
      });
    }

    if (s.kind === 'rsu' || s.kind === 'option') {
      /* Measured on the schedule as granted, the way the cancel sheet's own
         default is: what had vested by the day the holder left is theirs,
         and so is anything already settled or exercised. Cleared by
         cancelling the rest, which is what the sheet offers. An award
         granted after the departure was never theirs to forfeit on it, and
         a grant whose window has already closed is listed as expired above,
         where the cancel offered takes everything unexercised with it. */
      const units = s.kind === 'rsu';
      const left = holders.get(s.stakeholderId)?.departed || '';
      const granted = s.grantDate || s.date || '';
      const lapsed = !units && grantStatus(s, asOf) === 'expired';
      if (left && left <= asOf && !(granted > left) && !lapsed) {
        const outstanding = grantOutstanding(s);
        const earned = Math.min(outstanding,
          Math.max(vestedQuantity({ ...s, cancelledDate: '', vestingStoppedAt: '' }, left),
            units ? rsuSettled(s) : grantExercised(s)));
        if (outstanding - earned > 0) {
          const type = units ? 'rsu-departed' : 'grant-departed';
          items.push({
            type,
            id: `${type}:${s.id}`,
            securityId: s.id,
            stakeholderId: s.stakeholderId,
            date: left,
            quantity: outstanding - earned,
            title: `${s.label} still vests after a departure`,
            detail: `${holderName(s.stakeholderId)} departed with ${units ? 'units' : 'options'} unvested, `
              + `and the ${units ? 'award' : 'grant'} still holds them`,
          });
        }
      }
    }

    if (s.kind === 'shares' && !isClosed(s)) {
      const st = status83b(s, asOf);
      if (st?.state === 'missed' && !st.acknowledged) {
        items.push({
          type: '83b-missed',
          id: `83b-missed:${s.id}`,
          securityId: s.id,
          stakeholderId: s.stakeholderId,
          date: st.deadline,
          quantity: qty(s),
          title: `${s.label} has no 83(b) election on file`,
          detail: `The 30-day window for ${holderName(s.stakeholderId)} closed`,
        });
      }
    }
  }

  /* A plan past its expiration date with shares still reserved under it:
     nothing more can be granted from them, yet they go on sitting in the
     fully diluted count until the plan is retired or extended. */
  for (const plan of plansOf(db.company)) {
    if (!planIsOpen(plan) || !plan.expires || plan.expires >= asOf) continue;
    const row = planBalances(db).plans.find((r) => r.planId === plan.id);
    if (!row || row.available <= 0) continue;
    items.push({
      type: 'plan-expired',
      id: `plan-expired:${plan.id}`,
      planId: plan.id,
      date: plan.expires,
      quantity: row.available,
      title: `${plan.name} expired`,
      detail: 'Its unallocated shares still count as fully diluted; retire the plan or extend it',
    });
  }

  for (const cls of db.classes || []) {
    if (!(cls.authorized > 0)) continue;
    const issued = issuedInClass(db.securities, cls.id);
    if (issued <= cls.authorized) continue;
    /* The day the count was passed: the open certificates in date order,
       until their running total went over. */
    let running = 0;
    let since = '';
    for (const s of db.securities.filter((x) => x.kind === 'shares' && x.classId === cls.id && !x.closedAt)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
      running += qty(s);
      if (running > cls.authorized) { since = s.date || asOf; break; }
    }
    items.push({
      type: 'class-over-authorized',
      id: `class-over-authorized:${cls.id}`,
      classId: cls.id,
      date: since || asOf,
      quantity: issued - cls.authorized,
      issued,
      authorized: cls.authorized,
      title: `${cls.name} holds more shares than it is authorized to issue`,
      detail: 'That is what a charter amendment is for; raise the authorized shares under Share classes once it is signed',
    });
  }

  const fmv = fmvStatus(db, asOf);
  if (fmv.current && (fmv.stale || fmv.roundSince)) {
    items.push({
      type: 'fmv-stale',
      id: 'fmv-stale',
      date: fmv.roundSince ? fmv.roundSince.date : fmv.current.date,
      title: fmv.roundSince
        ? 'The 409A predates your latest priced round'
        : `The 409A on file is ${fmv.months} months old`,
      detail: fmv.roundSince
        ? 'Strikes granted against it are being checked against a stale number'
        : 'Twelve months is the usual refresh trigger',
    });
  }

  return items.sort((a, b) => String(a.date).localeCompare(String(b.date))
    || String(a.title).localeCompare(String(b.title)));
}

/* ---------- Exit waterfall ---------- */

const EPS = 1e-6;
const WATERFALL_PASSES = 24;

/** What each preferred class put in, and what it can claim off the top. */
function preferredStack(db) {
  return db.classes
    .filter((c) => c.kind === 'preferred')
    .map((c) => {
      const invested = db.securities
        .filter((s) => s.kind === 'shares' && s.classId === c.id)
        .reduce((a, s) => a + qty(s) * (Number(s.pricePerShare) || 0), 0);
      const multiple = Math.max(0, Number(c.liquidationMultiple) || 0);
      return {
        classId: c.id,
        name: c.name,
        seniority: Math.max(0, Math.round(Number(c.seniority) || 0)),
        participating: !!c.participating,
        multiple,
        invested,
        preference: invested * multiple,
        shares: issuedInClass(db.securities, c.id),
      };
    });
}

/**
 * Options, RSUs and warrants: the awards that turn into shares at a sale.
 *
 * An option or warrant costs its strike to take part; an RSU costs nothing,
 * so it settles at the exit price with no strike to net out - which is why it
 * carries a strike of zero here rather than a special case downstream.
 *
 * By default every outstanding award participates regardless of vesting - the
 * historical behavior, and the right one when the deal lets unvested awards
 * roll over or cash out. `unvestedOptions: 'cancel'` caps each option grant
 * and RSU award at its vested count instead (unvested awards are cancelled at
 * close), and `changeOfControl` first applies any recorded acceleration
 * terms, which is the only situation where they bite.
 */
function equityAwards(db, { asOf, changeOfControl = false, unvestedOptions = 'participate' } = {}) {
  const certified = certifiedByGrant(db.securities);
  const certifiedRsu = certifiedByRsu(db.securities);
  /* The exercise certificates behind each grant, for the vested cap below -
     the same grouping unvestedTotal and the vesting forecast net against. */
  const certsByGrant = new Map();
  if (unvestedOptions === 'cancel') {
    for (const s of db.securities) {
      if (s.kind !== 'shares' || !s.fromOptionId || s.fromTransferId) continue;
      const list = certsByGrant.get(s.fromOptionId);
      if (list) list.push(s);
      else certsByGrant.set(s.fromOptionId, [s]);
    }
  }
  const vestedOf = (s) => (changeOfControl ? acceleratedVested(s, asOf) : grantVested(s, asOf));
  const awards = [];
  for (const s of db.securities) {
    if (s.kind !== 'option' && s.kind !== 'rsu' && s.kind !== 'warrant') continue;
    const vests = s.kind === 'option' || s.kind === 'rsu';
    const index = s.kind === 'rsu' ? certifiedRsu : certified;
    // Same count as dilutedShares(s, db.securities), off the shared indexes.
    let n = vests
      ? Math.max(0, grantOutstanding(s) - (index.get(s.id) || 0))
      : warrantRemaining(s, db.securities, asOf);
    if (vests && unvestedOptions === 'cancel') {
      const vested = vestedOf(s);
      /* What the certificates took out of the vested part. A settled RSU and
         an ordinary exercise took vested units, so their whole size comes
         off. An early-exercised certificate carries the grant's schedule with
         it and reports its own unvested shares - which stay outstanding, and
         are paid as shares below - so only its vested part comes off here:
         the convention unvestedQuantity and the vesting forecast already
         follow. Netting the whole certificate cancelled its unvested shares
         out of the grant a second time, while the certificate kept them. */
      const certifiedVested = s.kind === 'rsu'
        ? (index.get(s.id) || 0)
        : (certsByGrant.get(s.id) || []).reduce((a, c) => (
          a + Math.min(issuedQty(c), hasVesting(c)
            ? (changeOfControl ? acceleratedVested(c, asOf) : vestedQuantity(c, asOf))
            : issuedQty(c))), 0);
      n = Math.min(n, Math.max(0, vested - certifiedVested));
    }
    if (n <= 0) continue;
    awards.push({
      id: s.id, label: s.label, kind: s.kind,
      stakeholderId: s.stakeholderId,
      shares: n,
      // An RSU has nothing to pay in, so it is in the money at any price.
      strike: s.kind === 'rsu' ? 0 : Math.max(0, Number(s.strike) || 0),
    });
  }
  return awards;
}

/**
 * Pay the preference stack, most senior first, pro rata inside a tier when
 * the money runs out mid-tier. Returns what each class got and what is left.
 */
function payPreferences(stack, exitValue, converted) {
  const paid = new Map();
  let available = Math.max(0, exitValue);
  const claiming = stack.filter((p) => !converted.has(p.classId) && p.preference > 0);
  const tiers = [...new Set(claiming.map((p) => p.seniority))].sort((a, b) => b - a);
  for (const tier of tiers) {
    const members = claiming.filter((p) => p.seniority === tier);
    const want = members.reduce((a, p) => a + p.preference, 0);
    const pay = Math.min(available, want);
    for (const p of members) paid.set(p.classId, want > 0 ? (p.preference / want) * pay : 0);
    available -= pay;
  }
  return { paid, residual: available };
}

/**
 * Distribute the residual over everything that shares pro rata, solving for
 * the per-share price. Option and warrant holders pay their strike to take
 * part, so their exercise money joins the pot and their shares join the
 * denominator - but only while they are in the money, which depends on the
 * price they are helping to set. Hence the fixed point.
 */
function residualPrice(residual, baseShares, awards) {
  // A set, not a list: the membership test runs once per award per pass, and
  // the breakeven search re-runs the whole waterfall dozens of times.
  let inMoney = new Set(awards.map((a) => a.id));
  const priceOver = (ids) => {
    const live = awards.filter((a) => ids.has(a.id));
    const shares = baseShares + live.reduce((a, x) => a + x.shares, 0);
    const proceeds = residual + live.reduce((a, x) => a + x.shares * x.strike, 0);
    return shares > 0 ? proceeds / shares : 0;
  };
  /* The set can only shrink, and by at least one award per pass that
     changes it, so one pass more than there are awards always reaches the
     fixed point; a fixed count ran out on strikes that cascade. */
  const passes = Math.max(WATERFALL_PASSES, awards.length + 1);
  for (let i = 0; i < passes; i++) {
    const price = priceOver(inMoney);
    /* In the money by a hair more than float noise - relative to the
       figures, not an absolute millionth of a dollar. Below a millionth per
       share (a token exit over tens of millions of awards) the absolute
       margin put every award with a strike under the price out of the
       money, which raised the price without them and brought them all back
       in: a cycle, not a fixed point, that the pass count ended with a price
       set over one set and reported beside another, paying out many times
       the exit. Dropping an award whose strike is above the price only
       lowers it, so the set shrinks monotonically and an unchanged size
       means an unchanged set. */
    const next = new Set(awards.filter((a) => price > a.strike + Math.max(a.strike, price) * 1e-9).map((a) => a.id));
    if (next.size === inMoney.size) break;
    inMoney = next;
  }
  // Priced over the set being returned, so the two always agree.
  return { price: priceOver(inMoney), inMoney };
}

/**
 * The convertibles still outstanding at an exit, valued to the closing date.
 *
 * A note is debt: principal plus interest accrued to that date. A SAFE is an
 * election between its money back and converting - and its money is the
 * principal, which is what `convertibleValue` returns for one.
 */
function convertibleClaims(db, asOf) {
  return convertibles(db.securities).map((s) => ({
    security: s,
    id: s.id,
    label: s.label,
    kind: s.kind,
    stakeholderId: s.stakeholderId,
    value: convertibleValue(s, asOf),
  }));
}

/** Pay one tier of equal-ranking money claims, pro rata when it runs short. */
function payTier(claims, available) {
  const want = claims.reduce((a, c) => a + c.value, 0);
  const pay = Math.min(Math.max(0, available), want);
  const paid = new Map();
  for (const c of claims) paid.set(c.id, want > 0 ? (c.value / want) * pay : 0);
  return { paid, pay, left: Math.max(0, available - pay) };
}

/**
 * The residual per-share price when converting SAFEs share in it.
 *
 * Their share count depends on the price - an uncapped SAFE converts at it -
 * and a post-money cap divides by a capitalization that already counts the
 * shares the SAFE receives, so this is the same fixed point `modelRound`
 * solves, with the exit price standing in for a round price. Every term is
 * monotone in the price, so plain iteration settles.
 *
 * Returns the price, the in-the-money awards, and each converting SAFE's
 * share count.
 */
function residualPriceWithConvertibles(residual, baseShares, awards, converting, fdPre) {
  /* No shares to show: either nothing is converting, or nothing can. */
  const none = () => ({
    ...residualPrice(residual, baseShares, awards), shares: new Map(), convertingShares: 0,
  });
  if (!converting.length) return none();

  /* The shares the convertibles take when `extra` of them are already in
     the denominator: the residual price at that count, the capitalization
     the caps divide by (settled the way modelRound settles it), and each
     instrument's count at its own conversion price. */
  const sharesAt = (extra) => {
    const out = residualPrice(residual, baseShares + extra, awards);
    const { companyCap } = convertedShares(converting, out.price, fdPre);
    const shares = new Map();
    let total = 0;
    for (const c of converting) {
      const price = conversionPrice(c.security, out.price, fdPre, companyCap);
      const n = price > 0 ? c.value / price : 0;
      shares.set(c.id, n);
      total += n;
    }
    return { out, shares, total };
  };

  /* The fixed point is where the count the convertibles take equals the count
     assumed for them. Taking is non-decreasing in the count assumed (more
     shares, lower price, more shares bought), and the runaway clamp bounds it
     above - so if the top of the range still takes more than it assumes, there
     is no fixed point at all: converting at a residual that cannot pay the
     SAFE money buys more shares at a lower price on every pass, without end.
     The payout was always right in that case, but the count reached the
     screen - a $250k SAFE against $93k of residual reported converting into
     39,794,348,376,961,870,000 shares at $0.0000 - so it reports no shares,
     which the election reads as money owed and whatever is left to pay it,
     the same election the holder would make.

     Bisection, not plain iteration. Iterating shares = value / price settles
     at a rate of (SAFE money / residual) per pass, so a SAFE worth 60% of what
     was left to share was still 1e-6 short of its own money after two dozen
     passes and lost the tie it was meant to win - reading "takes money back"
     with no shares on a cap table where converting pays exactly the same -
     and the breakeven that walks the waterfall to find where a SAFE converts
     landed 1.7x above the true exit. Halving the bracket lands to the same
     precision in the same number of steps whatever the ratio. */
  const limit = fdPre * MAX_CAP_MULTIPLE;
  let lo = 0;
  let hi = limit;
  let atLo = sharesAt(lo);
  if (atLo.total <= 0) return { ...atLo.out, shares: atLo.shares, convertingShares: 0 };
  if (!(sharesAt(hi).total <= hi)) return none();
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const at = sharesAt(mid);
    if (at.total > mid) { lo = mid; atLo = at; } else hi = mid;
    if (hi - lo <= Math.max(1e-6, lo * 1e-9)) break;
  }
  const extra = atLo.total;
  /* The price is evaluated once more against the share counts being returned,
     so the two are always consistent with each other. */
  const out = residualPrice(residual, baseShares + extra, awards);
  return { ...out, shares: atLo.shares, convertingShares: extra };
}

/**
 * Distribute exit proceeds across the cap table.
 *
 * The stack, in order:
 *  1. Convertible notes. A note is a loan, so principal plus interest accrued
 *     to the closing date is repaid off the top, ahead of every share.
 *  2. Pre-money SAFEs that elected their money back: the purchase amount is
 *     due immediately prior to the event, ahead of every share, pro rata
 *     among them when the funds run short.
 *  3. The preference stack, most senior first (multiple x what the class
 *     actually invested), pro rata inside a tier when the money runs out -
 *     with the post-money SAFEs that elected their money back ranking on par
 *     with the preferred as a whole: when what is left cannot cover every
 *     preference and every such cash-out, they share it pro rata by claim,
 *     and the preferred divide their share by seniority.
 *  4. Everything left, shared pro rata by common, converted preferred,
 *     participating preferred, converting SAFEs, and every in-the-money
 *     option, RSU and warrant.
 *
 * Two independent elections are settled together by iteration, because each
 * one changes the price the other is judged against: a non-participating
 * preferred class takes whichever is better - its preference or converting -
 * and a SAFE takes whichever is better, its money back or converting at the
 * exit price (the standard on both the pre-money and post-money forms). A
 * SAFE's cap divides by the liquidity capitalization, which leaves out the
 * unissued option pool.
 *
 * Deliberately not modeled, and surfaced to the caller instead of guessed at:
 *  - MFN clauses, pro-rata side letters, and multi-tranche notes.
 *  - The unallocated option pool, which nobody holds and so gets nothing.
 *  - Escrow, carve-outs, deal fees, and tax.
 *
 * Participation caps and preferred dividends are modeled, but by the
 * negotiated waterfall in financing-waterfall.js, which takes over the whole
 * distribution as soon as any class carries dated preferred terms.
 */
export function exitWaterfall(db, opts = {}) {
  return exitWaterfallAt(dbAsOf(db, opts.asOf), opts);
}

// Both waterfall engines read the same dated table. The breakeven search
// reuses that snapshot without unwinding its stock splits a second time.
function exitWaterfallAt(db, { exitValue, asOf, changeOfControl = false, unvestedOptions = 'participate' } = {}) {
  /* Dated preferred terms - participation caps, dividends - are settled by the
     negotiated waterfall, which refuses what it cannot model. A table without
     them never reaches it and prices exactly as before. */
  const effectiveOnExit = (term) => !asOf || term.date <= asOf;
  if (db.classes.some((c) => c.preferredTerms?.some(effectiveOnExit))
    || db.securities.some((s) => s.dividendEvents?.some(effectiveOnExit))) {
    try {
      return negotiatedWaterfall(db, {
        exitValue, asOf,
        awards: equityAwards(db, { asOf, changeOfControl, unvestedOptions }),
        claims: convertibleClaims(db, asOf),
      });
    } catch (err) {
      if (err instanceof FinancingError) return { unsupported: err.message };
      throw err;
    }
  }

  const exit = Math.max(0, Number(exitValue) || 0);
  const stack = preferredStack(db);
  const awards = equityAwards(db, { asOf, changeOfControl, unvestedOptions });
  const preferredIds = new Set(stack.map((p) => p.classId));
  const commonShares = db.securities
    .filter((s) => s.kind === 'shares' && !preferredIds.has(s.classId))
    .reduce((a, s) => a + qty(s), 0);
  const claims = convertibleClaims(db, asOf);
  const notes = claims.filter((c) => c.kind === 'note');
  const safes = claims.filter((c) => c.kind === 'safe');
  /* The basis a cap divides by at a sale: the SAFE's liquidity
     capitalization. Every share, award and warrant on the table - and, for a
     post-money SAFE, every converting instrument's own shares - but not the
     unissued option pool. The round model's company capitalization keeps the
     pool, because at a financing the pool is part of what the new money is
     priced against; at a liquidity event nobody holds it, and both SAFE forms
     leave it out. Read with it in, the cap divided by a larger count, the
     SAFE converted into more shares than its instrument gives it, and every
     other holder paid for the difference. */
  const fdPre = fullyDiluted(db.securities, db.company, { includePool: false });

  /* Where each SAFE form puts its money-back leg. The pre-money form makes
     the purchase amount due immediately prior to the event, ahead of every
     share, pro rata among such SAFEs when the funds run short. The post-money
     form ranks it on par with the preferred stock and other SAFEs, senior to
     common, and pro rata "in proportion to the full payments that would
     otherwise be due" when the proceeds cannot cover them all. */
  const preMoneySafes = safes.filter((c) => !isPostMoneySafe(c.security));
  const postMoneySafes = safes.filter((c) => isPostMoneySafe(c.security));

  /* The money owed ahead of the residual, which no residual price enters:
     the notes, the pre-money SAFEs taking their money, and the pool the
     post-money SAFEs taking theirs share with the preferences. On its own so
     the election can ask what a SAFE's money back would pay, every other
     election as it stands, without pricing a residual the answer never
     reads - re-solving the whole waterfall for it made the breakeven search,
     a few dozen waterfalls per point, two to three times slower. */
  const moneyLegs = (converted, cashOut) => {
    // Debt first: a loan is repaid before any share of the company is.
    const debt = payTier(notes, exit);
    // Pre-money SAFEs taking their money: paid before any share is.
    const ahead = payTier(preMoneySafes.filter((c) => cashOut.has(c.id)), debt.left);
    /* Post-money SAFEs taking their money rank with the preferred as a whole:
       one pool by claim when what is left cannot cover every preference and
       every such cash-out, and the preferred then divide their share of it
       by their own seniority. A charter that stacks its series says nothing
       about the SAFE, and the SAFE says "Preferred Stock" without naming a
       series, so the pool reads the phrase as written. */
    const alongside = postMoneySafes.filter((c) => cashOut.has(c.id));
    const safeWant = alongside.reduce((a, c) => a + c.value, 0);
    const preferenceWant = stack.reduce((a, p) => (converted.has(p.classId) ? a : a + p.preference), 0);
    const pool = safeWant + preferenceWant;
    const toSafes = pool > 0 ? Math.min(safeWant, (ahead.left * safeWant) / pool) : 0;
    const level = payTier(alongside, toSafes);
    return {
      debt,
      paid: new Map([...ahead.paid, ...level.paid]),
      pay: ahead.pay + level.pay,
      // What reaches the preference stack.
      forPreferences: ahead.left - level.pay,
    };
  };

  const solve = (converted, cashOut) => {
    const legs = moneyLegs(converted, cashOut);
    const { paid, residual } = payPreferences(stack, legs.forPreferences, converted);
    const cash = { paid: legs.paid, pay: legs.pay, left: residual };
    const { debt } = legs;
    const baseShares = commonShares + stack.reduce((a, p) => (
      converted.has(p.classId) || p.participating ? a + p.shares : a), 0);
    const converting = safes.filter((c) => !cashOut.has(c.id));
    const { price, inMoney, shares, convertingShares } = residualPriceWithConvertibles(
      cash.left, baseShares, awards, converting, fdPre);
    return {
      debt, paid, cash, residual: cash.left,
      price, inMoney, baseShares, safeShares: shares, convertingShares,
    };
  };

  /**
   * What converting would pay one SAFE, with every other election left as it
   * stands: the waterfall re-solved with it back among the converting.
   *
   * A SAFE that has elected cash holds no shares in the solution, so the
   * solution says nothing about what converting would pay it - the question
   * has to be asked by re-solving. Both the election and the report it
   * produces ask it here, which is why they cannot disagree.
   *
   * A SAFE only takes its money back when the residual cannot cover it, and
   * there converting has no finite answer: each pass buys more shares at a
   * lower price, and in the limit the SAFE takes the whole residual. That is
   * what this leg would pay, and what the money-back leg pays too - which is
   * why the election is a tie there and goes to the money.
   */
  const convertingLeg = (id, converted, cashOut) => {
    const alt = solve(converted, new Set([...cashOut].filter((x) => x !== id)));
    const shares = alt.safeShares.get(id) || 0;
    if (shares > 0) return { shares, value: shares * alt.price };
    const value = safes.find((c) => c.id === id)?.value || 0;
    return { shares: 0, value: Math.min(value, alt.residual) };
  };

  /* Election pass: a preferred class converts when that beats its preference,
     and a SAFE converts when that beats its money back. Each election changes
     the price the other is judged against, so the whole set is re-evaluated
     until it stops moving. A tie goes to whichever leg the instrument is
     already on, which is what keeps the pass from oscillating between two
     equal answers.

     The SAFEs are settled first, with the preferred elections held still,
     and only then are the preferred classes judged - against the price the
     settled SAFEs leave, never one they cannot. Judged in the same pass, the
     two elections chased each other: two discounted SAFEs whose joint
     conversion had no answer left a price set over the common alone, as if
     they took nothing, and the preferred converted on it; with its
     preference out of the stack the joint conversion had an answer and both
     SAFEs converted; at that price the preferred walked back, which took the
     answer away again - and so on, two states apart, until the passes ran
     out. Whichever state they ran out on, the exit table then paid a SAFE
     its $3,000,000 back beside a conversion it said would have paid
     $3,750,000, while the state the rule actually settles in - that SAFE
     converting, the other in cash - was never visited. With the preferred
     set held still, every walk-back below is judged in the state it lands
     in. */
  const elect = (seedConverted, seedCash) => {
    const same = (a, b) => a.size === b.size && [...a].every((id) => b.has(id));
    /* Money is compared with a tolerance that scales, because the two legs
       of this election are equal by construction whenever the cap and the
       discount leave the exit price standing: converting at the exit price
       buys exactly the money back. The converted leg is that same money
       re-derived through a fixed point, so it lands a rounding error under
       it - and against a flat epsilon of a millionth of a dollar, every
       ordinary SAFE lost a tie it was meant to win and read as taking its
       money back off the top rather than converting into shares. A
       millionth of the amount is far beneath any difference a cap or a
       discount makes, and far above the iteration's own noise. */
    const tieOn = (a, b) => Math.max(EPS, Math.max(a, b) * 1e-6);

    /* The SAFE elections settled, with the preferred set as given. */
    const settleSafes = (converted, cashOut) => {
      let solution = solve(converted, cashOut);
      /* Enough passes for every election to move once. SAFEs in cash walk back
         to converting one per pass when their joint conversion has no answer
         (below), so a fixed count of passes was a cap on how many could ever
         convert: past two dozen live SAFEs the loop ran out with the rest
         still in cash, each reported beside an as-converted figure larger than
         what it was paid. The same sizing residualPrice gives its own loop. */
      const passes = Math.max(WATERFALL_PASSES, safes.length + 2);
      for (let i = 0; i < passes; i++) {
        const nextCash = new Set();
      /* SAFEs in cash walk back to converting one per pass, the one that
         gains most first. Each is judged with the others left in cash, and
         moving every one that would gain at once sent them all back together
         into a joint conversion that has no answer - two discounted SAFEs
         whose claims together exceed the residual - and the pass after sent
         them all to cash again, without end. The pass count ended that cycle
         on the converting side, with every SAFE holding no shares and paid
         nothing while common took the money they were owed. One at a time,
         the second finds the first already converting and stays in cash. */
      const walkBack = [];
      for (const c of safes) {
        if (cashOut.has(c.id)) {
          /* Already in cash, so this solution shows it no shares - and
             reading that as "cannot convert" is what used to hold it there
             for good. Every pass in which the all-converting solve has no
             finite price moves every SAFE to cash at once, and one that could
             have converted comfortably once the others were paid off never
             got asked again: it kept $1,000 while the model's own report said
             converting would have paid it $1,111. It moves back only on a
             strict improvement, so a tie leaves it where it is. */
          const back = solution.cash.paid.get(c.id) || 0;
          const alt = convertingLeg(c.id, converted, cashOut);
          nextCash.add(c.id);
          if (alt.shares > 0 && alt.value > back + tieOn(back, alt.value)) {
            walkBack.push({ id: c.id, gain: alt.value - back });
          }
          continue;
        }
        const shares = solution.safeShares.get(c.id) || 0;
        const asConverted = shares * solution.price;
        /* What the money-back leg would actually pay: the money legs read
           with this SAFE in cash, everything else as it stands. The whole
           value when the proceeds cover it, less when they don't - a SAFE
           cannot elect its way to money that isn't there - and, for a
           post-money SAFE, a share of a pool the preferred are in too, which
           no figure of the converting solution can read off. */
        const backNow = moneyLegs(converted, new Set([...cashOut, c.id])).paid.get(c.id) || 0;
        /* A SAFE with no shares to show has not converted in any meaningful
           sense - the residual it would have converted into is gone. It reads
           as what it is: money owed, and whatever is left to pay it. */
        if (shares <= 0 || backNow > asConverted + tieOn(backNow, asConverted)) nextCash.add(c.id);
      }
      if (walkBack.length) {
        /* Together when the joint conversion has an answer - one solve to
           ask - and otherwise the one that gains most. One per pass every
           time made a waterfall with twenty SAFEs in cash take twenty passes
           of twenty re-solves each, and the breakeven card, which walks the
           waterfall a few dozen times per point, took seconds to fill. */
        let back = walkBack.map((w) => w.id);
        if (back.length > 1) {
          const joint = solve(converted, new Set([...nextCash].filter((id) => !back.includes(id))));
          if (back.some((id) => !(joint.safeShares.get(id) > 0))) {
            back = [walkBack.reduce((a, b) => (b.gain > a.gain ? b : a)).id];
          }
        }
        for (const id of back) nextCash.delete(id);
      }
        if (same(nextCash, cashOut)) break;
        cashOut = nextCash;
        solution = solve(converted, cashOut);
      }
      return { cashOut, solution };
    };

    let converted = seedConverted;
    let cashOut = seedCash;
    let solution;
    const passes = Math.max(WATERFALL_PASSES, stack.length + 2);
    for (let i = 0; ; i++) {
      /* Before the classes are judged, and once more after the last pass, so
         the solution returned is settled for the set it returns. */
      ({ cashOut, solution } = settleSafes(converted, cashOut));
      if (i >= passes) break;
      const nextConverted = new Set();
      for (const p of stack) {
        // A participating class already gets its preference *and* a pro-rata
        // share, so converting can never pay it more (no caps are modeled).
        if (p.participating || p.shares <= 0) continue;
        const keep = converted.has(p.classId) ? p.preference : (solution.paid.get(p.classId) || 0);
        if (p.shares * solution.price > keep + EPS) nextConverted.add(p.classId);
      }
      if (same(nextConverted, converted)) break;
      converted = nextConverted;
    }
    /* Whatever the passes ended on, a SAFE left on the converting leg with no
       shares to show has converted into nothing: the joint conversion it was
       part of had no answer. It is money owed, and is paid as such off the
       top like every other cash election - never reported converted and paid
       nothing. Re-solved once; the elections stand as they were made. */
    const stranded = safes.filter((c) => !cashOut.has(c.id) && !(solution.safeShares.get(c.id) > 0));
    if (stranded.length) {
      cashOut = new Set([...cashOut, ...stranded.map((c) => c.id)]);
      solution = solve(converted, cashOut);
    }
    return { converted, cashOut, solution };
  };

  /* Seeded with every SAFE converting: that is the ordinary outcome, and a
     SAFE that would rather have its money back walks back to it in the pass
     above. Seeding the other way cannot bootstrap - a SAFE holding no shares
     yet sees no as-converted value to compare against. */
  let { converted, cashOut, solution } = elect(new Set(), new Set());
  /* The election judges converting against the current per-share price - but
     when nothing shares pro rata yet (preferred-only cap table, no common
     issued), that price is zero and no class can ever bootstrap into
     converting, stranding everything above the preference stack. Re-run the
     election assuming conversion, and let each class walk back to its
     preference if that pays more. */
  if (solution.residual > EPS && solution.price <= 0) {
    const all = new Set(stack.filter((p) => !p.participating && p.shares > 0).map((p) => p.classId));
    if (all.size) ({ converted, cashOut, solution } = elect(all, cashOut));
  }

  const { paid, debt, cash, residual, price, inMoney, safeShares } = solution;

  /* The leg an election did not take, priced as if it had been: the waterfall
     re-solved with that one class converting, or that one SAFE converting,
     everything else as elected. The table shows both legs beside each
     outcome, and multiplying a non-converting class's shares by the price it
     declined to share in understated the alternative - the price would have
     been set over its shares too, with its preference back in the residual -
     while a SAFE that took its money back read "as converted: \$0". */
  const classWouldConvert = (classId) => {
    const alt = solve(new Set([...converted, classId]), cashOut);
    return (stack.find((p) => p.classId === classId)?.shares || 0) * alt.price;
  };
  const safeWouldConvert = (id) => convertingLeg(id, converted, cashOut).value;

  /* Per-holder proceeds. */
  const rows = new Map();
  const add = (stakeholderId, patch) => {
    const row = rows.get(stakeholderId) || {
      stakeholderId, shares: 0, preference: 0, participation: 0, proceeds: 0,
    };
    row.shares += patch.shares || 0;
    row.preference += patch.preference || 0;
    row.participation += patch.participation || 0;
    row.proceeds += (patch.preference || 0) + (patch.participation || 0);
    rows.set(stakeholderId, row);
  };

  for (const s of db.securities) {
    if (s.kind !== 'shares') continue;
    const n = qty(s);
    if (n <= 0) continue;
    const cls = stack.find((p) => p.classId === s.classId);
    if (!cls) {
      add(s.stakeholderId, { shares: n, participation: n * price });
      continue;
    }
    if (converted.has(cls.classId)) {
      add(s.stakeholderId, { shares: n, participation: n * price });
    } else {
      // The preference returns invested capital, so a class splits it by what
      // each certificate paid in - not by share count, which would hand part
      // of the new money's check to a SAFE that converted at a discount into
      // more shares per dollar.
      const invested = n * (Number(s.pricePerShare) || 0);
      add(s.stakeholderId, {
        shares: n,
        preference: cls.invested > 0 ? (invested / cls.invested) * (paid.get(cls.classId) || 0) : 0,
        participation: cls.participating ? n * price : 0,
      });
    }
  }

  for (const a of awards) {
    if (!inMoney.has(a.id)) continue;
    add(a.stakeholderId, { shares: a.shares, participation: a.shares * (price - a.strike) });
  }

  /* The convertibles, on their holders' rows: a note's repayment and a SAFE's
     money back are paid off the top like a preference, and a converting
     SAFE's shares share the residual like any other share. */
  for (const c of notes) {
    add(c.stakeholderId, { preference: debt.paid.get(c.id) || 0 });
  }
  for (const c of safes) {
    if (cashOut.has(c.id)) {
      add(c.stakeholderId, { preference: cash.paid.get(c.id) || 0 });
    } else {
      const n = safeShares.get(c.id) || 0;
      add(c.stakeholderId, { shares: n, participation: n * price });
    }
  }

  // Indexed once: looked up per row, and the breakeven search runs this
  // waterfall dozens of times per point.
  const holders = new Map(db.stakeholders.map((h) => [h.id, h]));
  const holder = (id) => holders.get(id);
  /* Awards, listed rather than folded into their holders' rows: an RSU with
     no strike and an option that has to be paid for reach the same holder by
     different routes, and the difference is the whole point. */
  const awardRows = awards.map((a) => ({
    id: a.id,
    label: a.label,
    kind: a.kind,
    name: holder(a.stakeholderId)?.name || 'Unknown holder',
    shares: a.shares,
    strike: a.strike,
    inMoney: inMoney.has(a.id),
    cost: inMoney.has(a.id) ? a.shares * a.strike : 0,
    proceeds: inMoney.has(a.id) ? a.shares * (price - a.strike) : 0,
  })).sort((a, b) => b.proceeds - a.proceeds || String(a.label).localeCompare(String(b.label)));
  const distributed = [...rows.values()].reduce((a, r) => a + r.proceeds, 0);
  const list = [...rows.values()]
    /* Half a dollar, not an epsilon: right at a breakeven the residual can
       be a fraction of a dollar, and a row whose whole-dollar figure reads
       "$0" beside "<0.01%" is just noise - it counted in the holders the
       table said the proceeds were distributed across. */
    .filter((r) => r.proceeds >= 0.5)
    .map((r) => ({
      ...r,
      name: holder(r.stakeholderId)?.name || 'Unknown holder',
      kind: holder(r.stakeholderId)?.kind || 'other',
      pct: distributed > 0 ? r.proceeds / distributed : 0,
    }))
    .sort((a, b) => b.proceeds - a.proceeds || a.name.localeCompare(b.name));

  /* Each convertible's election, the way the preferred classes card reports
     theirs: it has to be visible that a SAFE took its money back rather than
     shares, and what the other leg would have paid. */
  const convertibleRows = claims.map((c) => {
    const cashedOut = c.kind === 'note' || cashOut.has(c.id);
    const n = cashedOut ? 0 : (safeShares.get(c.id) || 0);
    const asConverted = c.kind === 'note' ? null : (cashedOut ? safeWouldConvert(c.id) : n * price);
    return {
      id: c.id,
      label: c.label,
      kind: c.kind,
      name: holder(c.stakeholderId)?.name || 'Unknown holder',
      value: c.value,
      elected: c.kind === 'note' ? 'repaid' : (cashedOut ? 'cash' : 'converted'),
      shares: n,
      // What it converts at, for the row that says how it got its shares.
      conversionPrice: n > 0 ? c.value / n : 0,
      asConverted,
      proceeds: c.kind === 'note'
        ? (debt.paid.get(c.id) || 0)
        : (cashedOut ? (cash.paid.get(c.id) || 0) : n * price),
    };
  }).sort((a, b) => b.proceeds - a.proceeds || String(a.label).localeCompare(String(b.label)));

  return {
    exitValue: exit,
    pricePerShare: price,
    debtRepaid: debt.pay,
    /* Summed off what the stack was paid, not reconstructed by subtracting
       the tiers below it out of the tier above: that arithmetic left a float
       residue on a cap table with no preferred at all whenever a SAFE's money
       back carried cents, and a residue a hair below zero printed as "-$0" on
       the headline card. The sum is exactly zero with no preferred, never
       negative, and equal to the Paid column above it. */
    preferencePaid: [...paid.values()].reduce((a, b) => a + b, 0),
    cashedOut: cash.pay,
    residual,
    distributed,
    rows: list,
    awards: awardRows,
    classes: stack.map((p) => ({
      ...p,
      converted: converted.has(p.classId),
      paid: converted.has(p.classId) ? 0 : (paid.get(p.classId) || 0),
      // A participating class shares at the price as it stands; that is its
      // participation, not an alternative it declined.
      asConverted: converted.has(p.classId) || p.participating
        ? p.shares * price
        : classWouldConvert(p.classId),
    })),
    convertibles: convertibleRows,
  };
}

/**
 * Exit values where the waterfall changes character: the point the note debt
 * is covered, the point the preference stack is cleared and common starts
 * earning, and the point each non-participating class - or each SAFE - does
 * better converting than taking its money back.
 *
 * The conversion thresholds are found by bisection: as the exit grows, the
 * as-converted value rises while the fixed preference (or the SAFE's money
 * back) does not, so each election flips exactly once and can be searched
 * for.
 */
export function exitBreakevens(db, opts = {}) {
  return [...exitBreakevenPoints(db, opts)].filter(Boolean).sort((a, b) => a.exitValue - b.exitValue);
}

/**
 * The same points, one at a time. Each conversion threshold is a bisection
 * of the whole waterfall, a few dozen calls, and a cap table with twenty
 * SAFEs has twenty of them to find: seconds of work that froze the exit
 * view on the way in. Yielded one by one, the view paints first and takes
 * them as they come - and between points the generator yields `undefined`
 * after every waterfall evaluation, so a caller can hand the thread back
 * inside a bisection too (one ran whole, half a second at 5,000 securities).
 * exitBreakevens drops those; a stepping caller skips them.
 */
export function* exitBreakevenPoints(db, { asOf, changeOfControl = false, unvestedOptions = 'participate' } = {}) {
  db = dbAsOf(db, asOf);
  /* A table the waterfall refuses (SAFEs beside dated terms) has no points
     to find; searched anyway, the first read of `.classes` threw. */
  const at = (exitValue) => exitWaterfallAt(db, { exitValue, asOf, changeOfControl, unvestedOptions });
  if (at(1)?.unsupported) return;
  const stack = preferredStack(db);
  const claims = convertibleClaims(db, asOf);
  const debt = claims.filter((c) => c.kind === 'note').reduce((a, c) => a + c.value, 0);
  const totalPreference = stack.reduce((a, p) => a + p.preference, 0);
  if (debt > 0) {
    yield ({
      type: 'debt-repaid',
      name: 'Convertible notes repaid',
      detail: 'Below this, note principal and interest is not covered in full',
      exitValue: debt,
    });
  }
  /* An upper bracket each conversion is guaranteed to flip under. Once the
     stack is cleared, a share is worth at least the residual spread over
     every share that could take part - so past
     totalPreference + preference * (allShares / shares), converting must
     beat the preference. Doubled for slack: a fixed ceiling would silently
     drop the breakeven of a class holding a tiny sliver of the shares. */
  const allShares = fullyDiluted(db.securities, 0, { includePool: false });
  /* Bisect for the exit value where `flips(exit)` first becomes true. The
     bracket has to be one the flip is guaranteed to have happened inside. */
  const search = function* (hi, flips) {
    /* The brackets below are guarantees about the shares on the cap table
       today; the shares a converting SAFE takes at the exit are not among
       them, and a SAFE converting into a large part of the company - a cap
       typed short by a few zeros is the usual way - pushed a class's flip
       past its bracket. The point was then dropped from the card without a
       word. Widened, a few times over, before giving up. */
    let high = hi;
    let found = flips(high);
    yield;
    for (let k = 0; k < 8 && !found; k++) {
      high *= 8;
      found = flips(high);
      yield;
    }
    if (!found) return null;
    let lo = 0;
    for (let i = 0; i < 60 && high - lo > Math.max(1, high * 1e-9); i++) {
      const mid = (lo + high) / 2;
      if (flips(mid)) high = mid;
      else lo = mid;
      yield;
    }
    return high;
  };

  if (totalPreference > 0) {
    /* The notes come off the top first, so the stack clears that much later.
       And a SAFE taking its money back ranks ahead of common - with the
       preferred for a post-money SAFE, ahead of every share for a pre-money
       one - so with SAFEs outstanding common earns nothing until those are
       paid too - or until the exit is rich enough that they convert instead.
       Which of the two happens first is the waterfall's own election, so the
       point is read off the waterfall rather than summed: the first exit that
       leaves anything to share. */
    const safeClaims = claims.filter((c) => c.kind === 'safe').reduce((a, c) => a + c.value, 0);
    const cleared = safeClaims > 0
      ? yield* search(debt + totalPreference + safeClaims + 1, (exit) => at(exit)?.residual > 1e-6)
      : null;
    yield ({
      type: 'stack-cleared',
      name: 'Preference stack cleared',
      detail: safeClaims > 0
        ? 'Below this, everything goes to notes, preferred, and SAFEs taking their money back, and common gets nothing'
        : 'Below this, everything goes to notes and preferred, and common gets nothing',
      exitValue: cleared ?? debt + totalPreference,
    });
  }

  for (const p of stack) {
    if (p.participating || p.preference <= 0 || p.shares <= 0) continue;
    const hi = Math.max(1e9, 2 * (debt + totalPreference + p.preference * (allShares / p.shares)));
    const flip = yield* search(hi, (exit) => !!at(exit)?.classes?.find((c) => c.classId === p.classId)?.converted);
    if (flip === null) continue;
    yield ({
      type: 'converts',
      name: `${p.name} converts`,
      detail: 'Above this, converting to common beats taking the preference',
      exitValue: flip,
      classId: p.classId,
    });
  }

  /* Where each SAFE flips from money back to converting. Below its flip the
     residual cannot pay the conversion what the money-back leg would, so the
     election is worth marking whatever the SAFE's terms are - a cap, a
     discount, or neither. */
  // The liquidity capitalization, pool excluded - the basis exitWaterfallAt divides a cap by.
  const fdPre = fullyDiluted(db.securities, db.company, { includePool: false });
  const claimTotal = claims.reduce((a, c) => a + c.value, 0);
  for (const c of claims) {
    if (c.kind !== 'safe' || c.value <= 0) continue;
    /* A bracket the flip has certainly happened inside. A cap fixes the price
       above which converting must win, so the exit that reaches that price is
       the anchor; without one, a multiple of everything ranking ahead of the
       residual is enough. */
    const capPrice = Number(c.security.valuationCap) > 0
      ? conversionPrice(c.security, Number.MAX_SAFE_INTEGER, fdPre, fdPre)
      : 0;
    const hi = Math.max(1e9,
      8 * (debt + totalPreference + claimTotal) + 2 * capPrice * allShares);
    const flip = yield* search(hi, (exit) => at(exit)?.convertibles?.find((x) => x.id === c.id)?.elected === 'converted');
    if (flip === null) continue;
    yield ({
      type: 'safe-converts',
      name: `${c.label} converts`,
      detail: 'Above this, converting beats taking the money back',
      exitValue: flip,
      securityId: c.id,
    });
  }

}

/* ---------- Certificate labels ---------- */

/**
 * 'Series A Preferred' → 'SA', 'Common Stock' → 'CS'.
 *
 * By code point, not by UTF-16 unit: a class named with a leading character
 * outside the basic plane - an emoji, a rare CJK ideograph - split its
 * surrogate pair, and every certificate in the class was labelled with a
 * lone surrogate that renders as a replacement glyph and survives every
 * export as one. The avatar initials had the same bug.
 */
export function classPrefix(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'SH';
  const letters = words.length === 1
    ? [...words[0]].slice(0, 2).join('')
    : words.slice(0, 2).map((w) => [...w][0]).join('');
  return letters.toUpperCase();
}

const LABEL_PREFIX = { option: 'OPT', rsu: 'RSU', warrant: 'WNT', safe: 'SAFE', note: 'CN' };

/**
 * Next certificate label: shares number within their class prefix
 * (CS-1, CS-2, SA-1); other kinds number within their kind.
 */
function labelPrefix(db, kind, classId) {
  if (kind !== 'shares') return LABEL_PREFIX[kind] || 'SEC';
  const cls = db.classes.find((c) => c.id === classId);
  return classPrefix(cls?.name);
}

export function nextLabel(db, kind, classId = null) {
  const prefix = labelPrefix(db, kind, classId);
  let max = 0;
  for (const s of db.securities) {
    const m = /^(.+)-(\d+)$/.exec(s.label || '');
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  return `${prefix}-${max + 1}`;
}

/**
 * Labels for a batch of new records: the securities are scanned once for
 * the highest number under every prefix, and each label handed out counts
 * on from there. nextLabel scans the whole list per call, which is what a
 * CSV import did per row - a quadratic pass that took two seconds over five
 * thousand rows, with the wizard's buttons disabled for the length of it.
 */
export function labelSequence(db) {
  const max = new Map();
  for (const s of db.securities) {
    const m = /^(.+)-(\d+)$/.exec(s.label || '');
    if (m) max.set(m[1], Math.max(max.get(m[1]) || 0, Number(m[2])));
  }
  return (kind, classId = null) => {
    const prefix = labelPrefix(db, kind, classId);
    const n = (max.get(prefix) || 0) + 1;
    max.set(prefix, n);
    return `${prefix}-${n}`;
  };
}
