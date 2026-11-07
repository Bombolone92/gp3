import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { signatureFor } from '../src/core/formula/hints.js';

const calc = (formula) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, `=${formula}`);
  return wb.getValue(id, 0, 0);
};

it.each([
  ['2,3', '$C$2'], ['2,3,1', '$C$2'], ['2,3,2', 'C$2'], ['2,3,3', '$C2'], ['2,3,4', 'C2'],
  ['2,3,1,FALSE', 'R2C3'], ['2,3,2,FALSE', 'R2C[3]'], ['2,3,3,FALSE', 'R[2]C3'], ['2,3,4,FALSE', 'R[2]C[3]'],
  ['1,1,,,"Sheet2"', 'Sheet2!$A$1'], ['2,3,1,FALSE,"[Book1]Sheet1"', "'[Book1]Sheet1'!R2C3"],
  ['2,3,1,FALSE,"EXCEL SHEET"', "'EXCEL SHEET'!R2C3"], ['2,3,4,TRUE,"Bob\'s data"', "'Bob''s data'!C2"],
  ['2.9,3.9,2.9,1', 'C$2'], ['"2","3",4,"FALSE"', 'R[2]C[3]'],
  ['1048576,16384', '$XFD$1048576'],
])('formats ADDRESS(%s) as %s', (args, expected) => {
  expect(calc(`ADDRESS(${args})`)).toBe(expected);
});

it.each(['1048577,1', '1,16385', '1E100,1', '1,1E100', '0,1', '1,0',
  '2,3,0', '2,3,5', '2,3,"bad"', '2,3,1,"bad"'])('rejects invalid ADDRESS arguments %s', (args) => {
  expect(calc(`ADDRESS(${args})`)).toEqual({ error: '#VALUE!' });
});

it('preserves argument errors and exposes the complete signature', () => {
  expect(calc('ADDRESS(2,3,#N/A)')).toEqual({ error: '#N/A' });
  expect(calc('ADDRESS(2,3,1,#DIV/0!)')).toEqual({ error: '#DIV/0!' });
  expect(calc('ADDRESS(2,3,1,TRUE,#REF!)')).toEqual({ error: '#REF!' });
  expect(signatureFor('ADDRESS').params).toBe('row_num, column_num, [abs_num], [a1], [sheet_text]');
});

it('uses the requested sheet through INDIRECT and recalculates after edits and undo', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const source = wb.addSheet("Bob's data").id;
  wb.setInput(id, 1, 2, '99');
  wb.setInput(source, 1, 2, '42');
  wb.setInput(id, 0, 0, '=INDIRECT(ADDRESS(2,3,4,TRUE,"Bob\'s data"))');
  expect(wb.getValue(id, 0, 0)).toBe(42);
  wb.setInput(source, 1, 2, '7');
  expect(wb.getValue(id, 0, 0)).toBe(7);
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe(42);
});

it('supports zero and negative relative R1C1 offsets within the grid', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [args, expected] of [['-1,-2,4,FALSE', 'R[-1]C[-2]'], ['0,0,4,FALSE', 'RC'],
    ['2,0,2,FALSE', 'R2C'], ['0,3,3,FALSE', 'RC3']]) {
    wb.setInput(id, 3, 3, `=ADDRESS(${args})`);
    expect(wb.getValue(id, 3, 3)).toBe(expected);
  }
  wb.setInput(id, 3, 3, '=ADDRESS(-4,0,4,FALSE)');
  expect(wb.getValue(id, 3, 3)).toEqual({ error: '#VALUE!' });
});
