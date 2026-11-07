import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('does not confuse cell contents with the separator between columns', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 'a\u0001b' } }, { r: 0, c: 1, cell: { v: 'c' } },
    { r: 1, c: 0, cell: { v: 'a' } }, { r: 1, c: 1, cell: { v: 'b\u0001c' } },
    { r: 2, c: 0, cell: { v: 'A' } }, { r: 2, c: 1, cell: { v: 'B\u0001C' } },
  ]);
  const before = wb.toJSON();
  wb.clearHistory();
  expect(wb.removeDuplicates(id, { r1: 0, c1: 0, r2: 2, c2: 1 })).toBe(1);
  expect(wb.getValue(id, 1, 1)).toBe('b\u0001c');
  expect(wb.getValue(id, 2, 1)).toBeNull();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  wb.redo();
  expect(wb.getValue(id, 1, 1)).toBe('b\u0001c');
});
