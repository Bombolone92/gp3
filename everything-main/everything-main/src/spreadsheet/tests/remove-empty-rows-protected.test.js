import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Remove empty rows counted every blank row it found, though a row holding a
// protected cell is not deleted; "Removed 2 empty rows" followed the removal of
// one. Rows a protected range keeps are left out of the count, and the others
// still go.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (const [r, v] of [[0, 1], [2, 3], [5, 6]]) wb.setInput(id, r, 0, String(v));
  const refusals = [];
  wb.addEventListener('change', (e) => { if (e.detail?.type === 'protected') refusals.push(e.detail.range); });
  return { wb, id, refusals };
}
const column = (wb, id) => [0, 1, 2, 3, 4, 5].map((r) => wb.getValue(id, r, 0));

it('counts only the empty rows that were removed when a protected range keeps one', () => {
  const { wb, id, refusals } = book();
  wb.protectRange(id, parseRange('B4'));
  expect(wb.removeEmptyRows(id, parseRange('A1:A6'))).toBe(2);
  expect(column(wb, id)).toEqual([1, 3, null, 6, null, null]);
  expect(wb.sheet(id).protectedRanges[0].range).toEqual(parseRange('B3'));
  expect(refusals).toEqual([parseRange('B4')]);
  expect(wb.undoLabel()).toBe('Remove empty rows');
  wb.undo();
  expect(column(wb, id)).toEqual([1, null, 3, null, null, 6]);
});

it('reports nothing removed when every empty row is protected', () => {
  const { wb, id } = book();
  wb.protectRange(id, parseRange('A2:C5'));
  wb.clearHistory();
  expect(wb.removeEmptyRows(id, parseRange('A1:A6'))).toBe(0);
  expect(column(wb, id)).toEqual([1, null, 3, null, null, 6]);
  expect(wb.canUndo()).toBe(false);
});
