import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('keeps notes with their rows when sorting', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['c', 'a', 'b'].forEach((v, r) => wb.setInput(id, r, 0, v));
  wb.setNote(id, 0, 0, 'about c');
  wb.setNote(id, 2, 0, 'about b');
  wb.clearHistory();
  wb.sortRangeBy(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, [{ col: 0, ascending: true }]);
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 0))).toEqual(['a', 'b', 'c']);
  expect([0, 1, 2].map((r) => wb.getNote(id, r, 0) || null)).toEqual([null, 'about b', 'about c']);
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect([0, 1, 2].map((r) => wb.getNote(id, r, 0) || null)).toEqual(['about c', null, 'about b']);
});

it('keeps notes with their columns when sorting left to right', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['3', '1', '2'].forEach((v, c) => wb.setInput(id, 0, c, v));
  wb.setNote(id, 0, 0, 'three');
  wb.sortColumnsBy(id, { r1: 0, c1: 0, r2: 0, c2: 2 }, [{ row: 0, ascending: true }]);
  expect([0, 1, 2].map((c) => wb.getValue(id, 0, c))).toEqual([1, 2, 3]);
  expect([0, 1, 2].map((c) => wb.getNote(id, 0, c) || null)).toEqual([null, null, 'three']);
});
