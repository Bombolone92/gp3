import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openSecurityForm } from '../src/ui/securityform.js';
import { openExerciseForm, openCertifyForm, openSettleForm } from '../src/ui/grantactions.js';
import { openWarrantActions } from '../src/ui/warrantactions.js';
import { authorizedOverrun } from '../src/lib/captable.js';
import { store } from '../src/lib/store.js';
import { puterBackend } from './helpers/puter-kv.js';

let dom;
let common;
let holder;
beforeEach(async () => {
  dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/#/securities', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'location', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'requestAnimationFrame']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  puterBackend().install();
  await store.init();
  common = await store.addClass({ name: 'Common Stock', kind: 'common', authorized: 1000, pricePerShare: 0.01 });
  holder = await store.addStakeholder({ name: 'Nova', kind: 'employee' });
  await store.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: common.id, quantity: 900, pricePerShare: 0.01, date: '2024-01-01' });
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
const type = (input, value) => {
  input.value = value;
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};
const warning = (sheet) => [...sheet.querySelectorAll('.field-hint.warn[role="status"]')]
  .find((n) => n.textContent.includes('authorized count'));
const shown = (sheet) => {
  const w = warning(sheet);
  return w && w.style.display !== 'none' ? w.textContent : '';
};

describe('authorizedOverrun', () => {
  it('measures the class against its authorized count, leaving out the certificate being edited', () => {
    expect(authorizedOverrun(store.db, common.id, 100)).toMatchObject({ issued: 900, authorized: 1000, over: 0 });
    expect(authorizedOverrun(store.db, common.id, 101).over).toBe(1);
    const cert = store.securities.find((s) => s.kind === 'shares');
    expect(authorizedOverrun(store.db, common.id, 1000, { excluding: cert.id }).over).toBe(0);
    expect(authorizedOverrun(store.db, 'nope', 5)).toBeNull();
  });

  it('is null for a class with no authorized count on file', async () => {
    const open = await store.addClass({ name: 'Open', kind: 'common' });
    expect(authorizedOverrun(store.db, open.id, 1e9)).toBeNull();
  });
});

describe('the sheets that issue shares warn past the authorized count', () => {
  it('on the issue sheet, as the quantity and class move, and not for a settled certificate', async () => {
    openSecurityForm({ kind: 'shares' });
    const sheet = dialog();
    type(byLabel(sheet, 'Number of shares'), '100');
    expect(shown(sheet)).toBe('');
    type(byLabel(sheet, 'Number of shares'), '250');
    expect(shown(sheet)).toContain('Common Stock would hold 150 more shares than its authorized count of 1,000');
    expect(shown(sheet)).toContain('raise the authorized shares under Share classes');
    const preferred = await store.addClass({ name: 'Series A', kind: 'preferred', authorized: 300, pricePerShare: 1 });
    sheet.querySelector('button[aria-label="Close"]').click();
    openSecurityForm({ kind: 'shares' });
    const next = dialog();
    type(byLabel(next, 'Number of shares'), '300');
    expect(shown(next)).toContain('Common Stock would hold 200 more shares');
    type(byLabel(next, 'Share class'), preferred.id);
    expect(shown(next)).toBe('');
    type(byLabel(next, 'Number of shares'), '301');
    expect(shown(next)).toContain('Series A would hold 1 more share than its authorized count of 300');
    next.querySelector('button[aria-label="Close"]').click();
    // Editing the existing certificate up to the count leaves the class exactly full.
    const cert = store.securities.find((s) => s.kind === 'shares');
    openSecurityForm({ existing: cert });
    const edit = dialog();
    type(byLabel(edit, 'Number of shares'), '1000');
    expect(shown(edit)).toBe('');
    type(byLabel(edit, 'Number of shares'), '1001');
    expect(shown(edit)).toContain('1 more share');
    edit.querySelector('button[aria-label="Close"]').click();
    // A transfer leg is locked in size and class, so nothing is said ahead of its save.
    await store.transferShares(cert.id, { date: '2025-01-01', quantity: 200, to: { newHolder: { name: 'Buyer', kind: 'investor' } } });
    await store.updateClass(common.id, { authorized: 500 });
    openSecurityForm({ existing: store.securities.find((s) => s.fromTransferId) });
    expect(warning(dialog())).toBeUndefined();
  });

  it('on the exercise, certificate and settlement sheets', async () => {
    const grant = await store.addSecurity({ kind: 'option', stakeholderId: holder.id, quantity: 500, strike: 0.01,
      grantDate: '2024-01-01', vestingMonths: 0, cliffMonths: 0 });
    openExerciseForm(store.security(grant.id));
    let sheet = dialog();
    type(byLabel(sheet, 'Options exercised'), '150');
    expect(shown(sheet)).toContain('Common Stock would hold 50 more shares');
    type(byLabel(sheet, 'Options exercised'), '100');
    expect(shown(sheet)).toBe('');
    type(byLabel(sheet, 'Options exercised'), '150');
    // Nothing is issued when the certificate box is unticked, so nothing is over.
    const issue = sheet.querySelector('input[type="checkbox"]');
    issue.checked = false;
    issue.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    expect(shown(sheet)).toBe('');
    sheet.querySelector('button[aria-label="Close"]').click();

    await store.exerciseOption(grant.id, { quantity: 200, date: '2025-01-01' });
    openCertifyForm(store.security(grant.id));
    sheet = dialog();
    expect(shown(sheet)).toContain('Common Stock would hold 100 more shares');
    sheet.querySelector('button[aria-label="Close"]').click();

    const award = await store.addSecurity({ kind: 'rsu', stakeholderId: holder.id, classId: common.id, quantity: 300,
      grantDate: '2024-01-01', vestingMonths: 0, cliffMonths: 0 });
    openSettleForm(store.security(award.id));
    sheet = dialog();
    expect(shown(sheet)).toContain('Common Stock would hold 200 more shares');
    type(byLabel(sheet, 'Units settled'), '100');
    expect(shown(sheet)).toBe('');
  });

  it('on the warrant sheet, only for an exercise', async () => {
    const warrant = await store.addSecurity({ kind: 'warrant', stakeholderId: holder.id, classId: common.id, quantity: 400, strike: 1,
      date: '2024-01-01', expires: '2030-01-01' });
    openWarrantActions(store.security(warrant.id));
    const sheet = dialog();
    expect(shown(sheet)).toContain('Common Stock would hold 300 more shares than its authorized count of 1,000');
    type(byLabel(sheet, 'Action'), 'cancel');
    expect(shown(sheet)).toBe('');
    type(byLabel(sheet, 'Action'), 'exercise');
    type(byLabel(sheet, 'Warrant shares'), '50');
    expect(shown(sheet)).toBe('');
  });
});
