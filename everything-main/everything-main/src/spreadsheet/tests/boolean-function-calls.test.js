import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function calc(formula) {
  const wb=new Workbook(); wb.setInput(wb.activeSheetId,0,0,`=${formula}`);
  return wb.getValue(wb.activeSheetId,0,0);
}
it.each([
  ['TRUE()',true],['FALSE()',false],['true ( )',true],['FaLsE\n(\t)',false],
  ['IF(TRUE(),1,2)',1],['IF(FALSE(),1,2)',2],['NOT(FALSE())',true],
  ['TRUE()+FALSE()',1],['TRUE()=TRUE',true],['FALSE()=FALSE',true],
  ['LET(flag,TRUE(),IF(flag,FALSE(),TRUE()))',false],
  ['LAMBDA(flag,IF(flag,TRUE(),FALSE()))(1)',true],
  ['TRUE(',true], // typed short of its closing parenthesis, the call is completed to TRUE()
])('evaluates the zero-argument Boolean call in %s', (formula,expected)=>expect(calc(formula)).toBe(expected));
it.each(['TRUE(1)','FALSE(TRUE)','TRUE(,)','FALSE(1,2)','FALSE())'])(
  'rejects arguments or malformed parentheses in %s',formula=>expect(calc(formula)).toEqual({error:'#ERROR!'}),
);
it('keeps bare Boolean values and quoted function text unchanged',()=>{
  expect(calc('TRUE')).toBe(true);expect(calc('FALSE')).toBe(false);
  expect(calc('"TRUE()"&"FALSE()"')).toBe('TRUE()FALSE()');
});
it('spills Boolean calls and follows edits and undo',()=>{
  const wb=new Workbook(),id=wb.activeSheetId;wb.setInput(id,0,0,'={TRUE(),FALSE()}');
  expect(wb.rangeValues(id,{r1:0,c1:0,r2:0,c2:1})).toEqual([[true,false]]);
  wb.setInput(id,0,0,'={FALSE(),TRUE()}');expect(wb.getValue(id,0,0)).toBe(false);
  wb.undo();expect(wb.getValue(id,0,0)).toBe(true);
});
it('uses Boolean calls in named formulas and validation rules',()=>{
  const wb=new Workbook({names:[{name:'Always',ref:'TRUE()'}]}),id=wb.activeSheetId;
  wb.setInput(id,0,0,'=Always');expect(wb.getValue(id,0,0)).toBe(true);
  wb.addValidation(id,{type:'formula',range:{r1:0,c1:1,r2:0,c2:1},source:'=IF(B1>0,TRUE(),FALSE())',strict:true});
  expect(wb.validateInput(id,0,1,'3').ok).toBe(true);expect(wb.validateInput(id,0,1,'-1').ok).toBe(false);
});
it.each([['xlsx',workbookToXlsx],['ods',workbookToOds]])('preserves calls on %s export and reopening',async(ext,write)=>{
  const wb=new Workbook(),id=wb.activeSheetId;wb.setInput(id,0,0,'=TRUE()');wb.setInput(id,1,0,'=FALSE()');
  const copy=await workbookFromFile(await write(wb),`booleans.${ext}`);
  expect(copy.getValue(copy.activeSheetId,0,0)).toBe(true);expect(copy.getValue(copy.activeSheetId,1,0)).toBe(false);
  expect(copy.getCell(copy.activeSheetId,0,0).f).toBe('TRUE()');
});
it.each(['xlsx','ods'])('reads native %s Boolean formulas without app metadata',async(ext)=>{
  const book=X.utils.book_new();X.utils.book_append_sheet(book,{'!ref':'A1:B1',A1:{t:'b',v:true,f:'TRUE()'},B1:{t:'b',v:false,f:'FALSE()'}},'Data');
  const bytes=X.write(book,{type:'array',bookType:ext});
  const wb=await workbookFromFile(bytes,`native.${ext}`);
  expect(wb.rangeValues(wb.activeSheetId,{r1:0,c1:0,r2:0,c2:1})).toEqual([[true,false]]);
});
