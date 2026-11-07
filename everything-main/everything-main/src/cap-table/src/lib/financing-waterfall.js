/**
 * The exit waterfall for a cap table whose preferred classes carry negotiated
 * terms - participation caps and dividends - which the standard waterfall in
 * captable.js does not model. captable.js hands off here whenever any class
 * has dated preferred terms, so a table without them keeps its old figures
 * to the cent.
 *
 * Method. Each preferred class either takes its contractual preferred leg
 * (preference plus accrued dividends off the top, then capped participation
 * in what is left, if it participates) or converts to common. With n classes
 * there are 2^n such elections; each is solved exactly, and the one returned
 * is the first in which no class could do better by changing its own
 * election alone, everyone else's held fixed. That is what each class would
 * choose at the table, and it is what makes a cap bite: a participating class
 * whose capped total falls under its as-converted value converts.
 *
 * Within one election the price per participating share is found by
 * bisection: the residual after the preference stack is shared by common,
 * converted preferred, participating preferred (each holder up to their
 * cap), and every award in the money at that price, whose strike money joins
 * the pot - the same fixed point residualPrice solves, with the caps added.
 * A table where every participant is capped can leave proceeds with no
 * eligible recipient; that balance is reported as unallocated, never
 * invented onto a row.
 *
 * Boundaries, refused rather than approximated: an unconverted SAFE (its own
 * election against a capped stack has no settled convention here), and more
 * than MAX_CLASSES issued preferred classes. Notes are debt and are repaid
 * first, as in the standard waterfall.
 */
import { FinancingError, preferredAt, dividendAccrual } from './financing.js';

/** Enumerating 2^n elections: past this many classes it stops being cheap. */
const MAX_CLASSES = 12;

/**
 * @param db      the cap table as of the exit date (dbAsOf already applied)
 * @param awards  equityAwards(db, ...) from captable.js: options, RSUs and
 *                warrants with their strikes
 * @param claims  convertibleClaims(db, asOf): notes and SAFEs with their value
 */
export function negotiatedWaterfall(db, { exitValue, asOf, awards = [], claims = [] }) {
  if (claims.some((c) => c.kind === 'safe')) {
    throw new FinancingError('Advanced preferred terms with unconverted SAFEs are unsupported. Model and close their conversion first.');
  }
  const exit = Math.max(0, Number(exitValue) || 0);
  const certs = db.securities.filter((s) => s.kind === 'shares' && !s.closedAt);
  const holderName = (id) => db.stakeholders.find((h) => h.id === id)?.name || 'Unknown holder';

  /* Each class, with what it can claim off the top and how far each of its
     holders may participate. The cap is per holder, on the holder's own
     invested capital; a class figure is the sum. */
  const stack = db.classes.filter((c) => c.kind === 'preferred').map((c) => {
    const terms = preferredAt(c, asOf);
    const holdings = certs.filter((s) => s.classId === c.id).map((s) => {
      const dividends = dividendAccrual(s, c, asOf);
      const principal = s.economicBasis?.principal ?? s.quantity * (s.pricePerShare || 0);
      const initial = principal * c.liquidationMultiple;
      const dividendClaim = dividends.balance * (terms.dividends?.atLiquidation === 'multiply' ? c.liquidationMultiple : 1);
      return { security: s, dividends, principal, initial, dividendClaim, preference: initial + dividendClaim };
    });
    const sum = (key) => holdings.reduce((a, h) => a + h[key], 0);
    const participants = new Map();
    for (const h of holdings) {
      const id = h.security.stakeholderId;
      const p = participants.get(id) || { stakeholderId: id, shares: 0, principal: 0, initial: 0, dividendClaim: 0 };
      p.shares += h.security.quantity;
      p.principal += h.principal;
      p.initial += h.initial;
      p.dividendClaim += h.dividendClaim;
      participants.set(id, p);
    }
    for (const p of participants.values()) {
      p.cap = terms.cap && c.participating
        ? Math.max(0, p.principal * terms.cap.multiple
          - (terms.cap.includesPreference ? p.initial : 0)
          - (terms.cap.includesDividends ? p.dividendClaim : 0))
        : Infinity;
    }
    return {
      classId: c.id, name: c.name, shares: holdings.reduce((a, h) => a + h.security.quantity, 0),
      seniority: c.seniority || 0, multiple: c.liquidationMultiple, participating: c.participating,
      invested: sum('principal'), preference: sum('preference'), dividendClaim: sum('dividendClaim'),
      holdings, participants, cap: [...participants.values()].reduce((a, p) => a + p.cap, 0),
      // What a converted class still claims off the top: its unpaid dividends
      // when the terms keep them as cash, nothing when they are forfeited.
      conversionDividend: terms.dividends?.atConversion === 'cash' ? holdings.reduce((a, h) => a + h.dividends.balance, 0) : 0,
    };
  }).filter((p) => p.shares > 0);
  if (stack.length > MAX_CLASSES) {
    throw new FinancingError(`Advanced preferred elections support at most ${MAX_CLASSES} issued preferred classes. Reduce the scenario or review the agreement separately.`);
  }

  const preferredIds = new Set(stack.map((p) => p.classId));
  const common = certs.filter((s) => !preferredIds.has(s.classId));
  const commonShares = common.reduce((a, s) => a + s.quantity, 0);

  // Debt first: a note is repaid before any share of the company is.
  const notes = claims.filter((c) => c.kind === 'note');
  const debtClaim = notes.reduce((a, s) => a + s.value, 0);
  const debtPaid = Math.min(exit, debtClaim);
  const remaining = exit - debtPaid;

  const converts = (mask, i) => !!(mask & (1 << i));
  /** A holder's participation at a price: pro rata, up to their cap. */
  const holderParticipation = (h, price) => Math.min(h.cap, h.shares * price);
  const classParticipation = (p, i, mask, price) => {
    if (converts(mask, i)) return p.shares * price;
    return p.participating ? [...p.participants.values()].reduce((v, h) => v + holderParticipation(h, price), 0) : 0;
  };

  /* One election, solved: the preference stack paid most senior first (pro
     rata inside a tier when the money runs out), then the residual priced
     over everything that shares in it. Cached: the stability check below
     asks about each neighbouring election too. */
  const cache = new Map();
  const solve = (mask) => {
    if (cache.has(mask)) return cache.get(mask);
    const claimsOffTop = stack.map((p, i) => (converts(mask, i) ? p.conversionDividend : p.preference));
    let residual = remaining;
    const paid = stack.map(() => 0);
    for (const tier of [...new Set(stack.map((p) => p.seniority))].sort((a, b) => b - a)) {
      const want = stack.reduce((a, p, i) => a + (p.seniority === tier ? claimsOffTop[i] : 0), 0);
      const payment = Math.min(want, residual);
      stack.forEach((p, i) => { if (p.seniority === tier) paid[i] = want > 0 ? payment * claimsOffTop[i] / want : 0; });
      residual -= payment;
    }
    const cashAt = (price) => commonShares * price
      + stack.reduce((a, p, i) => a + classParticipation(p, i, mask, price), 0)
      + awards.reduce((a, s) => a + s.shares * Math.max(0, price - s.strike), 0);
    let lo = 0;
    let hi = Math.max(1, exit);
    /* Every participant capped leaves the balance with no taker at any price:
       the bracket stops growing and the shortfall reports as unallocated. */
    for (let i = 0; i < 60 && cashAt(hi) < residual; i++) hi *= 2;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (cashAt(mid) < residual) lo = mid;
      else hi = mid;
    }
    const price = residual > 0 ? (lo + hi) / 2 : 0;
    const participation = stack.map((p, i) => classParticipation(p, i, mask, price));
    const totals = paid.map((v, i) => v + participation[i]);
    const out = { paid, participation, totals, price, residual, claims: claimsOffTop };
    cache.set(mask, out);
    return out;
  };

  /* The election that stands: no class gains by switching its own leg. */
  let elected = null;
  for (let mask = 0; mask < 2 ** stack.length; mask++) {
    const result = solve(mask);
    const stable = stack.every((p, i) => {
      const alternative = solve(mask ^ (1 << i));
      return alternative.totals[i] <= result.totals[i] + Math.max(1e-7, exit * 1e-10);
    });
    if (stable) {
      elected = { mask, ...result };
      break;
    }
  }
  if (!elected) throw new FinancingError('These preferred elections have no stable contractual solution. Review the participation and conversion clauses.');

  /* Per-holder proceeds. */
  const rows = new Map();
  const add = (id, shares, preference, participation, dividends = 0) => {
    const r = rows.get(id) || { stakeholderId: id, shares: 0, preference: 0, participation: 0, dividends: 0, proceeds: 0 };
    r.shares += shares;
    r.preference += preference;
    r.participation += participation;
    r.dividends += dividends;
    r.proceeds += preference + participation;
    rows.set(id, r);
  };
  common.forEach((s) => add(s.stakeholderId, s.quantity, 0, s.quantity * elected.price));
  stack.forEach((p, i) => p.holdings.forEach((h) => {
    const converted = converts(elected.mask, i);
    const holder = p.participants.get(h.security.stakeholderId);
    // A holder's capped participation is split across their certificates by share count.
    const participation = converted
      ? h.security.quantity * elected.price
      : p.participating ? holderParticipation(holder, elected.price) * h.security.quantity / holder.shares : 0;
    // What the class was paid off the top, as a share of what it claimed - a
    // shortfall scales every certificate's preference and dividends alike.
    const ratio = elected.claims[i] > 0 ? elected.paid[i] / elected.claims[i] : 0;
    const dividendsKept = converted ? (p.conversionDividend ? h.dividends.balance : 0) : h.dividendClaim;
    add(h.security.stakeholderId, h.security.quantity, (converted ? dividendsKept : h.preference) * ratio, participation, dividendsKept * ratio);
  }));
  // Listed the way the standard waterfall lists them: largest payout first.
  const byProceeds = (a, b) => b.proceeds - a.proceeds || String(a.label ?? a.name).localeCompare(String(b.label ?? b.name));
  const awardRows = awards.map((a) => {
    const proceeds = a.shares * Math.max(0, elected.price - a.strike);
    add(a.stakeholderId, proceeds > 0 ? a.shares : 0, 0, proceeds);
    return { ...a, name: holderName(a.stakeholderId), inMoney: proceeds > 0, cost: proceeds > 0 ? a.shares * a.strike : 0, proceeds };
  }).sort(byProceeds);
  const convertibleRows = notes.map((s) => {
    const proceeds = debtClaim > 0 ? debtPaid * s.value / debtClaim : 0;
    add(s.stakeholderId, 0, proceeds, 0);
    return { id: s.id, label: s.label, kind: 'note', name: holderName(s.stakeholderId), value: s.value,
      elected: 'repaid', shares: 0, conversionPrice: 0, asConverted: null, proceeds };
  }).sort(byProceeds);

  const distributed = [...rows.values()].reduce((a, r) => a + r.proceeds, 0);
  if (!Number.isFinite(distributed) || distributed > exit + Math.max(1e-6, exit * 1e-9)) {
    throw new FinancingError('The waterfall did not reconcile. Review the terms.');
  }
  return {
    exitValue: exit,
    pricePerShare: elected.price,
    debtRepaid: debtPaid,
    preferencePaid: elected.paid.reduce((a, n) => a + n, 0),
    cashedOut: 0,
    residual: elected.residual,
    distributed,
    unallocated: Math.max(0, exit - distributed),
    awards: awardRows,
    convertibles: convertibleRows,
    /* Holders paid at least half a dollar, largest first - the rows the
       standard waterfall returns. Under the preference stack every common
       holder is owed nothing, and listed anyway they counted in the holders
       the proceeds card said the money was distributed across. */
    rows: [...rows.values()]
      .filter((r) => r.proceeds >= 0.5)
      .map((r) => ({
        ...r, name: holderName(r.stakeholderId),
        kind: db.stakeholders.find((h) => h.id === r.stakeholderId)?.kind || 'other',
        pct: distributed ? r.proceeds / distributed : 0,
      }))
      .sort((a, b) => b.proceeds - a.proceeds || a.name.localeCompare(b.name)),
    classes: stack.map((p, i) => {
      const converted = converts(elected.mask, i);
      return {
        classId: p.classId, name: p.name, shares: p.shares, seniority: p.seniority, multiple: p.multiple,
        participating: p.participating, invested: p.invested, preference: p.preference, dividendClaim: p.dividendClaim,
        converted,
        paid: elected.paid[i],
        participationPaid: elected.participation[i],
        proceeds: elected.totals[i],
        // What converting would have paid, or does pay: the neighbouring election with this class converted.
        asConverted: solve(elected.mask | (1 << i)).totals[i],
        capBound: !converted && p.participating && [...p.participants.values()]
          .some((h) => Number.isFinite(h.cap) && h.shares * elected.price >= h.cap - 1e-7),
        holderCaps: [...p.participants.values()].map((h) => ({
          stakeholderId: h.stakeholderId, name: holderName(h.stakeholderId),
          cap: Number.isFinite(h.cap) ? h.cap : null,
          participation: converted ? h.shares * elected.price : p.participating ? holderParticipation(h, elected.price) : 0,
        })),
        dividendBreakdown: p.holdings.map((h) => ({ securityId: h.security.id, label: h.security.label, ...h.dividends })),
      };
    }),
  };
}
