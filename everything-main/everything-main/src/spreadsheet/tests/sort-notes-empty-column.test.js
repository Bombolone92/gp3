import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_ROW } from '../src/core/refs.js';

// A sort moved only the columns and rows the used range covered, and the used range counts values alone: the
// notes of an otherwise empty column inside the sorted range stayed put while their rows moved, and so did a
// fill or a link kept on an empty cell. Notes and formats now move with the row.
it('moves the notes of an otherwise empty column with their rows', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['c', 'e', 'a', 'd', 'b'].forEach((v, r) => { wb.setInput(id, r, 0, v); wb.setNote(id, r, 1, `about ${v}`); });
  wb.clearHistory();
  expect(wb.sortRangeBy(id, { r1: 0, c1: 0, r2: 4, c2: 1 }, [{ col: 0, ascending: true }])).toBe(true);
  expect([0, 1, 2, 3, 4].map((r) => wb.getValue(id, r, 0))).toEqual(['a', 'b', 'c', 'd', 'e']);
  expect([0, 1, 2, 3, 4].map((r) => wb.getNote(id, r, 1))).toEqual(['about a', 'about b', 'about c', 'about d', 'about e']);
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect([0, 1, 2, 3, 4].map((r) => wb.getNote(id, r, 1))).toEqual(['about c', 'about e', 'about a', 'about d', 'about b']);
});

it('moves a fill on an empty cell, and notes below the last value, in a whole-column range', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [3, 1, 2].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  wb.setCells(id, [{ r: 1, c: 1, cell: { v: null, f: null, s: { bg: '#ff0000' } } }]);
  wb.setNote(id, 4, 2, 'below the values');
  expect(wb.sortRangeBy(id, { r1: 0, c1: 0, r2: MAX_ROW, c2: 2 }, [{ col: 0, ascending: false }])).toBe(true);
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual([3, 2, 1]);
  // The fill sat beside the 1 and still does; the note's blank row sorts last and keeps its note.
  expect(wb.getCell(id, 2, 1)?.s?.bg).toBe('#ff0000');
  expect(wb.getCell(id, 1, 1)?.s?.bg ?? null).toBeNull();
  expect([0, 1, 2, 3, 4].map((r) => wb.getNote(id, r, 2))).toEqual([null, null, null, null, 'below the values']);
});

it('moves the notes of a row without values with their columns when sorting left to right', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['3', '1', '2'].forEach((v, c) => wb.setInput(id, 0, c, v));
  wb.setNote(id, 2, 0, 'three');
  wb.setNote(id, 2, 2, 'two');
  expect(wb.sortColumnsBy(id, { r1: 0, c1: 0, r2: 2, c2: 2 }, [{ row: 0, ascending: true }])).toBe(true);
  expect([0, 1, 2].map((c) => wb.getValue(id, 0, c))).toEqual([1, 2, 3]);
  expect([0, 1, 2].map((c) => wb.getNote(id, 2, c))).toEqual([null, 'two', 'three']);
});
