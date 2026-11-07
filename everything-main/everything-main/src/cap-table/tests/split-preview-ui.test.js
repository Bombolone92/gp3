import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openSplitForm } from '../src/ui/split.js';
import { store } from '../src/lib/store.js';
import { puterBackend } from './helpers/puter-kv.js';

let dom;
beforeEach(async () => {
  dom = new JSDOM('<div id="app"></div>', { url: 'http://localhost/#/classes', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'location', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'requestAnimationFrame']) {
    vi.stubGlobal(name, dom.window[name]);
  }
  puterBackend().install();
  await store.init();
  const cls = await store.addClass({ name: 'Common Stock', kind: 'common', authorized: 100, pricePerShare: 0.01 });
  const holder = await store.addStakeholder({ name: 'Founder', kind: 'founder' });
  for (let i = 0; i < 20; i += 1) {
    await store.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: cls.id, quantity: 5, pricePerShare: 0.01, date: '2024-01-01' });
  }
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
const type = (input, value) => { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };

describe('the split preview and the authorized count', () => {
  it('names a class that whole-share rounding alone takes past its count', () => {
    openSplitForm();
    const sheet = dialog();
    type(byLabel(sheet, 'New shares'), '1');
    type(byLabel(sheet, 'For every'), '3');
    const warns = [...sheet.querySelectorAll('.field-hint.warn')].map((n) => n.textContent);
    expect(warns.some((t) => t.startsWith('Whole-share rounding adds 7 shares'))).toBe(true);
    expect(warns).toContain('Common Stock will hold 7 more shares than its authorized count after rounding (40 against 33). '
      + 'That is what a charter amendment is for; raise the authorized shares under Share classes once it is signed.');
    // A forward split restates exactly and says nothing of the kind.
    type(byLabel(sheet, 'New shares'), '3');
    type(byLabel(sheet, 'For every'), '1');
    expect([...sheet.querySelectorAll('.field-hint.warn')].some((n) => n.textContent.includes('authorized count'))).toBe(false);
  });
});
