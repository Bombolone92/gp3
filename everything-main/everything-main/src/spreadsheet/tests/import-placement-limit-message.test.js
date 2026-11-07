// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';
import { openImportPlacementDialog, placeImport, placementError } from '../src/ui/importdialog.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

// A pasted or imported block reaches only as far as the grid's paste limits, while a text file
// opens to a million rows: appending to a sheet longer than that simply refused, under a message
// blaming an empty or protected sheet. The refusal now names the limit it hit.

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function source(rows = 3, cols = 1) {
  const other = new Workbook({ sheets: [{ name: 'Data' }] });
  const id = other.activeSheetId;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) other.setInput(id, r, c, `v${r}${c}`);
  return other;
}

function submit(wb, id, other, mode, active = { r: 0, c: 0 }) {
  const ctx = { wb, sheetId: () => id, active: () => active, grid: { focus() {} } };
  const modal = openImportPlacementDialog(ctx, other, 'theirs.csv');
  modal.panel.querySelector(`input[value="${mode}"]`).click();
  modal.panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  return modal.panel.querySelector('[role="alert"]');
}

it('says which limit an appended block would run past on a sheet filled nearly to the last row', () => {
  const wb = new Workbook({ sheets: [{ name: 'Long', rows: MAX_ROWS }] });
  const id = wb.activeSheetId;
  wb.setInput(id, MAX_ROWS - 2, 0, 'last');
  const other = source();
  expect(placeImport(wb, id, other, { mode: 'append', otherSheetId: other.activeSheetId, at: { r: 0, c: 0 } })).toBeNull();
  const alert = submit(wb, id, other, 'append');
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toBe(`An imported block reaches row ${MAX_ROWS.toLocaleString('en-US')} at most, and this one would end at row 1,048,578. Insert it as a new sheet instead.`);
});

it('says the same for a block started at a cell too far down or too far across', () => {
  const wb = new Workbook({ sheets: [{ name: 'S', rows: 30000, cols: 720 }] });
  const id = wb.activeSheetId;
  const other = source();
  expect(submit(wb, id, other, 'cell', { r: MAX_ROWS - 2, c: 0 }).textContent)
    .toContain(`An imported block reaches row ${MAX_ROWS.toLocaleString('en-US')} at most`);
  const wide = source(1, 5);
  expect(submit(wb, id, wide, 'cell', { r: 0, c: MAX_COLS - 2 }).textContent)
    .toContain('An imported block reaches column XFD at most');
});

it('still blames the sheet itself when the block would fit', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setSheetProtected(id, true);
  const other = source();
  expect(submit(wb, id, other, 'cell').textContent)
    .toBe('Nothing to place there: the sheet is empty, protected, or the block would not fit');
  // And an empty source is described the same way, not as a limit.
  expect(placementError(wb, id, new Workbook(), { mode: 'append', otherSheetId: null, at: { r: 0, c: 0 } }))
    .toBe('Nothing to place there: the sheet is empty, protected, or the block would not fit');
});
