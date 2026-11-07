// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import * as S from '../src/core/selection.js';
import { openSortDialog, looksLikeHeader } from '../src/ui/sortdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
  toast.mockClear();
});
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function open(rows, range, selection) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  rows.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  const ctx = { wb, sheetId: () => id, active: () => ({ r: range.r1, c: range.c1 }), grid: { focus: vi.fn() } };
  if (selection) ctx.selection = () => selection;
  const { panel } = openSortDialog(ctx, range);
  const header = panel.querySelector('input[type="checkbox"]');
  const column = (c) => rows.map((_, r) => wb.getValue(id, r, c));
  return { wb, id, panel, header, column, submit: () => panel.querySelector('form').requestSubmit() };
}
const names = [['Zoe'], ['Adam'], ['Bob'], ['Carl'], ['Dan']];

// An explicitly selected list of text had its first entry pre-ticked as a header, so Sort kept
// Zoe above Adam, while the toolbar sort of the same selection sorted the whole list.
it('starts with the header box off for an explicitly selected block of text, so it sorts whole as the quick sort does', () => {
  const { header, column, submit } = open(names, parseRange('A1:A5'), S.fromRange(parseRange('A1:A5'), { r: 0, c: 0 }));
  expect(header.checked).toBe(false);
  submit();
  expect(column(0)).toEqual(['Adam', 'Bob', 'Carl', 'Dan', 'Zoe']);
  expect(toast).toHaveBeenCalledWith('Sorted A1:A5');
});

it('keeps an all-text first row as the header of the block read around one cell, or of whole columns', () => {
  const fromCell = open(names, parseRange('A1:A5'), S.single(2, 0));
  expect(fromCell.header.checked).toBe(true);
  fromCell.submit();
  expect(fromCell.column(0)).toEqual(['Zoe', 'Adam', 'Bob', 'Carl', 'Dan']);
  closeAllModals(); vi.runAllTimers(); document.body.replaceChildren(); document.body.innerHTML = '<div id="app"></div>';
  const wholeColumn = open(names, { r1: 0, c1: 0, r2: 99, c2: 0 }, S.fromRange({ r1: 0, c1: 0, r2: 99, c2: 0 }, { r: 0, c: 0 }));
  expect(wholeColumn.header.checked).toBe(true);
});

it('still ticks the header box for a text row over typed values, however the range was chosen', () => {
  const rows = [['Name', 'Qty'], ['b', 2], ['a', 1], ['c', 3]];
  const explicit = open(rows, parseRange('A1:B4'), S.fromRange(parseRange('A1:B4'), { r: 0, c: 0 }));
  expect(explicit.header.checked).toBe(true);
  explicit.submit();
  expect(explicit.column(0)).toEqual(['Name', 'a', 'b', 'c']);
  closeAllModals(); vi.runAllTimers(); document.body.replaceChildren(); document.body.innerHTML = '<div id="app"></div>';
  const bare = open(rows, parseRange('A1:B4'));
  expect(bare.header.checked).toBe(true);
});

// The other callers of looksLikeHeader (Create table, Subtotals, banding) keep reading an all-text head as a header.
it('leaves looksLikeHeader itself unchanged', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  names.forEach(([v], r) => wb.setInput(id, r, 0, v));
  expect(looksLikeHeader(wb, id, parseRange('A1:A5'))).toBe(true);
});
