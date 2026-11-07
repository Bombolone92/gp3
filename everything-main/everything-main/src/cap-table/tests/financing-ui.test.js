import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openCloseRound } from '../src/ui/closeround.js';
import { openSecurityForm } from '../src/ui/securityform.js';
import { openClassForm } from '../src/views/classes.js';
import { roundsView } from '../src/views/rounds.js';
import { modelRound } from '../src/lib/captable.js';
import { sharePrice } from '../src/lib/format.js';
import { capTableDigest } from '../src/lib/financing.js';
import { store } from '../src/lib/store.js';
import { puterBackend } from './helpers/puter-kv.js';

let dom;
let common;
let investor;
let founder;
let cert;
const right = { id: 'right-1', agreement: 'Side letter', start: '2024-06-01', basis: 'fixed', fraction: 0.1, financings: ['*'] };
const inputs = () => ({
  preMoney: 8_000_000, investment: 2_000_000, poolPct: 0, asOf: '2026-03-01',
  financing: { id: 'series-a', roundMode: 'fixed', elections: [{ rightId: 'right-1', amount: 200_000 }], mfnElections: [] },
});

beforeEach(async () => {
  dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/#/rounds', pretendToBeVisual: true });
  // Not `Event`: the store dispatches Node's own Event on its EventTarget.
  for (const name of ['window', 'document', 'location', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'requestAnimationFrame']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  puterBackend().install();
  await store.init();
  common = await store.addClass({ name: 'Common', kind: 'common' });
  founder = await store.addStakeholder({ name: 'Founder', kind: 'founder' });
  investor = await store.addStakeholder({ name: 'Seed Investor', kind: 'investor' });
  await store.addSecurity({ kind: 'shares', classId: common.id, stakeholderId: founder.id, quantity: 900_000, pricePerShare: 0.01, date: '2024-01-01' });
  cert = await store.addSecurity({ kind: 'shares', classId: common.id, stakeholderId: investor.id, quantity: 100_000, pricePerShare: 1, date: '2024-01-01', proRata: [right] });
});
afterEach(async () => {
  for (const sheet of [...document.querySelectorAll('.modal-root:not(.closing)')].reverse()) {
    sheet.querySelector('button[aria-label="Close"]')?.click();
  }
  await vi.waitFor(() => expect(document.querySelectorAll('.modal-root')).toHaveLength(0));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dom.window.close();
});

const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
const byLabel = (root, label) => {
  const l = [...root.querySelectorAll('.field-label')].find((x) => x.textContent.trim() === label);
  return l ? document.getElementById(l.htmlFor) : null;
};
const dialog = () => [...document.querySelectorAll('.modal-root')].at(-1);
const setValue = (input, value) => {
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};

describe('closing a round with elected pro-rata checks', () => {
  it('locks the elected check to its holder, leaves the rest open, and re-models when the date moves', async () => {
    const terms = inputs();
    const result = modelRound(store.db, terms);
    expect(result.unsupported).toBeUndefined();
    openCloseRound({ terms: { ...terms, name: 'Series A' }, result });
    const rows = [...dialog().querySelectorAll('.investor-row')];
    expect(rows).toHaveLength(2);
    const locked = rows[0];
    expect(locked.querySelector('select').value).toBe(investor.id);
    expect(locked.querySelector('select').disabled).toBe(true);
    expect(locked.querySelector('.investor-amount').readOnly).toBe(true);
    expect(locked.querySelector('.investor-amount').value).toBe('200,000');
    expect(rows[1].querySelector('.investor-amount').value).toBe('1,800,000');
    expect(rows[1].querySelector('select').disabled).toBe(false);
    // The remainder line is a live region: it follows every keystroke in the amounts.
    const remainder = [...dialog().querySelectorAll('.field-hint')].find((p) => /allocated/.test(p.textContent));
    expect(remainder.getAttribute('role')).toBe('status');
    expect(text(remainder)).toBe('All $2,000,000 allocated.');

    // The date is the model date, and stays editable: a later day prices again.
    const date = byLabel(dialog(), 'Closing date');
    expect(date.value).toBe('2026-03-01');
    expect(date.readOnly).toBe(false);
    setValue(date, '2026-04-01');
    expect(date.value).toBe('2026-04-01');
    expect(date.getAttribute('aria-invalid')).toBeNull();
    // Cleared, the sheet closes on today and the field says so.
    setValue(date, '');
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    setValue(date, '2026-04-01');
    // A day before the right's window is refused, with the reason, and the date kept.
    setValue(date, '2024-03-01');
    expect(date.value).toBe('2026-04-01');
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(text(document.querySelector('.toast'))).toMatch(/ineligible participation right/);
  });

  it('closes the confirmed allocation through the sheet and stamps the certificates', async () => {
    const terms = inputs();
    const result = modelRound(store.db, terms);
    openCloseRound({ terms: { ...terms, name: 'Series A' }, result });
    const open = [...dialog().querySelectorAll('.investor-row')][1];
    setValue(open.querySelector('.investor-new input'), 'Lead');
    dialog().querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(text(dialog())).toContain('Close the round'));
    expect(text(dialog())).toContain('Seed Investor');
    expect(text(dialog())).toContain('Lead');
    [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close the round').click();
    await vi.waitFor(() => expect(store.securities.filter((s) => s.roundId === 'series-a')).toHaveLength(2));
    const issued = store.securities.filter((s) => s.roundId === 'series-a');
    expect(issued.map((s) => s.quantity).sort((a, b) => a - b)).toEqual([25_000, 225_000]);
    expect(issued.find((s) => s.stakeholderId === investor.id).financingEvidence.rightIds).toEqual(['right-1']);
    expect(issued.find((s) => s.stakeholderId === investor.id).cashInvested).toBe(200_000);
  });
});

describe('round modeling view with negotiated terms', () => {
  it('shows the model date, the elections behind an open disclosure, and the participation breakdown', async () => {
    document.getElementById('app').append(roundsView());
    const root = document.getElementById('app');
    expect(byLabel(root, 'Model date')).not.toBeNull();
    const group = root.querySelector('details.terms-group');
    expect(group.open).toBe(true);
    // Selects wear the wrapper every other sheet gives them, chevron included.
    expect(byLabel(root, 'Round size').closest('.select-wrap')).not.toBeNull();
    const elected = byLabel(root, 'Seed Investor: elected check under right-1 ($)');
    expect(elected).not.toBeNull();
    // The currency in the label, as the pre-money and investment fields beside it.
    expect(byLabel(root, 'Pre-money valuation ($)')).not.toBeNull();
    // Blank until something is elected, like the terms fields beside it.
    expect(elected.value).toBe('');
    expect(elected.placeholder).toBe('0');
    setValue(byLabel(root, 'Pre-money valuation ($)'), '8,000,000');
    setValue(byLabel(root, 'New investment ($)'), '2,000,000');
    setValue(elected, '200,000');
    const breakdown = [...root.querySelectorAll('.card')].find((c) => /Participation rights and elections/.test(c.textContent));
    expect(breakdown).toBeDefined();
    expect(text(breakdown)).toMatch(/Maximum entitlement\s*\$200,000/);
    expect(text(breakdown)).toMatch(/Shares at the round price\s*25,000/);
    expect(text(breakdown)).toMatch(/Left for other investors\s*\$1,800,000 · 225,000 shares/);
    // Over the entitlement: said where the terms are typed, and the close is not offered.
    setValue(elected, '300,000');
    expect(text(root)).toContain('Review the financing terms');
    expect([...root.querySelectorAll('button')].some((b) => /Close this round/.test(b.textContent))).toBe(false);
    // A store-driven re-render reads the election back grouped, like its neighbours.
    setValue(elected, '200,000');
    document.getElementById('app').replaceChildren(roundsView());
    expect(byLabel(document.getElementById('app'), 'Seed Investor: elected check under right-1 ($)').value).toBe('200,000');
  });

  it('keeps the financing ID it minted across store-driven re-renders before anything is typed', async () => {
    const app = document.getElementById('app');
    app.append(roundsView());
    const first = byLabel(app, 'Financing ID').value;
    expect(first).not.toBe('');
    // A store write re-renders the view; the ID on screen has to be the one it showed.
    await store.updateStakeholder(founder.id, { name: 'Founder Renamed' });
    app.replaceChildren(roundsView());
    expect(byLabel(app, 'Financing ID').value).toBe(first);
  });

  it('flags an elected check that is not a number, and a blank financing ID, on the field', async () => {
    document.getElementById('app').append(roundsView());
    const root = document.getElementById('app');
    setValue(byLabel(root, 'Pre-money valuation ($)'), '8,000,000');
    setValue(byLabel(root, 'New investment ($)'), '2,000,000');
    const elected = byLabel(root, 'Seed Investor: elected check under right-1 ($)');
    setValue(elected, 'abc');
    expect(elected.getAttribute('aria-invalid')).toBe('true');
    expect(text(document.getElementById(elected.getAttribute('aria-errormessage')))).toBe('Enter a number');
    expect(text(root)).toContain('enter a number');
    setValue(elected, '200,000');
    expect(elected.getAttribute('aria-invalid')).toBeNull();
    const id = byLabel(root, 'Financing ID');
    setValue(id, '');
    expect(id.getAttribute('aria-invalid')).toBe('true');
    expect(text(root)).toContain('Financing ID');
  });

  it('says so when the model date reads an empty table, instead of going blank', async () => {
    document.getElementById('app').append(roundsView());
    const root = document.getElementById('app');
    setValue(byLabel(root, 'Pre-money valuation ($)'), '8,000,000');
    setValue(byLabel(root, 'New investment ($)'), '2,000,000');
    // Before the first certificate: the table as of that day holds nothing to dilute.
    setValue(byLabel(root, 'Model date'), '2023-06-01');
    const panel = root.querySelector('.round-layout > div:last-child');
    expect(text(panel)).toContain('Nothing on the cap table on that date');
    expect(text(panel)).toContain('Jun 1, 2023');
    expect([...root.querySelectorAll('button')].some((b) => /Close this round/.test(b.textContent))).toBe(false);
    // Moved onto the first issuance, the round prices again.
    setValue(byLabel(root, 'Model date'), '2024-01-01');
    expect(text(panel)).toContain('Round summary');
  });
});

describe('term editors on the security and class sheets', () => {
  it('records a pro-rata right and an MFN clause on a SAFE, then an election under it', async () => {
    const safe = await store.addSecurity({ kind: 'safe', stakeholderId: investor.id, principal: 100_000, valuationCap: 8_000_000, discount: 0, safeType: 'post', date: '2025-01-01' });
    openSecurityForm({ existing: safe });
    const sheet = dialog();
    for (const d of sheet.querySelectorAll('details.terms-group')) d.open = true;
    sheet.querySelector('input[aria-label="Record a most-favored-nation clause"]').click();
    setValue(byLabel(sheet, 'MFN agreement'), 'MFN side letter');
    setValue(byLabel(sheet, 'MFN eligible from'), '2025-01-01');
    sheet.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(store.security(safe.id).mfn).toBeDefined());
    expect(store.security(safe.id).mfn).toMatchObject({ agreement: 'MFN side letter', scope: ['valuationCap', 'discount'], eligibleKinds: ['safe'], elections: [] });

    await store.addSecurity({ kind: 'safe', stakeholderId: investor.id, principal: 10_000, valuationCap: 5_000_000, discount: 20, safeType: 'post', date: '2025-06-01' });
    await store.addSecurity({ kind: 'safe', stakeholderId: investor.id, principal: 5_000, discount: 0, safeType: 'post', date: '2025-07-01' });
    openSecurityForm({ existing: store.security(safe.id) });
    const again = dialog();
    for (const d of again.querySelectorAll('details.terms-group')) d.open = true;
    const source = byLabel(again, 'Eligible later instrument');
    expect(source.options).toHaveLength(3);
    expect(source.options[1].textContent).toContain('Jun 1, 2025 · a $5,000,000 cap, a 20% discount');
    // Uncapped and undiscounted, in the words the elections use, not "cap $0".
    expect(source.options[2].textContent).toContain('Jul 1, 2025 · no cap, no discount');
    setValue(source, source.options[1].value);
    setValue(byLabel(again, 'Election date'), '2025-07-01');
    setValue(byLabel(again, 'Election evidence'), 'Election notice');
    again.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(store.security(safe.id).mfn.elections).toHaveLength(1));
    expect(store.security(safe.id).mfn.elections[0]).toMatchObject({ terms: { valuationCap: 5_000_000, discount: 20 }, sourceDate: '2025-06-01', date: '2025-07-01' });
    expect(store.security(safe.id).valuationCap).toBe(8_000_000);
  });

  it('offers dividend cash events only on a certificate whose class carries dividend terms', async () => {
    // A common certificate: the store would refuse an event, so the group says what is missing.
    openSecurityForm({ existing: cert });
    let sheet = dialog();
    for (const d of sheet.querySelectorAll('details.terms-group')) d.open = true;
    expect(sheet.querySelector('input[aria-label="Record a dividend declaration or payment"]')).toBeNull();
    expect(text(sheet)).toContain('Dividend declarations and payments need dividend terms on Common');
    sheet.querySelector('button[aria-label="Close"]').click();
    await vi.waitFor(() => expect(document.querySelectorAll('.modal-root:not(.closing)')).toHaveLength(0));
    const dividends = { rate: 0.08, start: '2024-01-01', cumulative: true, convention: 'simple', dayCount: 'actual/365', atConversion: 'forfeit', atLiquidation: 'add' };
    const pref = await store.addClass({ name: 'Series Seed', kind: 'preferred', liquidationMultiple: 1, participating: true, seniority: 1, pricePerShare: 1,
      preferredTerms: [{ id: 'a1', date: '2024-01-01', agreement: 'Charter', dividends }] });
    const paid = await store.addSecurity({ kind: 'shares', classId: pref.id, stakeholderId: investor.id, quantity: 100, pricePerShare: 1, date: '2024-01-01' });
    openSecurityForm({ existing: paid });
    sheet = dialog();
    for (const d of sheet.querySelectorAll('details.terms-group')) d.open = true;
    expect(sheet.querySelector('input[aria-label="Record a dividend declaration or payment"]')).not.toBeNull();
    expect(byLabel(sheet, 'Dividend cash amount ($)')).not.toBeNull();
  });

  it('appends a dated cap and dividend amendment to a participating preferred class', async () => {
    const pref = await store.addClass({ name: 'Series Seed', kind: 'preferred', liquidationMultiple: 1, participating: true, seniority: 1, pricePerShare: 1 });
    openClassForm(pref);
    const sheet = dialog();
    for (const d of sheet.querySelectorAll('details.terms-group')) d.open = true;
    /* Inert until an amendment is being appended: terms typed under an
       unticked box were dropped at save without a word. */
    expect(byLabel(sheet, 'Annual rate (%)').disabled).toBe(true);
    expect(byLabel(sheet, 'Agreement reference').disabled).toBe(true);
    expect(sheet.querySelector('input[aria-label="Record dividend terms"]').disabled).toBe(true);
    sheet.querySelector('input[aria-label="Append a dated cap or dividend amendment"]').click();
    expect(byLabel(sheet, 'Annual rate (%)').disabled).toBe(false);
    sheet.querySelector('input[aria-label="Record dividend terms"]').click();
    setValue(byLabel(sheet, 'Effective date'), '2026-01-01');
    setValue(byLabel(sheet, 'Agreement reference'), 'Restated charter');
    setValue(byLabel(sheet, 'Participation cap (x invested capital)'), '3');
    setValue(byLabel(sheet, 'Annual rate (%)'), '8');
    setValue(byLabel(sheet, 'Accrual start'), '2026-01-01');
    sheet.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(store.shareClass(pref.id).preferredTerms).toHaveLength(1));
    expect(store.shareClass(pref.id).preferredTerms[0]).toMatchObject({
      date: '2026-01-01', agreement: 'Restated charter',
      cap: { multiple: 3, basis: 'invested', includesPreference: true, includesDividends: true },
      dividends: { rate: 0.08, start: '2026-01-01', cumulative: true, convention: 'simple', dayCount: 'actual/365' },
    });
    // The recorded amendment is shown as history the next time the sheet opens.
    openClassForm(store.shareClass(pref.id));
    expect(text(dialog().querySelector('.terms-history'))).toContain('Jan 1, 2026: 3x participation cap');
  });

  it('prefills the next amendment with the rate as it was typed, not with float noise', async () => {
    const dividends = { rate: 0.07, start: '2026-01-01', cumulative: true, convention: 'simple', dayCount: 'actual/365', atConversion: 'forfeit', atLiquidation: 'add' };
    const pref = await store.addClass({ name: 'Series Seed', kind: 'preferred', liquidationMultiple: 1, participating: true, seniority: 1, pricePerShare: 1,
      preferredTerms: [{ id: 'a1', date: '2026-01-01', agreement: 'Charter', dividends }] });
    openClassForm(pref);
    expect(byLabel(dialog(), 'Annual rate (%)').value).toBe('7');
  });
});

describe('dated terms on the class a close creates', () => {
  it('refuses a participation cap on a non-participating class at the field, before the review', async () => {
    const terms = inputs();
    openCloseRound({ terms: { ...terms, name: 'Series A' }, result: modelRound(store.db, terms) });
    const sheet = dialog();
    for (const d of sheet.querySelectorAll('details.terms-group')) d.open = true;
    sheet.querySelector('input[aria-label="Append a dated cap or dividend amendment"]').click();
    setValue(byLabel(sheet, 'Agreement reference'), 'Restated charter');
    const cap = byLabel(sheet, 'Participation cap (x invested capital)');
    setValue(cap, '3');
    setValue([...sheet.querySelectorAll('.investor-row')][1].querySelector('.investor-new input'), 'Lead');
    // The sheet's own opening focus lands first (a microtask), as it has by the time anyone submits.
    await new Promise((r) => setTimeout(r, 0));
    sheet.querySelector('form').requestSubmit();
    // Still on step one, the cap flagged with the reason and focused.
    expect(text(dialog())).not.toContain('Close the round');
    expect(cap.getAttribute('aria-invalid')).toBe('true');
    expect(text(document.getElementById(cap.getAttribute('aria-errormessage')))).toContain('Only a participating class can carry a participation cap');
    expect(document.activeElement).toBe(cap);
    // A cap that is not a number is flagged and focused the same way.
    sheet.querySelector('input[type="checkbox"]:not([aria-label])').click();
    setValue(cap, 'x');
    sheet.querySelector('form').requestSubmit();
    expect(cap.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(cap);
    setValue(cap, '3');
    // Participating, the same cap goes through to the review.
    sheet.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(text(dialog())).toContain('Close the round'));
    expect(text(dialog())).toContain('1x participating');
    expect(text(dialog())).toContain('3x participation cap');
  });

  it('reviews the amendment on the closing date, in the sheet’s date format', async () => {
    const terms = inputs();
    openCloseRound({ terms: { ...terms, name: 'Series A' }, result: modelRound(store.db, terms) });
    const sheet = dialog();
    for (const d of sheet.querySelectorAll('details.terms-group')) d.open = true;
    sheet.querySelector('input[aria-label="Append a dated cap or dividend amendment"]').click();
    setValue(byLabel(sheet, 'Agreement reference'), 'Restated charter');
    setValue(byLabel(sheet, 'Participation cap (x invested capital)'), '3');
    // A cap needs a participating class.
    sheet.querySelector('input[type="checkbox"]:not([aria-label])').click();
    setValue([...sheet.querySelectorAll('.investor-row')][1].querySelector('.investor-new input'), 'Lead');
    sheet.querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(text(dialog())).toContain('Close the round'));
    expect(text(dialog())).toMatch(/Dated preferred terms\s*Mar 1, 2026 · 3x participation cap · no dividends/);
    expect(text(dialog())).not.toContain('2026-03-01');
  });
});

describe('review wording', () => {
  it('says what whole-share rounding leaves over as a sentence, not a one-line figure', async () => {
    const terms = inputs();
    openCloseRound({ terms: { ...terms, name: 'Series A' }, result: modelRound(store.db, terms) });
    const open = [...dialog().querySelectorAll('.investor-row')][1];
    setValue(open.querySelector('.investor-amount'), '1,800,000.3');
    setValue(open.querySelector('.investor-new input'), 'Lead');
    dialog().querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(text(dialog())).toContain('Close the round'));
    const note = [...dialog().querySelectorAll('.field-hint')].find((p) => /Whole shares/.test(p.textContent));
    expect(text(note)).toBe('Whole shares: $2,000,000.30 in checks buys shares worth $2,000,000.00 at the round price; the difference is rounding.');
    expect([...dialog().querySelectorAll('.round-metric')].some((m) => /Rounding/.test(m.textContent))).toBe(false);
  });

  it('counts one share over the authorized count in the singular', async () => {
    // The round issues 250,000 shares; a class authorized for one fewer is over by one.
    await store.addClass({ name: 'Series A', kind: 'preferred', liquidationMultiple: 1, seniority: 1, pricePerShare: 8, authorized: 249_999 });
    const terms = inputs();
    openCloseRound({ terms: { ...terms, name: 'Series A' }, result: modelRound(store.db, terms) });
    expect(byLabel(dialog(), 'Share class').value).not.toBe('__new__');
    setValue([...dialog().querySelectorAll('.investor-row')][1].querySelector('.investor-new input'), 'Lead');
    dialog().querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(text(dialog())).toContain('Close the round'));
    expect(text(dialog())).toContain('Series A will hold 1 more share than its authorized count of 249,999');
  });
});

describe('step-one refusals land on the field at fault', () => {
  it('flags the first editable amount when the checks do not add up, not the locked elected check', async () => {
    const terms = inputs();
    openCloseRound({ terms: { ...terms, name: 'Series A' }, result: modelRound(store.db, terms) });
    await new Promise((r) => setTimeout(r, 0));
    const [locked, open] = [...dialog().querySelectorAll('.investor-amount')];
    expect(locked.readOnly).toBe(true);
    setValue(open, '1,000,000');
    setValue([...dialog().querySelectorAll('.investor-row')][1].querySelector('.investor-new input'), 'Lead');
    dialog().querySelector('form').requestSubmit();
    expect(open.getAttribute('aria-invalid')).toBe('true');
    expect(locked.getAttribute('aria-invalid')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('focuses the liquidation multiple it refuses', async () => {
    const terms = inputs();
    openCloseRound({ terms: { ...terms, name: 'Series A' }, result: modelRound(store.db, terms) });
    await new Promise((r) => setTimeout(r, 0));
    const multiple = byLabel(dialog(), 'Liquidation preference (x)');
    setValue(multiple, 'x');
    setValue([...dialog().querySelectorAll('.investor-row')][1].querySelector('.investor-new input'), 'Lead');
    dialog().querySelector('form').requestSubmit();
    expect(multiple.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(multiple);
  });
});

describe('the cap table moving under an open close sheet', () => {
  it('sends the user back to model again on any edit the store would refuse, a holder rename included', async () => {
    const terms = inputs();
    openCloseRound({ terms: { ...terms, name: 'Series A' }, result: modelRound(store.db, terms) });
    setValue([...dialog().querySelectorAll('.investor-row')][1].querySelector('.investor-new input'), 'Lead');
    // Another tab, or an Undo toast: the holders change while the sheet is up.
    await store.updateStakeholder(founder.id, { name: 'Founder Renamed' });
    dialog().querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(document.querySelectorAll('.modal-root:not(.closing)')).toHaveLength(0));
    expect(store.securities.some((s) => s.roundId === 'series-a')).toBe(false);
  });
});

describe('convertibles the closing date leaves out', () => {
  it('names them under the date, and says nothing once the date is past them', async () => {
    await store.addSecurity({ kind: 'safe', stakeholderId: investor.id, principal: 100_000, valuationCap: 5_000_000, safeType: 'post', date: '2026-06-01' });
    const terms = inputs();
    const result = modelRound(store.db, terms);
    expect(result.conversions).toHaveLength(0);
    openCloseRound({ terms: { ...terms, name: 'Series A' }, result });
    const hint = [...dialog().querySelectorAll('.field-hint')].find((p) => /stays outstanding/.test(p.textContent));
    expect(text(hint)).toBe('SAFE-1 is dated after Mar 1, 2026 and stays outstanding; it converts in a round closed on or after its date.');
    expect(hint.getAttribute('role')).toBe('status');
    // Past the SAFE's date it converts: the hint goes, and the price moves with the conversion.
    setValue(byLabel(dialog(), 'Closing date'), '2026-07-01');
    expect(hint.style.display).toBe('none');
    expect(text(dialog())).not.toContain(sharePrice(8));
  });
});

describe('the plan a top-up goes into', () => {
  it('skips a plan that expired before the closing date, even the most recently adopted one', async () => {
    await store.addPlan({ name: 'Old Plan', adopted: '2019-01-01', classId: common.id, reserve: 0 });
    // Adopted later, so it would have been the default, but expired before the close.
    await store.addPlan({ name: 'Lapsed Plan', adopted: '2021-01-01', expires: '2025-12-31', classId: common.id, reserve: 10_000 });
    const terms = { ...inputs(), poolPct: 0.1, name: 'Series A' };
    const result = modelRound(store.db, terms);
    expect(result.poolAdd).toBeGreaterThan(0);
    openCloseRound({ terms, result });
    // One plan can take it, so there is no picker, and it is not the lapsed one.
    expect(byLabel(dialog(), 'Pool top-up goes into')).toBeNull();
    setValue([...dialog().querySelectorAll('.investor-row')][1].querySelector('.investor-new input'), 'Lead');
    dialog().querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(text(dialog())).toContain('Close the round'));
    expect(text(dialog())).toContain('Old Plan reserve');
    expect(text(dialog())).not.toContain('Lapsed Plan reserve');
    [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close the round').click();
    await vi.waitFor(() => expect(store.securities.filter((s) => s.roundId === 'series-a')).toHaveLength(2));
    expect(store.plans.find((p) => p.name === 'Old Plan').reserve).toBe(result.poolAdd);
    expect(store.plans.find((p) => p.name === 'Lapsed Plan').reserve).toBe(10_000);
  });
});

describe('a model dated before a recorded anti-dilution adjustment', () => {
  const financing = (id) => ({ id, roundMode: 'fixed', elections: [], mfnElections: [] });
  async function closeDownRound() {
    await store.deleteSecurity(cert.id);
    const seed = await store.addClass({ name: 'Seed', kind: 'preferred', liquidationMultiple: 1, seniority: 1, pricePerShare: 1, antiDilution: 'broad' });
    await store.addSecurity({ kind: 'shares', classId: seed.id, stakeholderId: investor.id, quantity: 2_000_000, pricePerShare: 1, date: '2024-01-01' });
    const terms = { preMoney: 1_500_000, investment: 2_000_000, poolPct: 0, asOf: '2026-09-01', financing: financing('round-b') };
    const b = modelRound(store.db, terms);
    await store.closeRound({ date: terms.asOf, newClass: { name: 'Series B', kind: 'preferred', liquidationMultiple: 1 },
      modeling: { id: 'round-b', basisDigest: capTableDigest(store.db), inputs: b.modelInputs },
      investors: [{ newHolder: { name: 'Lead' }, amount: 2_000_000, quantity: Math.round(2_000_000 / b.pps), pricePerShare: b.pps }],
      adjustments: b.antiDilution.map((a) => ({ classId: a.classId, conversionPrice: a.conversionPriceAfter, holders: a.holders })) });
    expect(store.securities.some((s) => s.antiDilution)).toBe(true);
  }

  it('blocks Close in the round view and names the adjustment', async () => {
    await closeDownRound();
    document.getElementById('app').append(roundsView());
    const root = document.getElementById('app');
    setValue(byLabel(root, 'Pre-money valuation ($)'), '3,000,000');
    setValue(byLabel(root, 'New investment ($)'), '2,000,000');
    setValue(byLabel(root, 'Model date'), '2026-03-01');
    const close = [...root.querySelectorAll('button')].find((b) => /Close this round/.test(b.textContent));
    expect(close.disabled).toBe(true);
    expect(close.title).toMatch(/before the anti-dilution adjustment of Sep 1, 2026, so Seed reads a conversion price/);
    expect(text(root)).toContain('Dated before an adjustment');
    setValue(byLabel(root, 'Model date'), '2026-09-01');
    expect([...root.querySelectorAll('button')].find((b) => /Close this round/.test(b.textContent)).disabled).toBe(false);
  });

  it('refuses the closing date moved before the adjustment and floors the picker there', async () => {
    await closeDownRound();
    const terms = { preMoney: 3_000_000, investment: 2_000_000, poolPct: 0, asOf: '2026-09-10', financing: financing('round-a'), name: 'Series A' };
    openCloseRound({ terms, result: modelRound(store.db, terms) });
    const date = byLabel(dialog(), 'Closing date');
    expect(date.min).toBe('2026-09-01');
    setValue(date, '2026-03-01');
    expect(date.value).toBe('2026-09-10');
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(text(document.getElementById(date.getAttribute('aria-errormessage')))).toMatch(/before the anti-dilution adjustment of Sep 1, 2026/);
  });
});

describe('a model dated before a recorded conversion', () => {
  /* Round A converts the SAFE on June 1, 2025. Dated before that, a model
     reads the SAFE as live again and lists it converting a second time. */
  const financing = (id) => ({ id, roundMode: 'fixed', elections: [], mfnElections: [] });
  async function closeRoundA() {
    const safe = await store.addSecurity({ kind: 'safe', stakeholderId: investor.id, principal: 100_000, valuationCap: 5_000_000, date: '2024-06-01' });
    const model = modelRound(store.db, { preMoney: 10_000_000, investment: 1_000_000, asOf: '2025-06-01', financing: financing('round-a') });
    await store.closeRound({ date: '2025-06-01', newClass: { name: 'Series A', kind: 'preferred', liquidationMultiple: 1 },
      modeling: { id: 'round-a', basisDigest: capTableDigest(store.db), inputs: model.modelInputs },
      investors: [{ newHolder: { name: 'Lead' }, amount: 1_000_000, quantity: Math.round(1_000_000 / model.pps), pricePerShare: model.pps }],
      conversions: model.conversions.map((c) => ({ securityId: c.securityId, quantity: c.shares, pricePerShare: c.price })) });
    expect(store.security(safe.id).convertedAt).toBe('2025-06-01');
    return safe;
  }

  it('names the reopened conversion in the round view and disables Close', async () => {
    const safe = await closeRoundA();
    document.getElementById('app').append(roundsView());
    const root = document.getElementById('app');
    setValue(byLabel(root, 'Pre-money valuation ($)'), '20,000,000');
    setValue(byLabel(root, 'New investment ($)'), '5,000,000');
    setValue(byLabel(root, 'Model date'), '2025-01-01');
    const close = [...root.querySelectorAll('button')].find((b) => /Close this round/.test(b.textContent));
    expect(close.disabled).toBe(true);
    expect(close.title).toMatch(new RegExp(`${safe.label} converted on Jun 1, 2025`));
    expect(text(root)).toContain('Dated before a recorded round');
    // On the day of that round, the SAFE is converted and the round prices without it.
    setValue(byLabel(root, 'Model date'), '2025-06-01');
    const again = [...root.querySelectorAll('button')].find((b) => /Close this round/.test(b.textContent));
    expect(again.disabled).toBe(false);
    expect(text(root)).not.toContain('Convertible conversions');
  });

  it('marks the chip of a scenario whose financing has closed', async () => {
    await closeRoundA();
    await store.saveScenario({ name: 'Series A', preMoney: 10_000_000, investment: 1_000_000, asOf: '2025-06-01', financing: financing('round-a') });
    await store.saveScenario({ name: 'Series B', preMoney: 20_000_000, investment: 5_000_000, asOf: '2026-01-01', financing: financing('round-b') });
    document.getElementById('app').append(roundsView());
    const chips = [...document.querySelectorAll('.scenario-load')];
    expect(chips.map(text)).toEqual(['Series A · $10M pre · closed', 'Series B · $20M pre']);
    expect(chips[0].title).toBe('“Series A” closed on Jun 1, 2025. Load it to see its terms');
    expect(chips[1].title).toBe('Load “Series B” into the form');
  });

  it('refuses the closing date moved before that round, and keeps the date', async () => {
    const safe = await closeRoundA();
    const terms = { preMoney: 20_000_000, investment: 5_000_000, poolPct: 0, asOf: '2026-01-01', financing: financing('round-b'), name: 'Series B' };
    const result = modelRound(store.db, terms);
    expect(result.conversions).toHaveLength(0);
    openCloseRound({ terms, result });
    const date = byLabel(dialog(), 'Closing date');
    setValue(date, '2025-01-01');
    expect(date.value).toBe('2026-01-01');
    expect(date.getAttribute('aria-invalid')).toBe('true');
    // The reason sits on the field (the toast stack belongs to the first test's document).
    expect(text(document.getElementById(date.getAttribute('aria-errormessage')))).toMatch(new RegExp(`${safe.label} converted on Jun 1, 2025, after Jan 1, 2025`));
    // The review still lists no conversion, since the model kept its date.
    setValue(dialog().querySelector('.investor-row .investor-new input'), 'Lead 2');
    dialog().querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(text(dialog())).toContain('Close the round'));
    expect(text(dialog())).not.toContain(safe.label);
  });
});

describe('closing a base model', () => {
  it('prices the round again on the closing date, in that day’s split units', async () => {
    // No rights on the table: the base model, which reads the table as of its date.
    await store.deleteSecurity(cert.id);
    await store.recordSplit({ num: 2, den: 1, date: '2025-01-01' });
    const terms = { preMoney: 9_000_000, investment: 1_000_000, poolPct: 0, asOf: '2024-06-01', name: 'Series A' };
    const result = modelRound(store.db, terms);
    // Dated before the split, the model is in pre-split units: 900,000 shares at $10.
    expect(result.fdPre).toBe(900_000);
    expect(result.pps).toBe(10);
    openCloseRound({ terms, result });
    const date = byLabel(dialog(), 'Closing date');
    expect(date.value).toBe('2024-06-01');
    expect(text(dialog())).toContain(sharePrice(10));
    /* Moved past the split, the round is priced again on that day: 1,800,000
       of today's shares, $5 each. Left as modeled, the close wrote 100,000
       shares at $10 into the restated table - half the stake the money buys. */
    setValue(date, '2025-06-01');
    expect(date.getAttribute('aria-invalid')).toBeNull();
    expect(text(dialog())).toContain(sharePrice(5));
    const open = dialog().querySelector('.investor-row');
    setValue(open.querySelector('.investor-new input'), 'Lead');
    dialog().querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(text(dialog())).toContain('Close the round'));
    expect(text(dialog())).toContain('200,000');
    [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close the round').click();
    await vi.waitFor(() => expect(store.securities.some((s) => s.kind === 'shares' && s.classId !== common.id)).toBe(true));
    const issued = store.securities.find((s) => s.kind === 'shares' && s.classId !== common.id);
    expect(issued).toMatchObject({ quantity: 200_000, pricePerShare: 5, date: '2025-06-01' });
  });

  it('mints anti-dilution shares only on the protected certificates that exist on the closing date', async () => {
    await store.deleteSecurity(cert.id);
    const preferred = await store.addClass({ name: 'Series A Preferred', kind: 'preferred', liquidationMultiple: 1, seniority: 1, pricePerShare: 10, antiDilution: 'broad' });
    const later = await store.addStakeholder({ name: 'Second Closing', kind: 'investor' });
    await store.addSecurity({ kind: 'shares', classId: preferred.id, stakeholderId: investor.id, quantity: 100_000, pricePerShare: 10, date: '2024-06-01' });
    // A second closing already on the books, dated after the round below closes.
    await store.addSecurity({ kind: 'shares', classId: preferred.id, stakeholderId: later.id, quantity: 100_000, pricePerShare: 10, date: '2026-12-01' });
    // A down round, modeled as of a day the second closing has not happened yet.
    const terms = { preMoney: 3_000_000, investment: 1_000_000, poolPct: 0, asOf: '2026-09-01', name: 'Series B' };
    const result = modelRound(store.db, terms);
    expect(result.pps).toBeLessThan(10);
    expect(result.antiDilution).toHaveLength(1);
    expect(result.antiDilution[0].holders.map((h) => h.stakeholderId)).toEqual([investor.id]);
    const modeled = result.antiDilution[0].shares;
    openCloseRound({ terms, result });
    const open = dialog().querySelector('.investor-row');
    setValue(open.querySelector('.investor-new input'), 'Lead');
    dialog().querySelector('form').requestSubmit();
    await vi.waitFor(() => expect(text(dialog())).toContain('Close the round'));
    /* The review prices the adjustment the model priced: read off today's
       table instead, it listed shares for the December certificate too, and
       the close wrote them. */
    const table = dialog().querySelector('[aria-label="Anti-dilution adjustments table"]');
    expect(text(table)).toContain(modeled.toLocaleString('en-US'));
    [...dialog().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close the round').click();
    await vi.waitFor(() => expect(store.securities.some((s) => s.antiDilution)).toBe(true));
    const minted = store.securities.filter((s) => s.antiDilution);
    expect(minted.reduce((a, s) => a + s.quantity, 0)).toBe(modeled);
    expect(minted.map((s) => s.stakeholderId)).toEqual([investor.id]);
  });
});
