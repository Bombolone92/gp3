// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openDedupeDialog } from '../src/ui/dedupedialog.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('compares every selected column by default, including columns beyond BI', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 2, c2: 61 };
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 1 } }, { r: 0, c: 61, cell: { v: 'first' } },
    { r: 1, c: 0, cell: { v: 1 } }, { r: 1, c: 61, cell: { v: 'second' } },
    { r: 2, c: 0, cell: { v: 1 } }, { r: 2, c: 61, cell: { v: 'second' } },
  ]);
  const before = wb.toJSON();
  wb.clearHistory();
  openDedupeDialog({ wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), grid: { focus() {}, setSelection() {} } }, range);
  const panel = document.querySelector('.modal-panel');
  panel.querySelector('form').requestSubmit();
  expect(wb.getValue(id, 0, 61)).toBe('first');
  expect(wb.getValue(id, 1, 61)).toBe('second');
  expect(wb.getValue(id, 2, 61)).toBeNull();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.getValue(id, 1, 61)).toBe('second');
});
