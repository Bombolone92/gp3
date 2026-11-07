// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openSubtotalDialog } from '../src/ui/subtotaldialog.js';
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('keeps the group column, which holds the labels, out of the columns to total', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Region', 'Item', 'Sales'], ['West', 'Pens', 10], ['East', 'Ink', 5]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  openSubtotalDialog({ wb, sheetId: () => id, grid: { focus: vi.fn(), setSelection: vi.fn() } }, { r1: 0, c1: 0, r2: 2, c2: 2 });
  const box = (c) => document.querySelector(`input[data-col="${c}"]`);
  const groupSel = document.querySelector('select[aria-label="At each change in"]');
  expect(groupSel.value).toBe('0');
  expect([box(0).disabled, box(0).checked]).toEqual([true, false]);
  expect([box(2).disabled, box(2).checked]).toEqual([false, true]);
  groupSel.value = '2';
  groupSel.dispatchEvent(new Event('change'));
  expect([box(2).disabled, box(2).checked]).toEqual([true, false]);
  expect(box(0).disabled).toBe(false);
});
