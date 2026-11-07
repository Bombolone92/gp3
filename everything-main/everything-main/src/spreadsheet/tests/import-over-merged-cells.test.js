// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { placeImport } from '../src/ui/importdialog.js';

// A merged block in the destination hid the imported cells that landed under it: the paste
// skips cells covered by a merge, so 6, 8 and 9 of a 3×3 block over a B2:C3 merge were gone
// while the dialog reported success. An import replaces the block it lands on, so the merges
// under it are split first, in the same undo step, and every value arrives.

function block() {
  const other = new Workbook();
  const id = other.activeSheetId;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) other.setInput(id, r, c, String(r * 3 + c + 1));
  return other;
}
const grid = (wb, id, r0, c0) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => wb.getValue(id, r0 + r, c0 + c)));
const FULL = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];

it('splits a destination merge under the imported block and places every value', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.mergeCells(id, { r1: 1, c1: 1, r2: 2, c2: 2 });
  wb.mergeCells(id, { r1: 5, c1: 0, r2: 5, c2: 2 }); // untouched: outside the block
  wb.clearHistory();
  const before = wb.toJSON();
  expect(placeImport(wb, id, block(), { mode: 'cell', otherSheetId: block().activeSheetId, at: { r: 0, c: 0 } })).toBe('Imported 3 rows at A1');
  expect(grid(wb, id, 0, 0)).toEqual(FULL);
  expect(wb.sheet(id).merges).toEqual([{ r1: 5, c1: 0, r2: 5, c2: 2 }]);
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(grid(wb, id, 0, 0)).toEqual(FULL);
  expect(wb.sheet(id).merges).toEqual([{ r1: 5, c1: 0, r2: 5, c2: 2 }]);
});

it('splits a merge the block only partly covers, keeping the value at its top-left', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 2, 2, 'Title');
  wb.mergeCells(id, { r1: 2, c1: 2, r2: 3, c2: 4 });
  const other = block();
  expect(placeImport(wb, id, other, { mode: 'cell', otherSheetId: other.activeSheetId, at: { r: 0, c: 0 } })).toBe('Imported 3 rows at A1');
  expect(grid(wb, id, 0, 0)).toEqual(FULL);
  expect(wb.sheet(id).merges).toEqual([]);
  expect(wb.getValue(id, 3, 3)).toBeNull();
});

it('splits a merge sitting in the empty rows an append lands on', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Existing');
  wb.mergeCells(id, { r1: 1, c1: 0, r2: 3, c2: 1 });
  const other = block();
  expect(placeImport(wb, id, other, { mode: 'append', otherSheetId: other.activeSheetId })).toBe('Appended 3 rows after row 1');
  expect(grid(wb, id, 1, 0)).toEqual(FULL);
  expect(wb.sheet(id).merges).toEqual([]);
  expect(wb.getValue(id, 0, 0)).toBe('Existing');
});
