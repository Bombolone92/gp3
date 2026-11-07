import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { toFileFormula, fromFileFormula } from '../src/core/xlfn.js';

// @ on a LET or LAMBDA parameter is written as _xlfn.SINGLE(_xlpm.x), and reading it back kept the
// parameter's prefix inside the operator, so the formula came back as @_xlpm.x and showed #NAME?.
it.each(['LET(x,A1:A3,@x)', 'LET(x,A1:A3,SUM(@x))', 'LAMBDA(r,@r)(A1:A3)', 'LET(x,A1:A3,@x+@x)'])
  ('reads @ on a parameter back from the file form of %s', (formula) => {
    expect(fromFileFormula(toFileFormula(formula), new Set())).toBe(formula);
  });

it('reads the _xlfn.SINGLE spelling of @ on a LET parameter', () => {
  expect(fromFileFormula('_xlfn.LET(_xlpm.x,A1:A3,_xlfn.SINGLE(_xlpm.x))', new Set())).toBe('LET(x,A1:A3,@x)');
  expect(fromFileFormula('_xlfn.SINGLE(A1:A3)', new Set())).toBe('@A1:A3');
  expect(fromFileFormula('_xlfn.SINGLE(Prices)', new Set(['PRICES']))).toBe('@Prices');
});

it('keeps the value of @ on a parameter across a save and reopen', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [1, 2, 3].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  wb.setInput(id, 1, 2, '=LET(x,A1:A3,@x*10)');
  expect(wb.getValue(id, 1, 2)).toBe(20);
  const opened = await workbookFromFile(await workbookToXlsx(wb), 'single.xlsx');
  const oid = opened.activeSheetId;
  expect(opened.getCell(oid, 1, 2).f).toBe('LET(x,A1:A3,@x*10)');
  expect(opened.getValue(oid, 1, 2)).toBe(20);
});
