import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function merged() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
  wb.setInput(id, 4, 2, '7');
  wb.setInput(id, 5, 5, '=SUM(A1:B2)');
  return { wb, id };
}

it('pastes one value into a merged cell without filling the cells under it', () => {
  const { wb, id } = merged();
  const cells = wb.copyRange(id, { r1: 4, c1: 2, r2: 4, c2: 2 });
  wb.pasteCells(id, cells, 0, 0, { r: 4, c: 2 }, { r1: 0, c1: 0, r2: 1, c2: 1 });
  expect([wb.getValue(id, 0, 0), wb.getValue(id, 0, 1), wb.getValue(id, 1, 0), wb.getValue(id, 1, 1)]).toEqual([7, null, null, null]);
  expect(wb.getValue(id, 5, 5)).toBe(7);
  expect(wb.sheet(id).merges).toHaveLength(1);
});

it('writes a Ctrl+Enter entry to the top-left of a merged cell only', () => {
  const { wb, id } = merged();
  wb.fillInput(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, '7', { r: 0, c: 0 });
  expect([wb.getValue(id, 0, 0), wb.getValue(id, 0, 1), wb.getValue(id, 1, 0), wb.getValue(id, 1, 1)]).toEqual([7, null, null, null]);
  expect(wb.getValue(id, 5, 5)).toBe(7);
});

it('leaves the cells hidden under a merge empty when the fill handle crosses one', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.mergeCells(id, { r1: 1, c1: 0, r2: 2, c2: 0 });
  wb.setInput(id, 0, 0, '1');
  wb.setInput(id, 1, 0, '2');
  wb.setInput(id, 7, 0, '=SUM(A1:A6)');
  wb.fill(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 5, c2: 0 });
  expect(wb.getCell(id, 2, 0)).toBeUndefined();
  expect([wb.getValue(id, 3, 0), wb.getValue(id, 4, 0), wb.getValue(id, 5, 0)]).toEqual([4, 5, 6]);
  expect(wb.getValue(id, 7, 0)).toBe(18);
  wb.unmergeCells(id, { r1: 1, c1: 0, r2: 2, c2: 0 });
  expect(wb.getValue(id, 2, 0)).toBeNull();
});

it('applies paste arithmetic to a merged cell once, at its top-left', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.mergeCells(id, { r1: 0, c1: 1, r2: 1, c2: 1 });
  wb.setInput(id, 0, 1, '10');
  wb.setInput(id, 5, 5, '=SUM(B1:B2)');
  expect(wb.pasteOperation(id, [[1], [1]], 0, 1, 'add')).toBe(1);
  expect(wb.getValue(id, 0, 1)).toBe(11);
  expect(wb.getCell(id, 1, 1)).toBeUndefined();
  expect(wb.getValue(id, 5, 5)).toBe(11);
});

it('skips cells hidden under a merge when a paste overlaps one', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.mergeCells(id, { r1: 1, c1: 2, r2: 1, c2: 3 });
  wb.pasteValues(id, [['a'], ['b'], ['c']], 0, 3);
  expect([wb.getValue(id, 0, 3), wb.getValue(id, 1, 3), wb.getValue(id, 2, 3)]).toEqual(['a', null, 'c']);
  wb.pasteLiteralValues(id, [[1], [2], [3]], 0, 3);
  expect([wb.getValue(id, 0, 3), wb.getValue(id, 1, 3), wb.getValue(id, 2, 3)]).toEqual([1, null, 3]);
  wb.pasteCells(id, [[{ v: 'x' }], [{ v: 'y' }], [{ v: 'z' }]], 0, 3, null, null, { transpose: false });
  expect(wb.getValue(id, 1, 3)).toBe(null);
  expect(wb.sheet(id).merges).toEqual([{ r1: 1, c1: 2, r2: 1, c2: 3 }]);
});
