import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const cases = [
  ['_xlfn.LAMBDA(_xlpm.x,_xlpm.x*2)', 'LAMBDA(x,x*2)', 'Result(21)', 42],
  ['_xlfn.LET(x,7,x*2)', 'LET(x,7,x*2)', 'Result', 14],
  ['_xlfn.SEQUENCE(3,1)', 'SEQUENCE(3,1)', 'SUM(Result)', 6],
  ['_xlfn._xlws.SORT(Data!$A$1:$A$2)', 'SORT(Data!$A$1:$A$2)', 'SUM(Result)', 30],
  ['_xlfn._xlws.FILTER(Data!$A$1:$A$2,Data!$A$1:$A$2>10)', 'FILTER(Data!$A$1:$A$2,Data!$A$1:$A$2>10)', 'SUM(Result)', 20],
  ['_xlfn.IFNA(#N/A,"_xlfn.literal")', 'IFNA(#N/A,"_xlfn.literal")', 'Result', '_xlfn.literal'],
  ['_xlfn.ANCHORARRAY(Data!$D$1)', 'Data!$D$1#', 'SUM(Result)', 6],
  ['"_xlpm.x ANCHORARRAY(A1)"', '"_xlpm.x ANCHORARRAY(A1)"', 'Result', '_xlpm.x ANCHORARRAY(A1)'],
];
it.each(['xlsx', 'ods'].flatMap((format) => cases.map(([ref, normalized, formula, expected]) => ({ format, ref, normalized, formula, expected }))))(
  'decodes the imported named formula $ref in $format', async ({ format, ref, normalized, formula, expected }) => {
    const book = X.utils.book_new();
    X.utils.book_append_sheet(book, {
      '!ref': 'A1:D3', A1: { t: 'n', v: 10 }, A2: { t: 'n', v: 20 },
      C1: { t: 'n', v: 0, f: formula }, D1: { t: 'n', v: 1, f: '_xlfn.SEQUENCE(3)' },
    }, 'Data');
    book.Workbook = { Names: [{ Name: 'Result', Ref: ref }] };
    const bytes = new Uint8Array(X.write(book, { type: 'array', bookType: format }));
    let wb = await workbookFromFile(bytes, `named.${format}`);
    expect(wb.names[0].ref).toBe(normalized);
    expect(wb.getValue(wb.sheets[0].id, 0, 2)).toBe(expected);
    wb = await workbookFromFile(await workbookToXlsx(wb), 'resaved.xlsx');
    expect(wb.names[0].ref).toBe(normalized);
    expect(wb.getValue(wb.sheets[0].id, 0, 2)).toBe(expected);
  },
);

it('keeps source edits and undo live for normalized named references', async () => {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, { '!ref': 'A1:B2', A1: { t: 'n', v: 10 }, A2: { t: 'n', v: 20 }, B1: { t: 'n', v: 30, f: 'Total' } }, '_xlfn.Data');
  book.Workbook = { Names: [{ Name: 'Total', Ref: "_xlfn.LET(x,SUM('_xlfn.Data'!$A$1:$A$2),x)" }] };
  const wb = await workbookFromFile(new Uint8Array(X.write(book, { type: 'array', bookType: 'xlsx' })), 'quoted.xlsx'), id = wb.sheets[0].id;
  expect(wb.getValue(id, 0, 1)).toBe(30);
  wb.setInput(id, 1, 0, '50'); expect(wb.getValue(id, 0, 1)).toBe(60);
  wb.undo(); expect(wb.getValue(id, 0, 1)).toBe(30);
});
