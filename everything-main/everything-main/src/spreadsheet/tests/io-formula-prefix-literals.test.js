import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { fromFileFormula, toFileFormula } from '../src/core/xlfn.js';
import { spillRefsFromFile } from '../src/core/refs.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

it.each([
  ['"_xlfn.LET and _xlpm.x"', '"_xlfn.LET and _xlpm.x"'],
  ['"_xlfn.ANCHORARRAY(A1)"', '"_xlfn.ANCHORARRAY(A1)"'],
  ['"ANCHORARRAY(A1)"', '"ANCHORARRAY(A1)"'],
  ['"say ""_xlws.SORT"""', '"say ""_xlws.SORT"""'],
  ["'_xlfn.Data'!A1", "'_xlfn.Data'!A1"],
  ['_xlfn.Data!A1', '_xlfn.Data!A1'],
  ['SUM(Sales[_xlpm.Value])', 'SUM(Sales[_xlpm.Value])'],
  ['my_xlfn.Rate+1', 'my_xlfn.Rate+1'],
  ['_xlfn.LET(x,"_xlfn.LET",x)', 'LET(x,"_xlfn.LET",x)'],
  ['_xlfn.LAMBDA(_xlpm.x,_xlpm.x&"_xlpm.x")("yes")', 'LAMBDA(x,x&"_xlpm.x")("yes")'],
  ['_xlfn._xlws.SORT(A1:A2)', 'SORT(A1:A2)'],
  ['LET(f,_xlfn.SORT,f(A1:A2))', 'LET(f,SORT,f(A1:A2))'],
  ['SUM(_xlfn.ANCHORARRAY(A1))+LEN("ANCHORARRAY(B1)")', 'SUM(A1#)+LEN("ANCHORARRAY(B1)")'],
])('preserves data while decoding %s', (input, expected) => {
  expect(fromFileFormula(input)).toBe(expected);
});

it.each([
  ['"ANCHORARRAY(A1)"', '"ANCHORARRAY(A1)"'],
  ["'ANCHORARRAY(A1)'!B2", "'ANCHORARRAY(A1)'!B2"],
  ['SUM(Sales[ANCHORARRAY(A1)])', 'SUM(Sales[ANCHORARRAY(A1)])'],
  ['SUM(_xlfn.ANCHORARRAY( A1 ))', 'SUM(A1#)'],
  ["SUM(ANCHORARRAY('Plan''s Data'!$A$1))", "SUM('Plan''s Data'!$A$1#)"],
])('decodes spill references without touching literals in %s', (input, expected) => {
  expect(spillRefsFromFile(input)).toBe(expected);
});

it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('preserves literal prefixes and source sheet names over repeated %s saves', async (format, write) => {
  let wb = new Workbook(), id = wb.activeSheetId;
  wb.renameSheet(id, '_xlfn.Data'); wb.setInput(id, 0, 0, '42');
  wb.setInput(id, 1, 0, '=LET(x,"_xlfn.LET _xlpm.x ANCHORARRAY(A1)",x)');
  wb.setInput(id, 2, 0, "='_xlfn.Data'!A1");
  for (let i = 0; i < 2; i++) {
    wb = await workbookFromFile(await write(wb), `literal.${format}`); id = wb.sheets[0].id;
    expect(wb.getValue(id, 1, 0)).toBe('_xlfn.LET _xlpm.x ANCHORARRAY(A1)');
    expect(wb.getValue(id, 2, 0)).toBe(42);
  }
  wb.setInput(id, 0, 0, '84'); expect(wb.getValue(id, 2, 0)).toBe(84);
  wb.undo(); expect(wb.getValue(id, 2, 0)).toBe(42);
});

it('imports native lambda parameter prefixes while preserving literal parameter text', async () => {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 's', v: '', f: '_xlfn.LAMBDA(_xlpm.x,_xlpm.x&"_xlpm.x")("yes")' } }, 'Data');
  const wb = await workbookFromFile(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), 'lambda.xlsx');
  expect(wb.getValue(wb.sheets[0].id, 0, 0)).toBe('yes_xlpm.x');
});

it('round-trips real spill calls together with literal copies of their spelling', () => {
  const formula = 'SUM(A1#)&"_xlfn.ANCHORARRAY(A1)"';
  expect(fromFileFormula(toFileFormula(formula))).toBe(formula);
});
