import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { toFileFormula, fromFileFormula } from '../src/core/xlfn.js';

// A LET name spelled like a built-in put its _xlpm. prefix on the built-in's call too:
// LET(sum,1,sum+SUM(A1)) was saved as _xlpm.sum+_xlpm.SUM(A1), which Excel reads as calling the
// number. The evaluator gives such a call to the built-in when the name holds a value (and to
// the name when it holds a LAMBDA), and the file now says the same.
it.each([
  ['LET(sum,1,sum+SUM(A1))', '_xlfn.LET(_xlpm.sum,1,_xlpm.sum+SUM(A1))'],
  ['LET(sum,SUM(A1:A3),sum+SUM(B1:B3))', '_xlfn.LET(_xlpm.sum,SUM(A1:A3),_xlpm.sum+SUM(B1:B3))'],
  ['LET(sequence,A1*2,sequence+SUM(SEQUENCE(3)))', '_xlfn.LET(_xlpm.sequence,A1*2,_xlpm.sequence+SUM(_xlfn.SEQUENCE(3)))'],
  ['LET(sort,"a",sort&COUNTA(SORT(A1:A3)))', '_xlfn.LET(_xlpm.sort,"a",_xlpm.sort&COUNTA(_xlfn._xlws.SORT(A1:A3)))'],
  ['LET(f,LAMBDA(x,x+1),f(2))', '_xlfn.LET(_xlpm.f,_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1),_xlpm.f(2))'], // a called name that holds a LAMBDA stays the name
  ['LET(sum,IF(A1>0,LAMBDA(x,x),LAMBDA(x,-x)),sum(2))', '_xlfn.LET(_xlpm.sum,IF(A1>0,_xlfn.LAMBDA(_xlpm.x,_xlpm.x),_xlfn.LAMBDA(_xlpm.x,-_xlpm.x)),_xlpm.sum(2))'], // and so does one that may
])('writes %s to the file as %s and reads it back', (ours, file) => {
  expect(toFileFormula(ours)).toBe(file);
  expect(fromFileFormula(file, new Set())).toBe(ours);
});

it('keeps the value of a built-in called beside a parameter of its name across a save and reopen', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '5');
  wb.setInput(id, 0, 1, '=LET(sum,1,sum+SUM(A1))');
  expect(wb.getValue(id, 0, 1)).toBe(6);
  const opened = await workbookFromFile(await workbookToXlsx(wb), 'shadowed.xlsx');
  const oid = opened.activeSheetId;
  expect(opened.getCell(oid, 0, 1).f).toBe('LET(sum,1,sum+SUM(A1))');
  expect(opened.getValue(oid, 0, 1)).toBe(6);
});
