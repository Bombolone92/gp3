import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import { toFileFormula, fromFileFormula } from '../src/core/xlfn.js';

// Excel writes every LET and LAMBDA parameter in its files with an _xlpm. prefix, an
// optional one as [_xlpm.name], and some builds repair a formula saved without them.
// The writer added only the function prefixes, and the reader stripped the parameter
// prefix from plain names but not from inside an optional parameter's brackets.
it.each([
  ['LET(x,1,x*2)', '_xlfn.LET(_xlpm.x,1,_xlpm.x*2)'],
  ['LET(x,1,y,x+1,x*y)', '_xlfn.LET(_xlpm.x,1,_xlpm.y,_xlpm.x+1,_xlpm.x*_xlpm.y)'],
  ['LAMBDA(x,[y],IF(ISOMITTED(y),x,x+y))(1)', '_xlfn.LAMBDA(_xlpm.x,[_xlpm.y],IF(_xlfn.ISOMITTED(_xlpm.y),_xlpm.x,_xlpm.x+_xlpm.y))(1)'],
  ['LET(f,LAMBDA(x,x+1),f(2))', '_xlfn.LET(_xlpm.f,_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1),_xlpm.f(2))'],
  ['LET(x,A1,SUM(x,Sheet2!x,Rate))', '_xlfn.LET(_xlpm.x,A1,SUM(_xlpm.x,Sheet2!x,Rate))'],
  ['MAP(A1:A3,LAMBDA(v,v*Rate))', '_xlfn.MAP(A1:A3,_xlfn.LAMBDA(_xlpm.v,_xlpm.v*Rate))'],
  ['LET(x,"_xlpm.x",x)', '_xlfn.LET(_xlpm.x,"_xlpm.x",_xlpm.x)'],
  ['SUM(A1:A3)+x', 'SUM(A1:A3)+x'],
  ['SUM(Sales[Amount])', 'SUM(Sales[Amount])'],
])('writes the parameters of %s as Excel does and reads them back', (ours, file) => {
  expect(toFileFormula(ours)).toBe(file);
  expect(fromFileFormula(file)).toBe(ours);
});

it('marks no parameter in a formula it cannot analyse', () => {
  expect(toFileFormula('LET(x,1,x*2')).toBe('LET(x,1,x*2');
});

it('reads an optional parameter Excel declared as [_xlpm.name]', () => {
  expect(fromFileFormula('_xlfn.LAMBDA(_xlpm.x,[_xlpm.y],_xlpm.x+_xlpm.y)(1)')).toBe('LAMBDA(x,[y],x+y)(1)');
  expect(fromFileFormula('_xlfn.LAMBDA(_xlpm.x,[ _xlpm.y ],_xlpm.x)(1)')).toBe('LAMBDA(x,[y],x)(1)');
});

it('stores the parameter prefixes in the file the way Excel does', async () => {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, '=LET(x,2,LAMBDA(y,x*y)(3))');
  wb.defineName('Twice', 'LAMBDA(v,[w],v*IF(ISOMITTED(w),2,w))');
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const xml = new TextDecoder().decode(X.CFB.find(X.CFB.read(bytes, { type: 'array' }), 'sheet1.xml').content);
  expect(/<f\b[^>]*>([^<]*)<\/f>/.exec(xml)?.[1]).toBe('_xlfn.LET(_xlpm.x,2,_xlfn.LAMBDA(_xlpm.y,_xlpm.x*_xlpm.y)(3))');
  expect(X.read(bytes, { type: 'array', xlfn: true }).Workbook.Names[0].Ref).toBe('_xlfn.LAMBDA(_xlpm.v,[_xlpm.w],_xlpm.v*IF(_xlfn.ISOMITTED(_xlpm.w),2,_xlpm.w))');
});

it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('keeps LET and LAMBDA formulas and a name with an optional parameter through repeated .%s saves', async (extension, write) => {
  let wb = new Workbook();
  let id = wb.activeSheetId;
  const formula = 'LET(x,A1,f,LAMBDA(a,b,a+b),f(x,x)+f(x,10))';
  wb.setInput(id, 0, 0, '3');
  wb.setInput(id, 0, 1, `=${formula}`);
  wb.defineName('Twice', 'LAMBDA(v,[w],v*IF(ISOMITTED(w),2,w))');
  wb.setInput(id, 0, 2, '=Twice(A1)+Twice(A1,3)');
  expect(wb.getValue(id, 0, 1)).toBe(19);
  expect(wb.getValue(id, 0, 2)).toBe(15);
  for (let i = 0; i < 2; i++) {
    wb = await workbookFromFile(await write(wb), `parameters.${extension}`);
    id = wb.sheets[0].id;
    expect(wb.getCell(id, 0, 1).f).toBe(formula);
    expect(wb.getValue(id, 0, 1)).toBe(19);
    expect(wb.names[0].ref).toBe('LAMBDA(v,[w],v*IF(ISOMITTED(w),2,w))');
    expect(wb.getValue(id, 0, 2)).toBe(15);
  }
});
