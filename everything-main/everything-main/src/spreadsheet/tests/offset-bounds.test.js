import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each([
  'A1,1048576,0', 'A1,0,16384', 'A1,0,0,1048577,1', 'A1,0,0,1,16385',
  'A1,1048575,0,2,1', 'A1,0,16383,1,2', 'A1:A2,1048575,0', 'A1:B1,0,16383',
  'A1,1E100,0', 'A1,0,1E100', 'A1,0,0,1E100,1', 'A1,0,0,1,1E100',
])('rejects the out-of-grid result of OFFSET(%s)', (args) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '7');
  wb.setInput(id, 3, 3, `=OFFSET(${args})`);
  wb.setInput(id, 4, 3, `=SUM(OFFSET(${args}))`);
  wb.setInput(id, 5, 3, `=IFERROR(OFFSET(${args}),"invalid")`);
  expect(wb.getValue(id, 3, 3)).toEqual({ error: '#REF!' });
  expect(wb.getValue(id, 4, 3)).toEqual({ error: '#REF!' });
  expect(wb.getValue(id, 5, 3)).toBe('invalid');
  expect(wb.spillRangeAt(id, 3, 3)).toBeNull();
});

it('retains references that reach the last row and column, including range results', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', rows: 1048576, cols: 16384 }] });
  const id = wb.activeSheetId;
  wb.setInput(id, 1048575, 16383, '11');
  wb.setInput(id, 1048574, 16383, '5');
  wb.setInput(id, 1048575, 16382, '3');
  for (const [r, formula, expected] of [
    [0, 'OFFSET(A1,1048575,16383)', 11],
    [1, 'SUM(OFFSET(A1,1048574,16383,2,1))', 16],
    [2, 'SUM(OFFSET(A1,1048575,16382,1,2))', 14],
    [3, 'OFFSET(Data!XFD1048576,-1,0)', 5],
  ]) {
    wb.setInput(id, r, 0, `=${formula}`);
    expect(wb.getValue(id, r, 0)).toBe(expected);
  }
});

it('recovers when a calculated offset returns inside the grid and follows undo', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '7');
  wb.setInput(id, 0, 1, '1048576');
  wb.setInput(id, 3, 3, '=OFFSET(A1,B1,0)');
  expect(wb.getValue(id, 3, 3)).toEqual({ error: '#REF!' });
  wb.setInput(id, 0, 1, '0');
  expect(wb.getValue(id, 3, 3)).toBe(7);
  wb.undo();
  expect(wb.getValue(id, 3, 3)).toEqual({ error: '#REF!' });
});
