import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each(['range', 'indices'])('copies unanchored spill results through %s with their effective formats', (kind) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(3,2,1.23456,0.5)');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'custom', code: '0.000', bold: true });
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { fmt: 'currency', dec: 1, bg: '#00ff00' });
  const cells = kind === 'range' ? wb.copyRange(id, { r1: 1, c1: 0, r2: 2, c2: 1 }) : wb.copyCells(id, [1, 2], [0, 1]);
  expect(cells.map((row) => row.map((cell) => cell?.v))).toEqual([[2.23456, 2.73456], [3.23456, 3.73456]]);
  wb.setInput(id, 0, 0, '=SEQUENCE(3,2,99)');
  wb.clearHistory();
  wb.pasteCells(id, cells, 0, 3, { r: 1, c: 0 });
  expect(wb.getValue(id, 0, 3)).toBe(2.23456);
  expect(wb.getDisplay(id, 0, 4)).toBe('2.735');
  expect(wb.getCell(id, 0, 3)).toMatchObject({ f: null, s: { fmt: 'currency', dec: 1, bg: '#00ff00' } });
  expect(wb.getCell(id, 0, 4).s.bold).toBeUndefined();
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo(); expect(wb.getValue(id, 0, 3)).toBeNull();
  wb.redo(); expect(wb.getValue(id, 1, 4)).toBe(3.73456);
});

it.each(['range', 'indices'])('retains the array formula and empty spill slots when %s includes its anchor', (kind) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(3)');
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bold: true });
  const cells = kind === 'range' ? wb.copyRange(id, { r1: 0, c1: 0, r2: 2, c2: 0 }) : wb.copyCells(id, [0, 1, 2], [0]);
  expect(cells[0][0].f).toBe('SEQUENCE(3)');
  expect(cells[1][0]).toEqual({ v: null, f: null, s: { bold: true } });
  expect(cells[2][0]).toBeNull();
  wb.pasteCells(id, cells, 0, 3, { r: 0, c: 0 });
  expect([0, 1, 2].map((r) => wb.getValue(id, r, 3))).toEqual([1, 2, 3]);
  expect(wb.getCell(id, 0, 3).f).toBe('SEQUENCE(3)');
});

it('copies separated spill indices with an omitted anchor as exact literal values', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '={"Header";"00123";"=1+2";#N/A;TRUE}');
  const cells = wb.copyCells(id, [1, 2, 3, 4], [0]);
  wb.pasteCells(id, cells, 0, 2, { r: 1, c: 0 });
  expect([0, 1, 2, 3].map((r) => wb.getValue(id, r, 2))).toEqual(['00123', '=1+2', { error: '#N/A' }, true]);
  expect(cells.every((row) => row[0].f === null)).toBe(true);
});
