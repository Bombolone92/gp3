import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openTransferForm } from '../src/ui/transfer.js';
import { openExerciseForm, openCertifyForm } from '../src/ui/grantactions.js';
import { openStakeholderForm } from '../src/ui/stakeholderform.js';
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
const warnings = (sheet) => [...sheet.querySelectorAll('.field-hint.warn')];

describe('warnings that appear as the user types are live regions', () => {
  it('on the transfer sheet, the exercise and certify sheets, and the stakeholder sheet', async () => {
    const cert = await store.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: cls.id, quantity: 1000, pricePerShare: 1,
      date: '2024-01-01', vestingMonths: 48, cliffMonths: 12 });
    openTransferForm(cert);
    expect(warnings(dialog()).map((n) => n.getAttribute('role'))).toContain('status');
    dialog().querySelector('button[aria-label="Close"]').click();

    const grant = await store.addSecurity({ kind: 'option', stakeholderId: holder.id, quantity: 1000, strike: 1,
      grantDate: '2024-01-01', vestingMonths: 48, cliffMonths: 12, earlyExercise: true });
    openExerciseForm(store.security(grant.id));
    expect(warnings(dialog()).every((n) => n.getAttribute('role') === 'status')).toBe(true);
    dialog().querySelector('button[aria-label="Close"]').click();
    await store.exerciseOption(grant.id, { quantity: 100, date: '2025-06-01' });
    openCertifyForm(store.security(grant.id));
    expect(warnings(dialog()).every((n) => n.getAttribute('role') === 'status')).toBe(true);
    dialog().querySelector('button[aria-label="Close"]').click();

    openStakeholderForm();
    const name = byLabel(dialog(), 'Name');
    const twin = warnings(dialog())[0];
    expect(twin.getAttribute('role')).toBe('status');
    expect(name.getAttribute('aria-describedby')).toBe(twin.id);
    name.value = 'nova';
    name.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    expect(twin.hidden).toBe(false);
    expect(twin.textContent).toContain('Nova is already on the cap table');
  });
});
