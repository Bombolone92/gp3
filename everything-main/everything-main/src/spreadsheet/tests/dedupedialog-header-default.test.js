// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import * as S from '../src/core/selection.js';
import { openDedupeDialog } from '../src/ui/dedupedialog.js';
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
  const ctx = { wb, sheetId: () => id, active: () => ({ r: range.r1, c: range.c1 }), grid: { focus: vi.fn(), setSelection: vi.fn() } };
  if (selection) ctx.selection = () => selection;
  openDedupeDialog(ctx, range);
  const panel = document.querySelector('.modal-panel');
  const header = panel.querySelector('input[type="checkbox"]');
  const column = (c) => rows.map((_, r) => wb.getValue(id, r, c));
  return { wb, id, header, column, submit: () => panel.querySelector('form').requestSubmit() };
}
const names = [['Bob'], ['Adam'], ['Bob'], ['Carl'], ['Bob']];

// An explicitly selected list of names had "Data has a header row" pre-ticked, so the first entry was
// exempt: one duplicate of it survived while the toast reported duplicates removed. The box now starts
// by the Sort dialog's rule, and the whole selection is compared.
it('starts with the header box off for an explicitly selected list of text, so its first entry counts too', () => {
  const { header, column, submit } = open(names, parseRange('A1:A5'), S.fromRange(parseRange('A1:A5'), { r: 0, c: 0 }));
  expect(header.checked).toBe(false);
  submit();
  expect(column(0)).toEqual(['Bob', 'Adam', 'Carl', null, null]);
  expect(toast).toHaveBeenCalledWith('Removed 2 duplicate rows', expect.objectContaining({ icon: 'dedupe' }));
});

it('keeps an all-text first row as the header of the block read around one cell', () => {
  const { header, column, submit } = open(names, parseRange('A1:A5'), S.single(2, 0));
  expect(header.checked).toBe(true);
  submit();
  expect(column(0)).toEqual(['Bob', 'Adam', 'Bob', 'Carl', null]);
  expect(toast).toHaveBeenCalledWith('Removed 1 duplicate row', expect.objectContaining({ icon: 'dedupe' }));
});

it('still ticks the box for a text row over typed values, however the range was chosen', () => {
  const rows = [['Name', 'Qty'], ['b', 2], ['b', 2], ['c', 3]];
  const { header } = open(rows, parseRange('A1:B4'), S.fromRange(parseRange('A1:B4'), { r: 0, c: 0 }));
  expect(header.checked).toBe(true);
});
