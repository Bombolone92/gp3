import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openSecurityForm } from '../src/ui/securityform.js';
import { grantVested } from '../src/lib/captable.js';
import { store } from '../src/lib/store.js';
import { puterBackend } from './helpers/puter-kv.js';

let dom;
let holder;

beforeEach(async () => {
  dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/#/securities', pretendToBeVisual: true });
  // Not `Event`: the store dispatches Node's own Event on its EventTarget.
  for (const name of ['window', 'document', 'location', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'requestAnimationFrame']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  puterBackend().install();
  await store.init();
  await store.addClass({ name: 'Common', kind: 'common' });
  holder = await store.addStakeholder({ name: 'Nova', kind: 'employee' });
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
const save = async (sheet) => {
  sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelectorAll('.modal-root:not(.closing)')).toHaveLength(0));
};
const grantSheet = (existing = null) => {
  openSecurityForm(existing ? { existing } : { kind: 'option' });
  const sheet = dialog();
  if (!existing) {
    setValue(byLabel(sheet, 'Stakeholder'), holder.id);
    setValue(byLabel(sheet, 'Options granted'), '1,000');
    setValue(byLabel(sheet, 'Grant date'), '2026-09-10');
  }
  return sheet;
};

describe('a record settled under an open edit sheet', () => {
  it('closes the sheet with the toast instead of leaving Save disabled', async () => {
    const cls = store.classes[0];
    const cert = await store.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: cls.id, quantity: 100, pricePerShare: 1, date: '2024-01-01' });
    openSecurityForm({ existing: cert });
    const sheet = dialog();
    // A toast's Undo or another tab closes the certificate while the sheet is up.
    await store.transferShares(cert.id, { date: '2025-01-01', quantity: 100, to: { newHolder: { name: 'Buyer', kind: 'investor' } } });
    setValue(byLabel(sheet, 'Price per share ($)'), '2');
    sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelectorAll('.modal-root:not(.closing)')).toHaveLength(0));
    expect(document.body.textContent).toContain('was closed by a transfer while this sheet was open');
    expect(store.security(cert.id).pricePerShare).toBe(1);
  });
});

describe('a warrant\'s exercise certificate on the edit sheet', () => {
  it('keeps the warrant\'s class and holds the date to the exercise window, pointing at the field', async () => {
    const cls = store.classes[0];
    const other = await store.addClass({ name: 'Series A', kind: 'preferred' });
    const warrant = await store.addSecurity({ kind: 'warrant', stakeholderId: holder.id, classId: cls.id, quantity: 200, strike: 1, date: '2024-01-01', expires: '2030-01-01' });
    const cert = await store.exerciseWarrant(warrant.id, { quantity: 50, date: '2025-01-01' });
    openSecurityForm({ existing: store.security(cert.id) });
    const sheet = dialog();
    const classPick = byLabel(sheet, 'Share class');
    expect(classPick.disabled).toBe(true);
    expect(classPick.value).toBe(cls.id);
    expect(sheet.textContent).toContain(`Issued from ${warrant.label}, so it stays in Common, dated between Jan 1, 2024 and Jan 1, 2030.`);
    const date = byLabel(sheet, 'Issue date');
    setValue(date, '2023-06-01');
    sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(document.body.textContent).toContain(`${warrant.label} could be exercised between Jan 1, 2024 and Jan 1, 2030`);
    expect(store.security(cert.id)).toMatchObject({ date: '2025-01-01', classId: cls.id });
    expect(other.id).not.toBe(cls.id);
  });
});

describe('the option sheet and the vesting start', () => {
  it('lets the vesting clock follow a corrected grant date unless a different start was chosen', async () => {
    /* The sheet used to write the grant date into `vestingStart` on every
       save, so the next edit read an explicit start and a mistyped grant
       date corrected there left the clock on the old day - every vested
       figure with it. */
    await save(grantSheet());
    let grant = store.securities.find((s) => s.kind === 'option');
    expect(grant.vestingStart).toBeUndefined();
    let sheet = grantSheet(grant);
    setValue(byLabel(sheet, 'Grant date'), '2025-09-10');
    expect(byLabel(sheet, 'Vesting start').value).toBe('2025-09-10');
    await save(sheet);
    grant = store.security(grant.id);
    expect(grant.grantDate).toBe('2025-09-10');
    expect(grant.vestingStart).toBeUndefined();
    expect(grantVested(grant, '2026-09-10')).toBe(250);
    // A start the user chose is explicit, and stays put when the date moves.
    sheet = grantSheet(grant);
    setValue(byLabel(sheet, 'Vesting start'), '2025-03-10');
    await save(sheet);
    expect(store.security(grant.id).vestingStart).toBe('2025-03-10');
    sheet = grantSheet(store.security(grant.id));
    setValue(byLabel(sheet, 'Grant date'), '2025-06-10');
    expect(byLabel(sheet, 'Vesting start').value).toBe('2025-03-10');
    await save(sheet);
    expect(store.security(grant.id)).toMatchObject({ grantDate: '2025-06-10', vestingStart: '2025-03-10' });
  });
});
