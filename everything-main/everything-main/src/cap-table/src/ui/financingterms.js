/**
 * Forms for negotiated financing terms - the structured inputs financing.js
 * validates - and for the assumptions a round scenario is modeled under.
 *
 *   preferredTermsEditor  a dated cap / dividend amendment on a preferred class
 *   securityTermsEditor   pro-rata rights, an MFN clause and its elections, and
 *                         dividend cash events on one security
 *   financingEditor       a scenario's model date, financing ID, round size
 *                         convention, pro-rata elections and MFN elections
 *   financingBreakdown    the card that explains a modeled round's rights
 *
 * Each editor reads its fields into exactly the structure the validators
 * take, and lets a FinancingError reach the form, which shows it as it is.
 * History is shown above the fields and is never editable here: rights,
 * amendments, elections and cash events are appended, not rewritten.
 */
import { el } from './dom.js';
import { field, flagInvalid } from './bits.js';
import { uid, todayISO, parseNum } from '../lib/util.js';
import { money, moneyWhole, shares, sharesLabel, pct, percentValue, amountValue, dateLong, currencySymbol } from '../lib/format.js';

/* Dates in prose read the way every other date in the app reads ("Jun 1,
   2025"), not as the ISO string the record stores. */
const span = (start, end) => `${dateLong(start)} to ${end ? dateLong(end) : 'ongoing'}`;
import {
  validateProRata, validateMFN, validatePreferred, validateDividendEvents, validateFinancing,
  mfnCandidates, electMFN, FinancingError,
} from '../lib/financing.js';

const input = (label, value = '', type = 'text') => el('input.input', { type, value, 'aria-label': label });
const select = (label, values, value) => el('select.select', { 'aria-label': label },
  values.map(([v, name]) => el('option', { value: v, selected: v === value }, name)));
/* The wrapper every other sheet gives a select: it draws the chevron and
   reserves the room for it, and without it the longest option was cut off
   at the field's edge with nothing to say the control opened at all. */
const wrap = (s) => el('div.select-wrap', {}, s);
const check = (label, checked = false) => {
  const control = el('input', { type: 'checkbox', checked, 'aria-label': label });
  return { control, node: el('label.check-row', {}, control, el('span', {}, label)) };
};
/** A number typed into a field, or the refusal the form shows. */
const num = (i) => {
  const n = parseNum(i.value);
  /* field() moves the caption onto a <label>, dropping the aria-label it
     was built with, so the refusal read "null: enter a number." */
  const name = i.labels?.[0]?.textContent?.trim() || i.getAttribute('aria-label') || 'This field';
  if (n === null) {
    /* Marked on the field as every other refusal in the app is, with the
       reason tied to it: said in a toast alone, a screen reader landed on
       nothing and a sighted reader had to find the field the toast named.
       Not focused here - the round model reads its fields on every
       keystroke, and focus would jump mid-word; the sheets focus at save. */
    flagInvalid(i, 'Enter a number');
    throw new FinancingError(`${name}: enter a number.`);
  }
  return n;
};
/* An MFN election's terms in words: "a $6,000,000 cap, a 25% discount". */
const TERM_WORDS = {
  valuationCap: (v) => (v > 0 ? `a ${moneyWhole(v)} cap` : 'no cap'),
  discount: (v) => (v > 0 ? `a ${v}% discount` : 'no discount'),
  safeType: (v) => `the ${v === 'post' ? 'post-money' : 'pre-money'} form`,
};
const SCOPE_WORDS = { valuationCap: 'the valuation cap', discount: 'the discount', safeType: 'the SAFE money convention' };
export const termWords = (terms) => Object.entries(terms || {})
  .map(([k, v]) => (TERM_WORDS[k] ? TERM_WORDS[k](v ?? 0) : `${k} ${v ?? 'none'}`)).join(', ');
/* Behind a disclosure, closed unless something already recorded says
   otherwise: on most forms these terms are the exception, not the rule. */
const group = (title, open, ...children) => el('details.terms-group', { open },
  el('summary', {}, title), el('div.terms-body', {}, ...children));
const reference = (label = 'Agreement reference') => input(label);
const history = (entries, describe) => (entries?.length
  ? el('ul.small.muted.terms-history', {}, entries.map((e) => el('li', {}, describe(e))))
  : null);
const idList = (value) => value.split(',').map((x) => x.trim()).filter(Boolean);
const percent = (fraction) => `${Math.round(fraction * 10000) / 100}%`;

/** What each pro-rata denominator is called on screen - see PRO_RATA_BASES. */
export const BASIS_LABELS = {
  fixed: 'Fixed contractual percentage',
  'pre-round-fd': 'Holder’s pre-round fully diluted ownership',
  'yc-post-money': 'YC post-money SAFE side letter',
  'yc-original': 'Original YC right, in the financing after conversion',
};

/**
 * A dated amendment to a preferred class's participation cap and dividend
 * terms, appended to whatever amendments the class already carries. The
 * fields start from the latest amendment, since most amendments change one
 * thing; a blank cap on a new amendment removes the cap from its date.
 *
 * @param existing  the class being edited, or null for one being created
 * @param date      the day the caller is working on (the close sheet's closing
 *                  date): the effective date and accrual start open on it and
 *                  follow it through `follow()` until typed over. Today when
 *                  absent. Opened on today regardless, a round closed as of
 *                  March wrote terms dated September against certificates
 *                  dated March, and with amendments append-only the six
 *                  months of dividends they never accrued could not be
 *                  recovered.
 */
export function preferredTermsEditor(existing, { date: workingDate = todayISO() } = {}) {
  const previous = existing?.preferredTerms || [];
  const last = previous.at(-1) || {};
  const enabled = check('Append a dated cap or dividend amendment');
  const date = input('Amendment effective date', workingDate, 'date');
  const agreement = reference('Amendment agreement reference');
  const cap = input('Participation cap multiple', last.cap?.multiple ?? '');
  const includesPreference = check('The cap includes the initial preference', last.cap?.includesPreference ?? true);
  const includesDividends = check('The cap includes accrued dividends', last.cap?.includesDividends ?? true);
  const dividends = check('Record dividend terms', !!last.dividends);
  const rate = input('Annual dividend rate (%)', percentValue(last.dividends?.rate || 0));
  const start = input('Dividend accrual start', last.dividends?.start || workingDate, 'date');
  const typed = new Set();
  date.addEventListener('input', () => typed.add('date'));
  start.addEventListener('input', () => typed.add('start'));
  const end = input('Dividend accrual end', last.dividends?.end || '', 'date');
  const cumulative = check('Cumulative: dividends accrue whether or not declared', last.dividends?.cumulative ?? true);
  const convention = select('Dividend accrual convention', [
    ['simple', 'Simple, on the original investment'],
    ['compound', 'Compound, on the investment plus unpaid dividends'],
  ], last.dividends?.convention || 'simple');
  const conversion = select('Unpaid dividends on conversion', [
    ['forfeit', 'Forfeited'],
    ['cash', 'Kept as a cash claim at the class’s seniority'],
  ], last.dividends?.atConversion || 'forfeit');
  const liquidation = select('Unpaid dividends at liquidation', [
    ['add', 'Added after the preference multiple'],
    ['multiply', 'Included in the amount the multiple applies to'],
  ], last.dividends?.atLiquidation || 'add');
  const describe = (t) => `${dateLong(t.date)}: ${t.cap ? `${t.cap.multiple}x participation cap` : 'no cap'}; `
    + `${t.dividends ? `${percent(t.dividends.rate)} ${t.dividends.cumulative ? 'cumulative' : 'non-cumulative'} dividends` : 'no dividend accrual'}. ${t.agreement}`;
  /* Nothing below the checkbox takes input until an amendment is being
     appended: every field sat live under an unticked box, and terms typed
     into them - an agreement, a rate - were dropped without a word at save,
     since read() returns the history as it stands when the box is off. */
  const amendmentControls = [date, agreement, cap, includesPreference.control, includesDividends.control, dividends.control,
    rate, start, end, cumulative.control, convention, conversion, liquidation];
  const syncEnabled = () => { for (const c of amendmentControls) c.disabled = !enabled.control.checked; };
  enabled.control.addEventListener('change', syncEnabled);
  syncEnabled();
  return {
    node: group('Participation cap and dividends', previous.length > 0,
      history(previous, describe),
      enabled.node,
      field('Effective date', date),
      field('Agreement reference', agreement, 'The charter or amendment these terms come from.'),
      field('Participation cap (x invested capital)', cap,
        'Only a participating class can carry a cap. Leave blank to record no cap from this date.'),
      includesPreference.node,
      includesDividends.node,
      dividends.node,
      field('Annual rate (%)', rate),
      field('Accrual start', start),
      field('Accrual end (optional)', end),
      cumulative.node,
      field('Accrual convention', wrap(convention), 'Actual elapsed days over 365. Non-cumulative dividends accrue only what is declared on a certificate.'),
      field('On conversion', wrap(conversion)),
      field('At liquidation', wrap(liquidation))),
    /**
     * The full amendment list to save, or undefined to leave the class as it
     * is. `participating` is the class's own setting on the form beside this
     * editor: a cap on a non-participating class is refused here, at the
     * field, rather than by the store at the last press of the close sheet.
     */
    read({ participating = null } = {}) {
      if (!enabled.control.checked) return previous.length ? previous : undefined;
      // Said at the field, not only in a toast with the validator's wording.
      if (!agreement.value.trim()) {
        flagInvalid(agreement, 'Name the charter or amendment these terms come from');
        agreement.focus();
        throw new FinancingError('Amendment agreement: name the charter or amendment these terms come from.');
      }
      const t = { id: uid(), date: date.value, agreement: agreement.value };
      if (cap.value.trim()) {
        if (participating === false) {
          const reason = 'Only a participating class can carry a participation cap. Tick Participating, or leave the cap blank.';
          flagInvalid(cap, reason);
          cap.focus();
          throw new FinancingError(`Participation cap: ${reason}`);
        }
        t.cap = { multiple: num(cap), basis: 'invested', includesPreference: includesPreference.control.checked, includesDividends: includesDividends.control.checked };
      }
      if (dividends.control.checked) {
        // Said at the field, before the validator's own refusal.
        if (end.value && start.value && end.value < start.value) {
          flagInvalid(end, 'The accrual end is before its start');
          end.focus();
          throw new FinancingError('Dividend accrual end precedes its start.');
        }
        t.dividends = {
          rate: num(rate) / 100, start: start.value, ...(end.value ? { end: end.value } : {}),
          cumulative: cumulative.control.checked, convention: convention.value, dayCount: 'actual/365',
          atConversion: conversion.value, atLiquidation: liquidation.value,
        };
      }
      return validatePreferred([...previous, t]);
    },
    /** The caller's working day moved; the dates nobody typed over move with it. */
    follow(day) {
      if (!day) return;
      if (!typed.has('date')) date.value = day;
      if (!typed.has('start') && !last.dividends?.start) start.value = day;
    },
  };
}

/**
 * The negotiated terms one security carries: a pro-rata right to add, an MFN
 * clause (on a SAFE or note) or an election under one already recorded, and a
 * dividend declaration or payment (on a certificate).
 *
 * @param db        the cap table, for the MFN candidates
 * @param existing  the security being edited, or null for a new one
 * @param kind      the security kind the sheet is showing
 */
export function securityTermsEditor(db, existing, kind) {
  const old = existing || {};

  /* Pro-rata rights. */
  const addRight = check('Add a pro-rata right');
  const basis = select('Participation ownership basis', Object.entries(BASIS_LABELS), 'fixed');
  const fraction = input('Contractual participation (%)', '10');
  const limit = input('Maximum participation cash (optional)');
  const start = input('Right eligible from', todayISO(), 'date');
  const end = input('Right eligible until', '', 'date');
  const agreement = reference('Pro-rata agreement reference');
  const financings = input('Applicable financing IDs', '*');
  const rightsNode = group('Pro-rata participation rights', (old.proRata || []).length > 0,
    history(old.proRata, (r) => `${r.id}: ${BASIS_LABELS[r.basis]}${r.fraction !== undefined ? ` (${percent(r.fraction)})` : ''}, `
      + `${span(r.start, r.end)}. ${r.agreement}`),
    addRight.node,
    field('Pro-rata agreement reference', agreement),
    field('Ownership basis', wrap(basis), 'Promised options and bespoke denominator exclusions are not modeled.'),
    field('Fixed participation (%)', fraction, 'Read only for a fixed contractual percentage.'),
    // Money fields wear the company's currency in their label, as "Principal ($)" beside them does.
    field(`Cash limit (${currencySymbol()})`, limit, 'Optional. The most the right can put into one round.'),
    field('Right eligible from', start),
    field('Right eligible until (optional)', end),
    field('Right applies to financing IDs', financings, 'Comma-separated financing IDs from Round modeling, or * for every financing.'));

  /* MFN: the clause, or an election under it. */
  const convertible = kind === 'safe' || kind === 'note';
  const mfnEnabled = check('Record a most-favored-nation clause');
  const mfnAgreement = reference('MFN agreement reference');
  const mfnStart = input('MFN eligibility start', todayISO(), 'date');
  const mfnEnd = input('MFN eligibility end', '', 'date');
  const scope = ['valuationCap', 'discount', ...(kind === 'safe' ? ['safeType'] : [])]
    .map((key) => ({ key, ...check(`MFN covers ${{ valuationCap: 'the valuation cap', discount: 'the discount', safeType: 'the SAFE money convention' }[key]}`, key !== 'safeType') }));
  const eligibleKinds = select('MFN eligible instrument kind', [['safe', 'SAFEs'], ['note', 'Notes'], ['both', 'SAFEs and notes']], 'safe');
  const candidates = existing ? mfnCandidates(db, existing) : [];
  const source = select('MFN election source', [
    ['', 'No new election'],
    // In the words the elections themselves are described in: an uncapped SAFE read "cap $0".
    ...candidates.map((s) => [s.id, `${s.label} · ${dateLong(s.date)} · ${termWords({ valuationCap: s.valuationCap, discount: s.discount })}`]),
  ], '');
  const electionDate = input('MFN election date', todayISO(), 'date');
  const evidence = reference('MFN election evidence');
  const electionFinancings = input('MFN election financing IDs', '*');
  const mfnNode = !convertible ? null : group('Most-favored-nation terms', !!old.mfn,
    old.mfn
      ? el('div', {},
        el('p.small', {}, `${old.mfn.agreement}: covers ${old.mfn.scope.map((k) => SCOPE_WORDS[k] || k).join(', ')}; eligible ${span(old.mfn.start, old.mfn.end)}.`),
        history(old.mfn.elections, (e) => `${dateLong(e.date)}: took ${termWords(e.terms)} from ${db.securities.find((s) => s.id === e.sourceId)?.label || e.sourceId}. ${e.agreement}`),
        field('Eligible later instrument', wrap(source), candidates.length
          ? 'Recording an election copies that instrument’s terms as they stand today. A scenario still chooses whether to apply it.'
          : 'No later instrument currently matches this clause.'),
        field('Election date', electionDate),
        field('Election evidence', evidence),
        field('Election applies to financing IDs', electionFinancings))
      : el('div', {},
        mfnEnabled.node,
        field('MFN agreement', mfnAgreement),
        field('MFN eligible from', mfnStart),
        field('MFN eligible until (optional)', mfnEnd),
        ...scope.map((s) => s.node),
        field('MFN eligible instruments', wrap(eligibleKinds))));

  /* Dividend cash events on a certificate. */
  const addEvent = check('Record a dividend declaration or payment');
  const eventType = select('Dividend event type', [
    ['payment', 'Payment of accrued or declared dividends'],
    ['declared', 'Declared dividend'],
  ], 'payment');
  const eventDate = input('Dividend event date', todayISO(), 'date');
  const amount = input('Dividend cash amount');
  const eventEvidence = reference('Dividend event evidence');
  /* Only a certificate in a preferred class with dividend terms can carry a
     cash event - the store refuses one on any other (the accrual it is paid
     against does not exist). The fields were offered on every certificate,
     and a payment typed on a common one met the refusal at save with nothing
     flagged; the group says what is missing instead. */
  const cls = existing ? db.classes.find((c) => c.id === existing.classId) : null;
  const dividendable = cls?.kind === 'preferred' && (cls.preferredTerms || []).some((t) => t.dividends);
  const eventNode = kind !== 'shares' ? null : group('Dividend history', (old.dividendEvents || []).length > 0,
    old.economicBasis
      ? el('p.small.muted', {}, `Dividends accrue on ${moneyWhole(old.economicBasis.principal)} invested on ${dateLong(old.economicBasis.date)}, through every split and transfer.`)
      : null,
    history(old.dividendEvents, (e) => `${dateLong(e.date)}: ${e.type === 'declared' ? 'declared' : 'paid'} ${moneyWhole(e.amount)}. ${e.evidence}`),
    dividendable
      ? [addEvent.node,
        field('Dividend event', wrap(eventType)),
        field('Dividend event date', eventDate),
        field(`Dividend cash amount (${currencySymbol()})`, amount),
        field('Dividend evidence', eventEvidence)]
      : el('p.field-hint', {}, existing
        ? `Dividend declarations and payments need dividend terms on ${cls?.name || 'the certificate’s class'}. Record them on the class under Share classes first.`
        : 'Dividend declarations and payments can be recorded once the certificate is issued into a preferred class with dividend terms.'));

  return {
    node: el('div', {}, rightsNode, mfnNode, eventNode),
    /** The fields to merge into the security's save; empty when nothing was added. */
    read() {
      const patch = {};
      if (addRight.control.checked) {
        const r = {
          id: uid(), agreement: agreement.value, start: start.value, ...(end.value ? { end: end.value } : {}),
          basis: basis.value, financings: idList(financings.value),
        };
        if (basis.value === 'fixed') r.fraction = num(fraction) / 100;
        if (limit.value.trim()) r.limit = num(limit);
        patch.proRata = validateProRata([...(old.proRata || []), r]);
      }
      if (convertible && !old.mfn && mfnEnabled.control.checked) {
        patch.mfn = validateMFN({
          agreement: mfnAgreement.value, start: mfnStart.value, ...(mfnEnd.value ? { end: mfnEnd.value } : {}),
          scope: scope.filter((s) => s.control.checked).map((s) => s.key),
          eligibleKinds: eligibleKinds.value === 'both' ? ['safe', 'note'] : [eligibleKinds.value],
          elections: [],
        });
      }
      if (old.mfn && source.value) {
        patch.mfn = {
          ...old.mfn,
          elections: [...old.mfn.elections, electMFN(db, old, {
            id: uid(), sourceId: source.value, date: electionDate.value, agreement: evidence.value, financings: idList(electionFinancings.value),
          })],
        };
      }
      if (kind === 'shares' && dividendable && addEvent.control.checked) {
        patch.dividendEvents = validateDividendEvents([...(old.dividendEvents || []), {
          id: uid(), type: eventType.value, date: eventDate.value, amount: num(amount), evidence: eventEvidence.value,
        }]);
      }
      return patch;
    },
  };
}

/**
 * The assumptions a round scenario is modeled under. The model date is always
 * in view: the round is priced on the table as it stood that day, and that is
 * the closing date the close sheet offers. The financing ID, round size
 * convention and the elections sit behind a disclosure, open when the table
 * carries rights or elections to decide on.
 *
 * @param db        the cap table whose rights and MFN elections are listed
 * @param initial   { asOf, financing } from a saved scenario, or {}
 * @param onChange  called on every edit, so the model re-runs
 */
export function financingEditor(db, initial = {}, onChange = () => {}) {
  const holderOf = (s) => db.stakeholders.find((h) => h.id === s.stakeholderId)?.name || s.label;
  const date = input('Model date', initial.asOf || todayISO(), 'date');
  const id = input('Financing ID', initial.financing?.id || uid());
  const mode = select('Round size convention', [
    ['fixed', 'Fixed total (elected checks fit inside)'],
    ['additional', 'Additional (elected checks add to the total)'],
  ], initial.financing?.roundMode || 'fixed');
  const rights = db.securities.flatMap((s) => (s.proRata || []).map((r) => ({ ...r, security: s })));
  /* Grouped the way the pre-money and investment fields beside them read,
     and blank for nothing elected: the field opened on a bare "0" that a
     figure was typed behind ("0200000"), and a saved election came back as
     an ungrouped run of digits under grouped neighbours. */
  const amounts = rights.map((r) => {
    const amount = initial.financing?.elections?.find((e) => e.rightId === r.id)?.amount || 0;
    const control = input(`Elected check for ${holderOf(r.security)} under ${r.id}`, amount ? amountValue(amount) : '');
    control.placeholder = '0';
    control.inputMode = 'numeric';
    return { r, control };
  });
  // Blank elects nothing, as the hint under each field says.
  const elected = (control) => (control.value.trim() ? num(control) : 0);
  const mfns = db.securities.flatMap((s) => (s.mfn?.elections || []).map((e) => ({
    e, ...check(`Apply ${s.label}’s MFN election of ${dateLong(e.date)} (${e.id})`, !!initial.financing?.mfnElections?.includes(e.id)),
  })));
  const negotiable = rights.length > 0 || mfns.length > 0;
  const node = el('div', {},
    field('Model date', date, 'The round is priced on the cap table as it stands on this day, and offered for closing on it.'),
    group('Financing ID, round size and elections', negotiable,
      field('Financing ID', id, 'What pro-rata rights and MFN elections name to apply to this round. The same ID cannot close twice.'),
      field('Round size', wrap(mode)),
      // Named by the right too: a holder with two rights had two fields under one label.
      ...amounts.map(({ r, control }) => field(`${holderOf(r.security)}: elected check under ${r.id} (${currencySymbol()})`, control,
        `${BASIS_LABELS[r.basis]}${r.fraction !== undefined ? ` (${percent(r.fraction)})` : ''}, eligible ${span(r.start, r.end)}. Zero elects nothing.`)),
      ...mfns.map((m) => m.node),
      negotiable ? null : el('p.field-hint', {}, 'No pro-rata rights or MFN elections are recorded on this cap table. Record them on a security to elect them here.')));
  node.addEventListener('input', onChange);
  node.addEventListener('change', onChange);
  return {
    node,
    /** { asOf, financing } as modelRound takes them; throws a FinancingError the view shows. */
    read() {
      // Flagged where it is typed; the validator's own refusal follows.
      if (!id.value.trim()) flagInvalid(id, 'Enter a financing ID');
      return {
        asOf: date.value,
        financing: validateFinancing({
          id: id.value.trim(),
          roundMode: mode.value,
          elections: amounts.filter(({ control }) => elected(control) !== 0).map(({ r, control }) => ({ rightId: r.id, amount: elected(control) })),
          mfnElections: mfns.filter((m) => m.control.checked).map((m) => m.e.id),
        }),
      };
    },
  };
}

/**
 * How a modeled round honoured its rights: each eligible right's entitlement,
 * election, whole shares and any shortfall or excess, the MFN elections
 * applied, and what rounding to whole shares left over. Nothing to show on a
 * round with no rights or elections in play.
 */
export function financingBreakdown(result, db) {
  const f = result?.financing;
  if (!f || (!f.allocations.length && !f.appliedMFN.length)) return null;
  const holderName = (id) => db.stakeholders.find((h) => h.id === id)?.name || 'Unknown holder';
  const securityLabel = (id) => db.securities.find((s) => s.id === id)?.label || id;
  const metric = (label, value) => el('div.round-metric', {}, el('span', {}, label), el('span.v', {}, value));
  return el('div.card', { style: { marginBottom: '16px' } },
    el('h2.card-title', {}, 'Participation rights and elections'),
    el('p.card-sub', { style: { marginBottom: '10px' } },
      f.roundMode === 'fixed'
        ? 'Elected checks fit inside the fixed total, and the rest of the round goes to other investors.'
        : 'Elected checks are added to the entered investment; entitlements are measured on the resulting total.'),
    metric(f.roundMode === 'fixed' ? 'Total raise' : 'Raise including elected checks', moneyWhole(f.investment)),
    metric('Left for other investors', `${moneyWhole(f.remaining)} · ${sharesLabel(f.remainingShares)}`),
    ...f.allocations.map((a) => el('div.terms-allocation', {},
      el('h3.small', {}, `${holderName(a.stakeholderId)} · ${BASIS_LABELS[a.basis]} · ${pct(a.fraction, 4)}`),
      metric('Maximum entitlement', moneyWhole(a.entitlement)),
      metric('Elected', moneyWhole(a.elected)),
      metric('Shares at the round price', shares(a.shares)),
      a.unmet > 0.005 ? metric('Unmet entitlement', moneyWhole(a.unmet)) : null,
      a.overallocated > 0.005 ? el('p.field-hint.warn', {}, `${moneyWhole(a.overallocated)} over the entitlement. Lower the check or raise the round.`) : null,
      a.elected > 0 && a.shares === 0 ? el('p.field-hint.warn', {}, 'This check buys no whole share at the round price.') : null)),
    ...f.appliedMFN.map((e) => el('p.small', {},
      `MFN: ${securityLabel(e.securityId)} takes ${termWords(e.terms)} `
      + `from ${securityLabel(e.sourceId)} (was ${termWords(e.originalTerms)}), `
      + `elected ${dateLong(e.date)}. ${e.agreement}`)),
    Math.abs(f.cashRounding) >= 0.005
      ? el('p.small.muted', { style: { marginTop: '8px' } },
        `Whole shares: the checks total ${money(f.investment)} and buy shares worth ${money(f.investment - f.cashRounding)} at the round price; `
        + `the ${money(Math.abs(f.cashRounding))} difference is rounding.`)
      : null);
}
