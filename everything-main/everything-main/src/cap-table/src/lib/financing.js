/**
 * Negotiated financing terms - pure functions over plain data, no I/O.
 *
 * Pro-rata rights, MFN clauses and elections, participation caps, preferred
 * dividends, and the dated assumptions a financing scenario is modeled under.
 * Every term is a structured input with an agreement reference and an
 * effective date, never an interpretation of agreement prose. A field or a
 * convention this file does not know is refused with a FinancingError rather
 * than dropped or approximated: a right that quietly lost its cap would be
 * worse than one the app declines to model. The conventions each calculation
 * follows, with worked figures, are in docs/financing-conventions.md.
 *
 * Dates are ISO calendar days (UTC). Effective dates and eligibility windows
 * are inclusive at both ends.
 */

/** A refusal the forms show as-is: the store's isRefusal reads `refused`. */
export class FinancingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FinancingError';
    this.refused = true;
  }
}
const fail = (message) => { throw new FinancingError(message); };
const clone = (x) => JSON.parse(JSON.stringify(x));

/* ---------- Field validators ---------- */

/* Strict by design: a record may carry only the fields named for it, so a
   term the app cannot calculate (a bespoke denominator exclusion, a cap on a
   basis other than invested capital) is refused at the boundary instead of
   riding along unread. */
function object(x, keys, label) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) fail(`${label}: expected an object.`);
  for (const key of Object.keys(x)) if (!keys.includes(key)) fail(`${label}: unsupported field ${key}.`);
}
function text(x, label) {
  if (typeof x !== 'string' || !x.trim() || x.length > 2000) fail(`${label}: enter a nonempty reference (up to 2000 characters).`);
}
/** A real calendar day as YYYY-MM-DD; "2025-02-30" is refused, not rolled over. */
export function termDate(x, label = 'Effective date') {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || !Number.isFinite(Date.parse(x))
    || new Date(x).toISOString().slice(0, 10) !== x) fail(`${label}: enter a valid date.`);
  return x;
}
function number(x, min, max, label) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) fail(`${label}: expected a number from ${min} to ${max}.`);
}
function choice(x, choices, label) {
  if (!choices.includes(x)) fail(`${label}: unsupported convention ${x}.`);
}
function list(x, label) {
  if (!Array.isArray(x) || x.length > 200) fail(`${label}: expected up to 200 entries.`);
}
function refs(x, label) {
  list(x, label);
  if (!x.length) fail(`${label}: select at least one.`);
  x.forEach((v) => text(v, label));
}
function unique(x, label) {
  list(x, label);
  const ids = new Set();
  for (const e of x) {
    text(e?.id, label);
    if (ids.has(e.id)) fail(`${label}: duplicate ID ${e.id}.`);
    ids.add(e.id);
  }
}
/** A dated window: a start, and an optional end no earlier than it. `label` names what the window is of. */
function window(x, label = 'Eligibility') {
  termDate(x.start);
  if (x.end) {
    termDate(x.end);
    if (x.end < x.start) fail(`${label} end precedes its start.`);
  }
}

/* ---------- Pro-rata rights ---------- */

/**
 * The denominators a participation right can be measured on. Each is a
 * distinct clause, and they do not share a capitalization:
 *   fixed          a contractual percentage of the round
 *   pre-round-fd   the holder's fully diluted ownership before the round,
 *                  reserves included
 *   yc-post-money  the YC post-money SAFE side letter: the SAFE's conversion
 *                  shares over the company capitalization, in the round it
 *                  converts in
 *   yc-original    the original YC pro-rata right, which applies to the
 *                  financing after the one the SAFE converted in, on the
 *                  holder's ownership at that time
 */
export const PRO_RATA_BASES = ['fixed', 'pre-round-fd', 'yc-post-money', 'yc-original'];

/**
 * Validate a security's list of pro-rata rights.
 *
 * Each names its agreement, the window it can be exercised in, the financings
 * it applies to (`'*'` for any), the ownership basis, and optionally a cash
 * ceiling. The elected amount is not here: an election belongs to the
 * scenario that makes it - see validateFinancing.
 */
export function validateProRata(raw) {
  if (raw === undefined) return undefined;
  unique(raw, 'Pro-rata rights');
  for (const r of raw) {
    object(r, ['id', 'agreement', 'start', 'end', 'basis', 'fraction', 'limit', 'financings'], 'Pro-rata right');
    text(r.agreement, 'Agreement');
    window(r);
    refs(r.financings, 'Applicable financings');
    choice(r.basis, PRO_RATA_BASES, 'Ownership basis');
    if (r.basis === 'fixed') number(r.fraction, 0, 1, 'Participation fraction');
    else if (r.fraction !== undefined) fail('Only a fixed right can specify a fraction.');
    if (r.limit !== undefined) number(r.limit, 0, 1e15, 'Participation limit');
  }
  return clone(raw);
}

/* ---------- MFN ---------- */

/** The terms an MFN election can adopt from a later instrument. */
const MFN_FIELDS = ['valuationCap', 'discount', 'safeType'];

/**
 * Validate an MFN clause and its elections.
 *
 * The clause fixes the scope (which terms), the eligibility window and the
 * kinds of later instrument it can look at. An election records the source
 * instrument, its date, the terms copied from it on that day, the election
 * date, its evidence and the financings it applies to. The copied terms are
 * checked against the source when the election is recorded (electMFN), not
 * here, so an election survives its source being edited afterwards.
 */
export function validateMFN(raw) {
  if (raw === undefined) return undefined;
  object(raw, ['agreement', 'start', 'end', 'scope', 'eligibleKinds', 'elections'], 'MFN');
  text(raw.agreement, 'MFN agreement');
  window(raw);
  refs(raw.scope, 'MFN scope');
  raw.scope.forEach((f) => choice(f, MFN_FIELDS, 'MFN scope'));
  refs(raw.eligibleKinds, 'MFN source kinds');
  raw.eligibleKinds.forEach((k) => choice(k, ['safe', 'note'], 'MFN source kind'));
  unique(raw.elections, 'MFN elections');
  for (const e of raw.elections) {
    object(e, ['id', 'date', 'sourceId', 'sourceDate', 'terms', 'agreement', 'financings'], 'MFN election');
    text(e.sourceId, 'MFN source');
    text(e.agreement, 'Election evidence');
    termDate(e.date);
    termDate(e.sourceDate);
    refs(e.financings, 'Election financings');
    object(e.terms, MFN_FIELDS, 'Elected terms');
    if (!Object.keys(e.terms).length) fail('Select elected terms.');
    if (e.sourceDate < raw.start || (raw.end && e.sourceDate > raw.end) || e.date < e.sourceDate) {
      fail('MFN source or election is outside eligible dates.');
    }
    for (const [k, v] of Object.entries(e.terms)) {
      if (!raw.scope.includes(k)) fail(`${k} is outside this MFN scope.`);
      if (k === 'safeType') choice(v, ['pre', 'post'], 'SAFE convention');
      else number(v, 0, k === 'discount' ? 99 : 1e15, k);
    }
  }
  return clone(raw);
}

/* ---------- Preferred terms: caps and dividends ---------- */

/**
 * Validate a preferred class's dated amendments.
 *
 * Each amendment is a complete statement of the class's cap and dividend
 * terms from its date on, and the list is append-only with strictly rising
 * dates (see appendOnly). A cap is a multiple of invested capital and says
 * whether the initial preference and accrued dividends count toward it.
 * Dividend terms name the rate, the accrual window, cumulative or not, the
 * accrual convention, and what happens to the unpaid balance at conversion
 * and at liquidation. Only actual/365 is supported as a day count.
 */
export function validatePreferred(raw) {
  if (raw === undefined) return undefined;
  unique(raw, 'Preferred amendments');
  let previous = '';
  for (const t of raw) {
    object(t, ['id', 'date', 'agreement', 'cap', 'dividends'], 'Preferred amendment');
    termDate(t.date);
    text(t.agreement, 'Amendment agreement');
    if (t.date <= previous) fail('Preferred amendments must have distinct, increasing effective dates.');
    previous = t.date;
    if (t.cap !== undefined) {
      object(t.cap, ['multiple', 'basis', 'includesPreference', 'includesDividends'], 'Participation cap');
      number(t.cap.multiple, 0, 1000, 'Participation cap');
      choice(t.cap.basis, ['invested'], 'Cap basis');
      for (const k of ['includesPreference', 'includesDividends']) {
        if (typeof t.cap[k] !== 'boolean') fail(`Specify cap ${k}.`);
      }
    }
    if (t.dividends !== undefined) {
      const d = t.dividends;
      object(d, ['rate', 'start', 'end', 'cumulative', 'convention', 'dayCount', 'atConversion', 'atLiquidation'], 'Dividends');
      number(d.rate, 0, 1, 'Annual dividend rate');
      // Its own words: the pro-rata wording named an eligibility this window does not have.
      window(d, 'Dividend accrual');
      if (typeof d.cumulative !== 'boolean') fail('Specify cumulative or non-cumulative dividends.');
      choice(d.convention, ['simple', 'compound'], 'Dividend convention');
      choice(d.dayCount, ['actual/365'], 'Dividend day count');
      choice(d.atConversion, ['forfeit', 'cash'], 'Dividends on conversion');
      choice(d.atLiquidation, ['add', 'multiply'], 'Dividends on liquidation');
    }
  }
  return clone(raw);
}

/** Dated dividend cash events on a certificate: declarations and payments. */
export function validateDividendEvents(raw) {
  if (raw === undefined) return undefined;
  unique(raw, 'Dividend cash events');
  for (const e of raw) {
    object(e, ['id', 'date', 'amount', 'type', 'evidence'], 'Dividend event');
    termDate(e.date);
    number(e.amount, 0, 1e15, 'Dividend amount');
    choice(e.type, ['payment', 'declared'], 'Dividend event type');
    text(e.evidence, 'Dividend evidence');
  }
  return clone(raw);
}

/**
 * The money a certificate's dividends accrue on, and from when. Recorded
 * once, at issue, so that a split (which changes the share count and the
 * price, not the money) or a transfer (which divides it) cannot move it.
 */
export function validateBasis(raw) {
  if (raw === undefined) return undefined;
  object(raw, ['principal', 'date'], 'Original economic basis');
  number(raw.principal, 0, 1e15, 'Original investment');
  termDate(raw.date);
  return clone(raw);
}

/* ---------- Financing assumptions ---------- */

/* Allocations are entered in dollars, and the close sheet and the store hold
   a round's checks to its modeled total by the same margin: half a dollar of
   float drift across a dozen checks is not a mismatch. */
export const ALLOCATION_TOLERANCE = 0.5;

/**
 * The dated assumptions a round scenario is modeled under: its ID (which the
 * rights and elections name, and which a close stamps on its certificates),
 * whether elected checks fit inside the entered raise or add to it, each
 * elected pro-rata check, and the MFN elections in force.
 */
export function validateFinancing(raw) {
  if (raw === undefined) return undefined;
  object(raw, ['id', 'roundMode', 'elections', 'mfnElections'], 'Financing assumptions');
  text(raw.id, 'Financing ID');
  choice(raw.roundMode, ['fixed', 'additional'], 'Round size convention');
  list(raw.elections, 'Participation elections');
  const ids = new Set();
  for (const e of raw.elections) {
    object(e, ['rightId', 'amount'], 'Participation election');
    text(e.rightId, 'Right ID');
    number(e.amount, 0, 1e15, 'Elected check');
    if (ids.has(e.rightId)) fail('Duplicate participation election.');
    ids.add(e.rightId);
  }
  list(raw.mfnElections, 'Selected MFN elections');
  raw.mfnElections.forEach((id) => text(id, 'MFN election ID'));
  if (new Set(raw.mfnElections).size !== raw.mfnElections.length) fail('Duplicate MFN election.');
  return clone(raw);
}

/* ---------- History ---------- */

/**
 * Refuse a rewrite of recorded history: every entry already on file must
 * stand unchanged at its position, so the only edit is appending. Rights,
 * amendments, elections and dividend events are all kept this way.
 */
export function appendOnly(before = [], after = [], label = 'Term history') {
  if (before.some((e, i) => JSON.stringify(e) !== JSON.stringify(after[i]))) {
    fail(`${label} is permanent. Append a dated amendment instead of rewriting history.`);
  }
}

/**
 * Every pro-rata right and MFN election on the table answers to one ID: a
 * scenario elects by ID alone, and the model refuses a table where an ID
 * names two records. Rights and elections are permanent, so past the
 * boundary only deleting a security could lift that refusal - checked
 * wherever securities are written, so the duplicate never gets on file.
 */
export function assertUniqueTermIds(securities) {
  const rights = new Set();
  const elections = new Set();
  for (const s of securities) {
    for (const r of s.proRata || []) {
      if (rights.has(r.id)) fail(`Pro-rata right ID ${r.id} is already recorded on another instrument.`);
      rights.add(r.id);
    }
    for (const e of s.mfn?.elections || []) {
      if (elections.has(e.id)) fail(`MFN election ID ${e.id} is already recorded on another instrument.`);
      elections.add(e.id);
    }
  }
}

/** The amendment in force on a date: the latest one dated on or before it. */
export function preferredAt(cls, date) {
  return (cls.preferredTerms || []).filter((t) => t.date <= date).at(-1) || {};
}

/* ---------- The cap table a scenario was modeled against ---------- */

/**
 * A short fingerprint of everything the round and exit models read: the
 * company record, classes, holders and securities. A saved scenario carries
 * the digest of the table it was modeled on, so that a later load can say
 * the table has changed since, and a close can refuse to apply figures
 * modeled against a table that has moved. Keys are sorted so the same data
 * written in a different order fingerprints the same; the FNV-1a hash is
 * the one the store uses for its own change detection.
 */
export function capTableDigest(db) {
  const stable = JSON.stringify({ company: db.company, classes: db.classes, stakeholders: db.stakeholders, securities: db.securities },
    (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]]))
      : v));
  let h = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) {
    h ^= stable.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${stable.length.toString(36)}.${h.toString(36)}`;
}

/* ---------- MFN elections ---------- */

/**
 * The later instruments an MFN clause could look at: the eligible kinds,
 * issued after the instrument itself and inside the clause's window.
 */
export function mfnCandidates(db, security) {
  const m = security.mfn;
  if (!m) return [];
  return db.securities.filter((s) => s.id !== security.id && m.eligibleKinds.includes(s.kind)
    && s.date > security.date && s.date >= m.start && (!m.end || s.date <= m.end));
}

/**
 * Build an MFN election from a candidate source: the terms in the clause's
 * scope are copied off the source as it stands today, with the source's
 * date and the evidence given. Recorded on the original instrument beside
 * its own terms, which it never replaces - a scenario applies it only when
 * it selects the election (see electedDb).
 */
export function electMFN(db, security, { id, sourceId, date, agreement, financings }) {
  const source = mfnCandidates(db, security).find((s) => s.id === sourceId);
  if (!source) fail('Select a later instrument within this MFN scope and eligibility period.');
  const terms = Object.fromEntries(security.mfn.scope.map((k) => [k, source[k] ?? (k === 'safeType' ? 'pre' : 0)]));
  if (security.kind !== 'safe' && 'safeType' in terms) fail('A note cannot elect a SAFE convention.');
  const election = { id, sourceId, sourceDate: source.date, date, agreement, financings, terms };
  validateMFN({ ...security.mfn, elections: [...security.mfn.elections, election] });
  return election;
}

/**
 * The cap table with the scenario's selected MFN elections applied: each
 * elected instrument reads with its elected terms in place of its own, and
 * `applied` lists what changed, with the original terms beside it for the
 * breakdown. An election that does not fit the scenario - already converted,
 * elected after the model date, or for another financing - is refused
 * rather than skipped, and so is a second election on one instrument.
 */
export function electedDb(db, assumptions, date) {
  const selected = new Set(assumptions?.mfnElections || []);
  // A scenario selects by election ID alone. Resolve its identity before
  // consuming IDs below, so duplicate IDs cannot elect whichever instrument
  // happens to appear first in an imported table.
  const found = new Set();
  for (const s of db.securities) {
    for (const e of s.mfn?.elections || []) {
      if (!selected.has(e.id)) continue;
      if (found.has(e.id)) fail(`Ambiguous MFN election: ${e.id}. Election IDs must identify one recorded election.`);
      found.add(e.id);
    }
  }
  const applied = [];
  const securities = db.securities.map((s) => {
    const elections = (s.mfn?.elections || []).filter((e) => selected.has(e.id));
    if (elections.length > 1) fail(`${s.label}: select only one MFN election per scenario.`);
    if (!elections.length) return s;
    const e = elections[0];
    selected.delete(e.id);
    if (s.convertedAt || e.date > date || e.sourceDate <= s.date
      || (!e.financings.includes('*') && !e.financings.includes(assumptions.id))) {
      fail(`${s.label}: MFN election is not applicable on this date or financing.`);
    }
    applied.push({
      securityId: s.id, ...clone(e),
      originalTerms: Object.fromEntries(Object.keys(e.terms).map((k) => [k, s[k]])),
    });
    return { ...s, ...e.terms };
  });
  if (selected.size) fail(`Unknown MFN election: ${[...selected].join(', ')}.`);
  return { db: { ...db, securities }, applied };
}

/* ---------- Dividends ---------- */

const YEAR_MS = 365 * 86400000;
/** The most rounding a fractional balance to the cent can add to a payment. */
const CENT_ROUNDING = 0.005;

/**
 * A certificate's dividend position on a date: what has accrued, been
 * declared and been paid, and the balance still owed.
 *
 * Accrual runs on the certificate's original principal (the economic basis,
 * or quantity x price when none was recorded) under whichever amendment was
 * in force, and is segmented at every amendment date, accrual start and end,
 * and cash event. Each segment is priced by the terms in force at its start,
 * so a later amendment changes nothing before its date - the historical
 * figures stand. Simple accrual is principal x rate x years; compound
 * accrual is (principal + unpaid balance) x ((1 + rate)^years - 1), so a
 * payment resets what compounds. Years are actual elapsed days over 365.
 *
 * Non-cumulative dividends accrue nothing on their own: only a declared
 * event creates a claim. A payment larger than the balance on its date is
 * refused - it would mean a payment of dividends that were never owed - but
 * only past half a cent: accrual is fractional and payments are made in
 * cents, so the balance paid in full is as often a fraction of a cent above
 * the figure as below it.
 */
export function dividendAccrual(security, cls, asOf) {
  const basis = security.economicBasis || { principal: security.quantity * (security.pricePerShare || 0), date: security.date };
  const empty = { principal: basis.principal, balance: 0, accrued: 0, declared: 0, paid: 0, breakdown: [] };
  if (asOf < basis.date) return empty;
  /* By day, and within a day declarations before payments: a dividend
     declared and paid on the same day is one event in two records, and the
     payment read as exceeding the balance whenever it was entered first. */
  const events = (security.dividendEvents || []).filter((e) => e.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'declared' ? -1 : 1));
  if (events.some((e) => e.date < basis.date)) fail(`${security.label}: a dividend event predates its original investment.`);

  // Every date the terms or the balance change on, in order.
  const dates = new Set([basis.date, asOf]);
  for (const t of cls.preferredTerms || []) {
    dates.add(t.date);
    if (t.dividends) {
      dates.add(t.dividends.start);
      if (t.dividends.end) dates.add(t.dividends.end);
    }
  }
  events.forEach((e) => dates.add(e.date));
  const points = [...dates].filter((d) => d >= basis.date && d <= asOf).sort();

  let balance = 0;
  let accrued = 0;
  let declared = 0;
  let paid = 0;
  const breakdown = [];
  for (let i = 0; i < points.length; i++) {
    const from = points[i];
    const to = points[i + 1];
    // Cash events land on their day, before the segment that starts there accrues.
    for (const e of events.filter((e) => e.date === from)) {
      if (e.type === 'declared') {
        balance += e.amount;
        declared += e.amount;
      } else {
        if (e.amount > balance + CENT_ROUNDING) fail(`${security.label}: dividend payment exceeds the balance on ${from}.`);
        balance = Math.max(0, balance - e.amount);
        paid += e.amount;
      }
    }
    const d = preferredAt(cls, from).dividends;
    if (!to || !d?.cumulative || from < d.start || (d.end && from >= d.end)) continue;
    const years = (Date.parse(to) - Date.parse(from)) / YEAR_MS;
    const amount = d.convention === 'simple'
      ? basis.principal * d.rate * years
      : (basis.principal + balance) * (Math.pow(1 + d.rate, years) - 1);
    balance += amount;
    accrued += amount;
    breakdown.push({ from, to, rate: d.rate, convention: d.convention, amount });
  }
  return { principal: basis.principal, balance, accrued, declared, paid, breakdown };
}

/**
 * The day the shares a certificate holds were first bought: its own date, or
 * for a transfer's successor the date at the root of the chain of
 * certificates it came off (that certificate's own basis date when it has
 * one). A basis derived after the fact - dividend terms recorded on a class
 * whose certificates had already changed hands - starts accruing there, as
 * one carried through the transfer by transferredEconomics does. Dated at the
 * transfer instead, the successors together accrued less than the certificate
 * they continue, by an amount that depended on which was recorded first.
 * Undefined when no certificate in the chain carries a usable date.
 */
export function originalIssueDate(security, securities = []) {
  let current = security;
  const seen = new Set();
  while (current?.fromTransferId && !seen.has(current.id)) {
    seen.add(current.id);
    current = securities.find((s) => s && s.id === current.fromTransferId);
  }
  const date = current?.economicBasis?.date || current?.date;
  return typeof date === 'string' && date ? date.slice(0, 10) : undefined;
}

/**
 * The economics a transferred certificate hands its successor for the part
 * that moved: the financing it came from, and its invested cash, original
 * basis and dividend history, each scaled by the fraction transferred.
 */
export function transferredEconomics(cert, quantity) {
  const fraction = quantity / cert.quantity;
  return {
    ...(cert.roundId ? { roundId: cert.roundId, financingEvidence: cert.financingEvidence } : {}),
    ...(cert.cashInvested !== undefined ? { cashInvested: cert.cashInvested * fraction } : {}),
    ...(cert.economicBasis ? { economicBasis: { ...cert.economicBasis, principal: cert.economicBasis.principal * fraction } } : {}),
    ...(cert.dividendEvents ? { dividendEvents: cert.dividendEvents.map((e) => ({ ...e, amount: e.amount * fraction })) } : {}),
  };
}

/* ---------- Export ---------- */

/**
 * A portable report of every negotiated term on the cap table, one row per
 * class or security that carries any, with each term family as a JSON
 * column - the same columns the security CSV import accepts, so a term can be
 * carried from one file to another. The JSON backup remains the full
 * relational restore.
 */
export function financingTermsRows(db) {
  const json = (v) => (v === undefined ? '' : JSON.stringify(v));
  const holder = (id) => db.stakeholders.find((h) => h.id === id)?.name || '';
  return [
    ['Record type', 'Record ID', 'Label', 'Holder', 'Pro-rata rights JSON', 'MFN JSON', 'Preferred terms JSON',
      'Dividend events JSON', 'Economic basis JSON', 'Financing evidence JSON'],
    ...db.classes.filter((c) => c.preferredTerms?.length)
      .map((c) => ['class', c.id, c.name, '', '', '', json(c.preferredTerms), '', '', '']),
    ...db.securities.filter((s) => s.proRata || s.mfn || s.dividendEvents || s.economicBasis || s.financingEvidence)
      .map((s) => ['security', s.id, s.label, holder(s.stakeholderId), json(s.proRata), json(s.mfn), '',
        json(s.dividendEvents), json(s.economicBasis), json(s.financingEvidence)]),
  ];
}
