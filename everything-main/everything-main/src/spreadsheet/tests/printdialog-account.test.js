// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { setStorageUser } from '../src/lib/account-storage.js';
import { openPrintDialog } from '../src/ui/printdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as S from '../src/core/selection.js';

vi.mock('../src/ui/print.js', async (original) => ({ ...await original(), printSheet: vi.fn(() => true) }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const data = new Map();
  vi.stubGlobal('localStorage', { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps remembered print headers and footers private to the account that entered them', async () => {
  const wb = new Workbook();
  const ctx = { wb, sheetId: () => wb.activeSheetId, selection: () => S.single(0, 0), range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), grid: { focus() {} } };
  setStorageUser({ uuid: 'alice' });
  openPrintDialog(ctx);
  for (const [label, text] of [['Header text', 'Confidential Alice report'], ['Footer text', 'Alice private address']]) {
    const input = document.querySelector(`[aria-label="${label}"]`);
    input.value = text;
    input.dispatchEvent(new Event('input'));
  }
  document.querySelector('.modal-panel form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.runOnlyPendingTimersAsync();
  setStorageUser({ uuid: 'bob' });
  openPrintDialog(ctx);
  expect(document.querySelector('[aria-label="Header text"]').value).toBe('');
  expect(document.querySelector('[aria-label="Footer text"]').value).toBe('');
  closeAllModals();
  await vi.runOnlyPendingTimersAsync();
  setStorageUser({ uuid: 'alice' });
  openPrintDialog(ctx);
  expect(document.querySelector('[aria-label="Header text"]').value).toBe('Confidential Alice report');
  expect(document.querySelector('[aria-label="Footer text"]').value).toBe('Alice private address');
});
