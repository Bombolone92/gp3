import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import { fromFileFormula } from '../src/core/xlfn.js';

it('distinguishes a defined call from a native or legacy spill', () => {
  const names = new Set(['ANCHORARRAY']);
  expect(fromFileFormula('anchorarray(A1)', names)).toBe('anchorarray(A1)');
  expect(fromFileFormula('ANCHORARRAY(A1)')).toBe('A1#');
  expect(fromFileFormula('_xlfn.ANCHORARRAY(A1)', names)).toBe('A1#');
  expect(fromFileFormula('_xlfn.LET(x,anchorarray(A1),x+SUM(_xlfn.ANCHORARRAY(B1)))', names))
    .toBe('LET(x,anchorarray(A1),x+SUM(B1#))');
});

it.each(['xlsx', 'ods'].flatMap((format) => [false, true].map((named) => ({ format, named }))))(
  'preserves a defined spill-like function through repeated $format saves (named=$named)', async ({ format, named }) => {
    let wb = new Workbook(), id = wb.activeSheetId;
    wb.defineName('AnchorArray', 'LAMBDA(x,x*2)');
    wb.setInput(id, 0, 0, '10');
    wb.setInput(id, 0, 1, '=SEQUENCE(3)');
    const formula = 'anchorarray(A1)+SUM(B1#)';
    if (named) wb.defineName('Result', formula);
    wb.setInput(id, 0, 3, `=${named ? 'Result' : formula}`);
    expect(wb.getValue(id, 0, 3)).toBe(26);
    const write = format === 'xlsx' ? workbookToXlsx : workbookToOds;
    for (let i = 0; i < 2; i++) {
      wb = await workbookFromFile(await write(wb), `collision.${format}`); id = wb.sheets[0].id;
      expect(wb.getValue(id, 0, 3)).toBe(26);
      expect(named ? wb.names.find((n) => n.name === 'Result').ref : wb.getCell(id, 0, 3).f).toBe(formula);
    }
    wb.setInput(id, 0, 0, '20'); expect(wb.getValue(id, 0, 3)).toBe(46);
    wb.undo(); expect(wb.getValue(id, 0, 3)).toBe(26);
  },
);

it.each(['xlsx', 'ods'].flatMap((format) => [false, true].map((reverse) => ({ format, reverse }))))(
  'imports defined calls and native spills independently of name order in $format (reverse=$reverse)', async ({ format, reverse }) => {
    const book = X.utils.book_new();
    X.utils.book_append_sheet(book, {
      '!ref': 'A1:E3', A1: { t: 'n', v: 10 }, B1: { t: 'n', v: 1, f: '_xlfn.SEQUENCE(3)' },
      D1: { t: 'n', v: 0, f: 'anchorarray(A1)+SUM(_xlfn.ANCHORARRAY(B1))' },
      E1: { t: 'n', v: 0, f: 'Result' },
    }, 'Data');
    const names = [
      { Name: 'Result', Ref: 'anchorarray(Data!$A$1)+SUM(_xlfn.ANCHORARRAY(Data!$B$1))' },
      { Name: 'AnchorArray', Ref: '_xlfn.LAMBDA(_xlpm.x,_xlpm.x*2)' },
    ];
    book.Workbook = { Names: reverse ? names.reverse() : names };
    const wb = await workbookFromFile(new Uint8Array(X.write(book, { type: 'array', bookType: format })), `external.${format}`);
    const id = wb.sheets[0].id;
    expect(wb.getCell(id, 0, 3).f).toBe('anchorarray(A1)+SUM(B1#)');
    expect(wb.getValue(id, 0, 3)).toBe(26);
    expect(wb.getValue(id, 0, 4)).toBe(26);
    wb.defineName('AnchorArray', 'LAMBDA(x,x*3)');
    expect(wb.getValue(id, 0, 3)).toBe(36);
    expect(wb.getValue(id, 0, 4)).toBe(36);
    wb.undo(); expect(wb.getValue(id, 0, 4)).toBe(26);
  },
);
