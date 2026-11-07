import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openWarrantActions } from '../src/ui/warrantactions.js';
import { openCancelForm, openExerciseForm, openSettleForm } from '../src/ui/grantactions.js';
import { openSecurityForm } from '../src/ui/securityform.js';
import { openTransferForm } from '../src/ui/transfer.js';
import { store } from '../src/lib/store.js';
import { puterBackend } from './helpers/puter-kv.js';

let dom;
let holder;
let cls;
beforeEach(async () => {
  dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/#/securities', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'location', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'requestAnimationFrame']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  puterBackend().install();
  await store.init();
  cls = await store.addClass({ name: 'Common', kind: 'common' });
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
const dialog = () => [...document.querySelectorAll('.modal-root')].at(-1);
const byLabel = (root, label) => {
  const l = [...root.querySelectorAll('.field-label')].find((x) => x.textContent.trim() === label);
  return l ? document.getElementById(l.htmlFor) : null;
};
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();

describe('one of a thing reads in the singular', () => {
  it('on the warrant sheet', async () => {
    const warrant = await store.addSecurity({ kind: 'warrant', stakeholderId: holder.id, classId: cls.id, quantity: 1, strike: 1, date: '2024-01-01' });
    openWarrantActions(store.security(warrant.id));
    const sheet = dialog();
    expect(text(sheet)).toContain('1 right outstanding today.');
    const qty = byLabel(sheet, 'Warrant shares');
    qty.value = '2';
    sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    expect(qty.getAttribute('aria-invalid')).toBe('true');
    expect(text(sheet)).toContain('Only 1 share is left to record');
  });

  it('on the cancel sheet', async () => {
    const grant = await store.addSecurity({ kind: 'option', stakeholderId: holder.id, quantity: 500, strike: 1,
      grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 12 });
    openCancelForm(store.security(grant.id));
    const sheet = dialog();
    const qty = byLabel(sheet, 'Options cancelled');
    qty.value = '1';
    qty.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(text(sheet)).toMatch(/1 option .*; 499 stay outstanding\./);
    qty.value = '499';
    qty.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(text(sheet)).toMatch(/499 options .*; 1 stays outstanding\./);
  });
});

describe('a count that does not read is a typo, not a blank', () => {
  const submit = (sheet) => sheet.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  const toasts = () => [...document.querySelectorAll('.toast')].map((n) => n.textContent).join(' || ');

  it('on the issue, transfer, exercise and settle sheets', async () => {
    openSecurityForm({ kind: 'shares' });
    let sheet = dialog();
    const stakeholder = byLabel(sheet, 'Stakeholder');
    stakeholder.value = holder.id;
    stakeholder.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const qty = byLabel(sheet, 'Number of shares');
    qty.value = '1e6';
    submit(sheet);
    expect(qty.getAttribute('aria-invalid')).toBe('true');
    expect(toasts()).toContain('The share count must be a number, like 1,000,000');
    sheet.querySelector('button[aria-label="Close"]').click();

    const cert = await store.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: cls.id, quantity: 1000, pricePerShare: 1, date: '2024-01-01' });
    openTransferForm(cert);
    sheet = dialog();
    const moved = byLabel(sheet, 'Shares transferred');
    moved.value = '10k';
    submit(sheet);
    expect(moved.getAttribute('aria-invalid')).toBe('true');
    expect(toasts()).toContain('The share count must be a number, like 1,000');
    sheet.querySelector('button[aria-label="Close"]').click();

    const grant = await store.addSecurity({ kind: 'option', stakeholderId: holder.id, quantity: 500, strike: 1, grantDate: '2024-01-01', vestingMonths: 0, cliffMonths: 0 });
    openExerciseForm(store.security(grant.id));
    sheet = dialog();
    const exercised = byLabel(sheet, 'Options exercised');
    exercised.value = '1.000,5';
    submit(sheet);
    expect(exercised.getAttribute('aria-invalid')).toBe('true');
    expect(toasts()).toContain('The option count must be a number, like 1,000');
    sheet.querySelector('button[aria-label="Close"]').click();

    const award = await store.addSecurity({ kind: 'rsu', stakeholderId: holder.id, classId: cls.id, quantity: 500, grantDate: '2024-01-01', vestingMonths: 0, cliffMonths: 0 });
    openSettleForm(store.security(award.id));
    sheet = dialog();
    const settled = byLabel(sheet, 'Units settled');
    settled.value = 'ten';
    submit(sheet);
    expect(settled.getAttribute('aria-invalid')).toBe('true');
    expect(toasts()).toContain('The unit count must be a number, like 1,000');
    // A blank box still gets the blank-box answer.
    settled.value = '';
    submit(sheet);
    expect(toasts()).toContain('Enter how many units settled');
  });
});
