import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { fromFileFormula, toFileFormula } from '../src/core/xlfn.js';
import { spillRefsFromFile } from '../src/core/refs.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

it.each([
  ['LET(SORT,LAMBDA(x,x+1),SORT(4))', '_xlfn.LET(_xlpm.SORT,_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1),_xlpm.SORT(4))'],
  ['LAMBDA(SORT,SORT(4))(LAMBDA(x,x+1))', '_xlfn.LAMBDA(_xlpm.SORT,_xlpm.SORT(4))(_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1))'],
  ['LET(x,SORT(A1:A2),SORT,LAMBDA(x,x+1),SORT(4))', '_xlfn.LET(_xlpm.x,_xlfn._xlws.SORT(A1:A2),_xlpm.SORT,_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1),_xlpm.SORT(4))'],
  ['LET(f,LAMBDA(SORT(4)),SORT,LAMBDA(x,x+1),f())', '_xlfn.LET(_xlpm.f,_xlfn.LAMBDA(_xlpm.SORT(4)),_xlpm.SORT,_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1),_xlpm.f())'],
  ['LET(LAMBDA,LAMBDA(x,x+1),LAMBDA(4))', '_xlfn.LET(_xlpm.LAMBDA,_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1),_xlpm.LAMBDA(4))'],
])('keeps local calls distinct from native functions in %s', (formula, expected) => {
  expect(toFileFormula(formula)).toBe(expected);
  expect(fromFileFormula(expected)).toBe(formula);
});

it.each([
  'LET(ANCHORARRAY,LAMBDA(x,x*2),ANCHORARRAY(A1))',
  'LAMBDA(ANCHORARRAY,ANCHORARRAY(A1))(LAMBDA(x,x*2))',
  'LET(f,LAMBDA(ANCHORARRAY(A1)),ANCHORARRAY,LAMBDA(x,x*2),f())',
  'LET(ANCHORARRAY,LAMBDA(x,x*2),LET(x,1,ANCHORARRAY(A1)))',
])('preserves the local spill-like call in %s', (formula) => {
  expect(spillRefsFromFile(formula)).toBe(formula);
  expect(fromFileFormula(toFileFormula(formula))).toBe(formula);
});

it('keeps real spill references distinct from a local function with the same name', () => {
  const formula = 'LET(ANCHORARRAY,LAMBDA(x,x*2),SUM(B1#)+ANCHORARRAY(A1))';
  expect(fromFileFormula(toFileFormula(formula))).toBe(formula);
  expect(spillRefsFromFile('_xlfn.LET(ANCHORARRAY,_xlfn.LAMBDA(x,x*2),ANCHORARRAY(A1))'))
    .toBe('_xlfn.LET(ANCHORARRAY,_xlfn.LAMBDA(x,x*2),ANCHORARRAY(A1))');
});

it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]].flatMap(([format, write]) => [false, true].map((named) => ({ format, write, named }))))(
  'preserves local calls and genuine spills over repeated $format saves (named=$named)', async ({ format, write, named }) => {
    let wb = new Workbook(), id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '10'); wb.setInput(id, 0, 1, '=SEQUENCE(3)');
    const formula = 'LET(ANCHORARRAY,LAMBDA(x,x*2),SUM(B1#)+ANCHORARRAY(A1))';
    if (named) wb.defineName('Result', formula);
    wb.setInput(id, 0, 3, `=${named ? 'Result' : formula}`);
    expect(wb.getValue(id, 0, 3)).toBe(26);
    for (let i = 0; i < 2; i++) {
      wb = await workbookFromFile(await write(wb), `local.${format}`); id = wb.sheets[0].id;
      expect(wb.getValue(id, 0, 3)).toBe(26);
    }
    wb.setInput(id, 0, 0, '20'); expect(wb.getValue(id, 0, 3)).toBe(46);
    wb.undo(); expect(wb.getValue(id, 0, 3)).toBe(26);
  },
);
