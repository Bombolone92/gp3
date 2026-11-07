/**
 * Date math for contract terms. All dates are ISO strings (YYYY-MM-DD) in
 * local time; day arithmetic goes through UTC timestamps so DST shifts can
 * never produce an off-by-one day.
 */

const pad2 = (n) => String(n).padStart(2, '0');

/** A Date's local calendar day as an ISO string (never via toISOString: that is UTC). */
export function dateToISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayISO() {
  return dateToISO(new Date());
}

export function isValidISO(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(iso, n) {
  return fromUTC(toUTC(iso) + n * 86400000);
}

/** Same day-of-month n months later, clamped to the target month's length. */
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return fromUTC(Date.UTC(ty, tm, Math.min(d, lastDay)));
}

/** Whole days from a to b (positive when b is later). */
export function daysBetween(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

/** "12 Mar 2026" — compact, unambiguous. */
export function formatDate(iso) {
  if (!isValidISO(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/** "in 3 days" / "today" / "5 days ago" for list rows. */
export function relativeDays(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 1) return `in ${days} days`;
  return `${-days} days ago`;
}

/* ------------------------------------------------------------------ */
/* Recorded decisions                                                  */
/* ------------------------------------------------------------------ */

/**
 * A decision the user recorded about a renewal. It is keyed to the term end
 * it was made about (`forTermEnd`), so once that term is over the decision
 * stops applying and the next term starts clean.
 */
export const DECISION_KINDS = ['notice-given', 'renewing', 'not-renewing', 'snoozed'];

/** Decisions that mean "this term is the last one". */
export const ENDING_DECISIONS = ['notice-given', 'not-renewing'];

export const DECISION_LABELS = {
  'notice-given': 'Notice given',
  renewing: 'Renewing',
  'not-renewing': 'Ending at term',
  snoozed: 'Snoozed',
};

/** The contract's decision if it applies to `termEnd`, else null (stale). */
export function decisionFor(contract, termEnd) {
  const d = contract?.decision;
  if (!d || !DECISION_KINDS.includes(d.kind)) return null;
  if (termEnd && d.forTermEnd && d.forTermEnd !== termEnd) return null;
  return d;
}

/** Whether a decision currently answers the question "what about this renewal?" */
export function decisionHandles(decision, today = todayISO()) {
  if (!decision) return false;
  // A snooze is an explicit, dated deferral: it stops holding on its date.
  if (decision.kind === 'snoozed') {
    return isValidISO(decision.until) && daysBetween(today, decision.until) >= 0;
  }
  return DECISION_KINDS.includes(decision.kind);
}

/**
 * Whether `date` is one of this contract's term ends: the end date itself
 * or, on an auto-renewing contract, any renewal boundary after it.
 *
 * A decision is keyed to the term end it answered for, and the schedule can
 * move under it — the end date corrected, the renewal term changed,
 * auto-renew switched on or off. The decision then names a date that is no
 * term end at all, and anything that treats it as one goes wrong from there.
 */
export function isTermEnd(contract, date) {
  const end = contract.endDate;
  if (!isValidISO(end) || !isValidISO(date)) return false;
  if (date === end) return true;
  if (!contract.autoRenew || date < end) return false;
  const term = Math.max(1, Number(contract.termMonths) || 12);
  for (let i = 1; i <= 1200; i++) {
    const boundary = addMonths(end, term * i);
    if (boundary === date) return true;
    if (boundary > date) return false;
  }
  return false;
}

/**
 * The contract's next end-of-term date on or after `today`.
 * Auto-renewing contracts roll their end date forward by the renewal term
 * until it lands in the future; fixed-term contracts just have their end
 * date. Contracts without an end date have no renewal (evergreen).
 *
 * A recorded "notice given" or "not renewing" caps the roll-forward at the
 * term it was recorded against: that term is the last one, so the contract
 * must not quietly renew past it. Only a date that is still a term end can
 * cap anything: one left behind by a later edit to the schedule used to
 * become the "term end" itself, so an end date corrected from Sep 1 to
 * Oct 15 left the contract reporting Sep 1 as its end, closing every
 * "until the contract ends" obligation series at the wrong date.
 */
export function nextTermEnd(contract, today = todayISO()) {
  const end = contract.endDate;
  if (!isValidISO(end)) return null;
  const last = ENDING_DECISIONS.includes(contract.decision?.kind)
    && isTermEnd(contract, contract.decision.forTermEnd) ? contract.decision.forTermEnd : null;
  if (!contract.autoRenew) return end;
  const term = Math.max(1, Number(contract.termMonths) || 12);
  let date = end;
  // Each candidate is computed from the original end date so a month-end
  // anchor never drifts after clamping (Jan 31 → Feb 28 → Mar 28 → ...).
  // The cap guards against pathological data (end date centuries in the past).
  for (let i = 1; i <= 1200 && daysBetween(today, date) < 0; i++) {
    date = addMonths(end, term * i);
  }
  return last && daysBetween(last, date) > 0 ? last : date;
}

/**
 * The date the agreement itself stops — which is not the same question as
 * "when does this term end". A contract that auto-renews does not stop at its
 * renewal date; not stopping there is the entire point of auto-renewal. So it
 * has no end at all unless a recorded "notice given" or "not renewing" makes
 * the term in front of the user the last one.
 *
 * Null means "no known end", which is the honest answer for an evergreen
 * agreement and for one that keeps rolling forward.
 */
export function agreementEnd(contract, today = todayISO()) {
  const end = nextTermEnd(contract, today);
  if (!end || !contract.autoRenew) return end;
  const last = ENDING_DECISIONS.includes(contract.decision?.kind)
    && contract.decision.forTermEnd === end;
  return last ? end : null;
}

/**
 * Terms this contract has already finished, oldest first, as { start, end }.
 * One entry per crossed boundary, so a contract nobody opened for three years
 * still gets its three renewals recorded.
 */
export function completedTerms(contract, today = todayISO()) {
  const end = contract.endDate;
  if (!isValidISO(end) || daysBetween(today, end) >= 0) return [];
  const first = isValidISO(contract.startDate) ? contract.startDate : null;
  if (!contract.autoRenew) return [{ start: first, end }];
  const term = Math.max(1, Number(contract.termMonths) || 12);
  const out = [];
  let start = first;
  let boundary = end;
  for (let i = 1; i <= 1200 && daysBetween(today, boundary) < 0; i++) {
    out.push({ start, end: boundary });
    start = addDays(boundary, 1);
    boundary = addMonths(end, term * i);
    // A recorded ending stops the series: nothing after that term happened.
    if (ENDING_DECISIONS.includes(contract.decision?.kind)
      && contract.decision.forTermEnd === out[out.length - 1].end) break;
  }
  return out;
}

/**
 * Everything a view needs to talk about a contract's clock:
 *   phase    'evergreen' | 'expired' | 'notice' | 'soon' | 'ok'
 *   date     next term end (renewal or expiry), null for evergreen
 *   daysLeft days from today until `date`
 *   noticeDate / noticeDaysLeft  cancellation-notice deadline, when set
 *   decision the recorded decision for this term end, if any
 *   handled  true when that decision answers the deadline
 *
 * 'notice' means the window to cancel or renegotiate before an auto-renewal
 * is open (or, for fixed terms, the heads-up window before expiry).
 * 'soon' means the term ends within `soonDays`.
 */
export function renewalInfo(contract, today = todayISO(), soonDays = 60) {
  const none = { decision: null, handled: false };
  if (contract.status === 'terminated' || contract.status === 'draft') {
    return { phase: 'none', date: null, daysLeft: null, noticeDate: null, noticeDaysLeft: null, ...none };
  }
  const date = nextTermEnd(contract, today);
  if (!date) {
    return { phase: 'evergreen', date: null, daysLeft: null, noticeDate: null, noticeDaysLeft: null, ...none };
  }
  const decision = decisionFor(contract, date);
  const handled = decisionHandles(decision, today);
  const daysLeft = daysBetween(today, date);
  if (daysLeft < 0) {
    return { phase: 'expired', date, daysLeft, noticeDate: null, noticeDaysLeft: null, decision, handled };
  }
  const noticeDays = Math.max(0, Number(contract.noticeDays) || 0);
  const noticeDate = noticeDays > 0 ? addDays(date, -noticeDays) : null;
  const noticeDaysLeft = noticeDate ? daysBetween(today, noticeDate) : null;
  let phase = 'ok';
  if (noticeDate && daysLeft <= noticeDays) phase = 'notice';
  else if (daysLeft <= soonDays) phase = 'soon';
  return { phase, date, daysLeft, noticeDate, noticeDaysLeft, decision, handled };
}

/**
 * The single definition of "this one is waiting on you": the nav badge, the
 * dashboard list, the Renewals grouping and the contracts filter all ask
 * here, so a recorded decision quiets every one of them at once.
 */
export function needsAttention(contract, info = null) {
  if (contract.status !== 'active') return false;
  const i = info || renewalInfo(contract);
  if (i.handled) return false;
  return i.phase === 'notice' || i.phase === 'expired';
}
