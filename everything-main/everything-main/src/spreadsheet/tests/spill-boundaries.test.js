import { expect, it } from 'vitest';
import { Workbook, MAX_ROWS, MAX_COLS } from '../src/core/workbook.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';

it.each([
  [MAX_ROWS - 1, 0, '=SEQUENCE(2)'],
  [0, MAX_COLS - 1, '=SEQUENCE(1,2)'],
  [MAX_ROWS - 3, 1, '=SEQUENCE(4,2)'],
  [0, 1, `=SEQUENCE(1,${MAX_COLS})`],
])('reports an unplaceable spill at row %i column %i instead of returning partial data', (r, c, f) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, r, c, f);
  expect(wb.getValue(id, r, c)).toEqual({ error: '#SPILL!' });
  expect(wb.spillRangeAt(id, r, c)).toBeNull();
  expect(wb.spillEntries(id)).toEqual([]);
});

it.each([
  [MAX_ROWS - 2, 0, '=SEQUENCE(2)', { r1: MAX_ROWS - 2, c1: 0, r2: MAX_ROWS - 1, c2: 0 }],
  [0, MAX_COLS - 2, '=SEQUENCE(1,2)', { r1: 0, c1: MAX_COLS - 2, r2: 0, c2: MAX_COLS - 1 }],
])('allows a spill that fits exactly at row %i column %i and recovers through undo', (r, c, f, range) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, r, c, f);
  expect(wb.spillRangeAt(id, r, c)).toEqual(range);
  expect(wb.getValue(id, range.r2, range.c2)).toBe(2);
  wb.setInput(id, r, c, f.replace('2', '3'));
  expect(wb.getValue(id, r, c)).toEqual({ error: '#SPILL!' });
  expect(wb.spillEntries(id)).toEqual([]);
  wb.undo();
  expect(wb.getValue(id, range.r2, range.c2)).toBe(2);
  wb.redo();
  expect(wb.getValue(id, r, c)).toEqual({ error: '#SPILL!' });
});

it.each([
  [30001, 800, 29999, 799, '=SEQUENCE(2)', { r1: 29999, c1: 799, r2: 30000, c2: 799 }],
  [30001, 800, 30000, 798, '=SEQUENCE(1,2)', { r1: 30000, c1: 798, r2: 30000, c2: 799 }],
  [MAX_ROW + 1, MAX_COL + 1, MAX_ROW - 1, MAX_COL, '=SEQUENCE(2)', { r1: MAX_ROW - 1, c1: MAX_COL, r2: MAX_ROW, c2: MAX_COL }],
])('uses existing imported dimensions %i by %i for a spill at %i,%i', (rows, cols, r, c, f, range) => {
  const wb = new Workbook({ sheets: [{ name: 'Imported', rows, cols }] });
  const id = wb.activeSheetId;
  wb.setInput(id, r, c, f);
  expect(wb.getValue(id, range.r2, range.c2)).toBe(2);
  expect(wb.spillRangeAt(id, r, c)).toEqual(range);
  expect(wb.activeSheet.rows).toBe(rows);
  expect(wb.activeSheet.cols).toBe(cols);
});

it('checks blockers in the portion of a spill beyond the ordinary scrolling limit', () => {
  const wb = new Workbook({ sheets: [{ name: 'Imported', rows: 30001, cols: 800 }] });
  const id = wb.activeSheetId;
  wb.setInput(id, 19999, 0, '=SEQUENCE(2)');
  wb.setInput(id, 20000, 0, 'Keep');
  expect(wb.getValue(id, 19999, 0)).toEqual({ error: '#SPILL!' });
  expect(wb.getValue(id, 20000, 0)).toBe('Keep');
  wb.setInput(id, 20000, 0, '');
  expect(wb.getValue(id, 20000, 0)).toBe(2);
});

it('keeps larger arrays usable as intermediate formula results', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SUM(SEQUENCE(20001))');
  expect(wb.getValue(id, 0, 0)).toBe(20001 * 20002 / 2);
});
