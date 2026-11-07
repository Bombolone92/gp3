// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';
import * as P from '../src/lib/puter.js';
import { openPivotDialog } from '../src/ui/pivotdialog.js';
import { openPrintDialog } from '../src/ui/printdialog.js';
import { openTextBoxDialog } from '../src/ui/textboxdialog.js';
import { openCopySheetDialog } from '../src/ui/copysheet.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it.each([
  ['pivot', openPivotDialog], ['print', openPrintDialog], ['text box', openTextBoxDialog],
  ['copy sheet', (ctx) => openCopySheetDialog(ctx, ctx.sheetId())],
])('keeps invalid cell input focused before opening the %s dialog', async (_, open) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 1, c2: 1 };
  wb.setCells(id, [['Category', 'Amount'], ['A', 1]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const input = document.createElement('textarea');
  input.value = 'Invalid edit';
  document.querySelector('#app').append(input);
  input.focus();
  const commitEdit = vi.fn(() => { input.focus(); return false; });
  const ctx = { wb, sheetId: () => id, range: () => range, selection: () => S.fromRange(range), active: () => ({ r: 0, c: 0 }), grid: { editing: true, commitEdit, focus() {} } };
  const before = wb.toJSON();
  open(ctx);
  await vi.advanceTimersByTimeAsync(1);
  expect(commitEdit).toHaveBeenCalledOnce();
  expect(document.querySelector('.modal-panel')).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('Invalid edit');
  expect(wb.toJSON()).toEqual(before);
  commitEdit.mockReturnValue(true);
  open(ctx);
  expect(document.querySelector('.modal-panel')).not.toBeNull();
});
