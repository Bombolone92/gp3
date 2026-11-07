import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { evaluate } from '../src/core/formula/evaluator.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  const value = (formula) => { wb.setInput(id, 9, 9, `=${formula}`); return wb.getValue(id, 9, 9); };
  return { wb, id, value };
}

it.each([
  ['A1:A2000', 2000, 1], ['B101:AAA2000', 1900, 702],
  ['A:A', 1048576, 1], ['C:E', 1048576, 3], ['1:1', 1, 16384], ['4:8', 5, 16384],
  ['A1:XFD1048576', 1048576, 16384], ['XFD1048576', 1, 1], ['C2000:A1', 2000, 3],
].flatMap(([ref, rows, cols]) => [['ROWS', ref, rows], ['COLUMNS', ref, cols]]))(
  '%s counts the declared extent of %s', (fn, ref, expected) => {
    expect(setup().value(`${fn}(${ref})`)).toBe(expected);
  },
);

it.each(['ROWS', 'COLUMNS'])('%s counts a valid single-cell reference containing an error', (fn) => {
  const { wb, id, value } = setup();
  wb.setInput(id, 0, 0, '=1/0');
  wb.defineName('Source', 'Sheet1!$A$1');
  expect(value(`${fn}(A1)`)).toBe(1);
  expect(value(`${fn}(Source)`)).toBe(1);
  expect(value(`${fn}(#DIV/0!)`)).toEqual({ error: '#DIV/0!' });
  expect(value(`${fn}(Missing!A1)`)).toEqual({ error: '#REF!' });
});

it.each([
  'ROWS(Source)', 'ROWS(LET(x,Source,x))', 'LET(fn,ROWS,fn(Source))',
  'ROWS(OFFSET(Other!A1,0,0,2000,1))', 'ROWS(INDIRECT("Other!A1:A2000"))',
])('preserves dimensions through named or returned references: %s', (formula) => {
  const { wb, value } = setup();
  wb.addSheet('Other'); wb.defineName('Source', 'Other!$A$1:$A$2000');
  expect(value(formula)).toBe(2000);
});

it.each([
  ['ROWS({1,2,3;4,5,6})', 2], ['COLUMNS({1,2,3;4,5,6})', 3],
  ['ROWS(SEQUENCE(4,3))', 4], ['COLUMNS(TRANSPOSE(SEQUENCE(4,3)))', 4],
  ['ROWS(42)', 1], ['COLUMNS("text")', 1],
])('keeps calculated array and scalar behavior for %s', (formula, expected) => {
  expect(setup().value(formula)).toBe(expected);
});

it('tracks spill resizing and blockage', () => {
  const { wb, id, value } = setup();
  wb.setInput(id, 0, 4, '3'); wb.setInput(id, 0, 0, '=SEQUENCE(E1,2)');
  expect(value('ROWS(A1#)')).toBe(3); expect(value('COLUMNS(A1#)')).toBe(2);
  wb.setInput(id, 0, 4, '5'); expect(value('ROWS(A1#)')).toBe(5);
  wb.setInput(id, 1, 0, 'blocked'); expect(value('ROWS(A1#)')).toEqual({ error: '#REF!' });
});

it.each(['ROWS', 'COLUMNS'])('%s reads no cell values for a direct full-grid reference', (fn) => {
  const failRead = () => { throw new Error('Range dimensions read cell values'); };
  expect(evaluate(parseFormula(`${fn}(Data!A1:XFD1048576)`), {
    sheetExists: () => true, getValue: failRead, getRangeValues: failRead,
  })).toBe(fn === 'ROWS' ? 1048576 : 16384);
});

it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('retains dimensions after edits, undo and %s reopening', async (format, write) => {
  const { wb, id, value } = setup();
  expect(value('ROWS(A1:A2000)+COLUMNS(A1:AAA1)')).toBe(2703);
  wb.insertRows(id, 1, 2); expect(wb.getValue(id, 11, 9)).toBe(2705);
  wb.undo(); expect(wb.getValue(id, 9, 9)).toBe(2703);
  wb.insertCols(id, 1, 2); expect(wb.getValue(id, 9, 11)).toBe(2705);
  const copy = await workbookFromFile(await write(wb), `dimensions.${format}`);
  expect(copy.getValue(copy.sheets[0].id, 9, 11)).toBe(2705);
});
