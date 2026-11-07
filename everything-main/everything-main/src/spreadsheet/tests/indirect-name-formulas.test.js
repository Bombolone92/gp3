import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function setup() {
  const wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Two' }], names: [
    { name: 'Base', ref: 'One!B2:B4' }, { name: 'Alias', ref: 'Base' },
    { name: 'Moved', ref: 'OFFSET(Base,1,1,2,1)' },
    { name: 'Chosen', ref: 'IF(TRUE,One!C3,One!D4)' },
    { name: 'Local', ref: 'C3', sheet: 'Two' }, { name: 'Cross', ref: 'Two!Local' },
    { name: 'Nested', ref: 'INDIRECT("Alias")' },
    { name: 'Indexed', ref: 'INDEX(Base,2,1)' },
  ] });
  const id = wb.sheets[0].id;
  [10,20,30].forEach((v,r)=>wb.setInput(id,r+1,1,String(v)));
  wb.setInput(id,2,2,'7'); wb.setInput(id,3,2,'9'); wb.setInput(wb.sheets[1].id,2,2,'80');
  return { wb, id, calc: (formula) => { wb.setInput(id,6,5,`=${formula}`); return wb.getValue(id,6,5); } };
}
it.each([
  ['SUM(INDIRECT("Alias"))',60], ['SUM(INDIRECT("Alias",FALSE))',60],
  ['SUM(INDIRECT("Moved"))',16], ['INDIRECT("Chosen")',7],
  ['INDIRECT("Cross")',80], ['INDIRECT("Two!Local")',80],
  ['SUM(INDIRECT("Nested"))',60], ['LET(Base,999,SUM(INDIRECT("Alias")))',60],
  ['INDIRECT("Indexed")',20], ['SUM(INDIRECT("Ali"&"as"))',60],
])('resolves named references in %s', (formula, expected) => {
  expect(setup().calc(formula)).toBe(expected);
});
it('spills the referenced range and follows value changes and undo', () => {
  const { wb,id,calc }=setup(); calc('INDIRECT("Alias")');
  expect(wb.rangeValues(id,{r1:6,c1:5,r2:8,c2:5})).toEqual([[10],[20],[30]]);
  wb.setInput(id,2,1,'45'); expect(wb.getValue(id,7,5)).toBe(45);
  wb.undo(); expect(wb.getValue(id,7,5)).toBe(20);
});
it('uses local name precedence for aliases', () => {
  const { wb,calc }=setup(); wb.defineName('Base','One!C3','One');
  expect(calc('INDIRECT("Alias")')).toBe(7);
});
it('does not fall back to a table when a scalar local name shadows it', () => {
  const wb=new Workbook({sheets:[{name:'One',cells:{'0,0':{v:'Qty'},'1,0':{v:10}},tables:[
    {id:'t',name:'Sales',range:{r1:0,c1:0,r2:1,c2:0}},
  ]}],names:[{name:'Sales',ref:'42',sheet:'One'}]});
  wb.setInput(wb.activeSheetId,4,0,'=SUM(INDIRECT("Sales"))');
  expect(wb.getValue(wb.activeSheetId,4,0)).toEqual({error:'#REF!'});
});
it('keeps computed alias dependencies after exporting a single sheet', () => {
  const { wb,id,calc }=setup(); calc('SUM(INDIRECT("Ali"&"as"))');
  const copy=wb.sheetToWorkbook(id,{sourceWorkbook:'../Source.xlsx'});
  expect(copy.getValue(id,6,5)).toBe(60);
  copy.setInput(id,6,5,'=INDIRECT("Cross")');
  // Cross now points into an omitted (closed) source workbook.
  expect(copy.getValue(id,6,5)).toEqual({error:'#REF!'});
});
it('keeps navigation lazy through a qualified name inside INDIRECT', () => {
  const { wb }=setup(); wb.defineName('Destination','INDIRECT("Cross")');
  const read=vi.spyOn(wb,'_compute');
  expect(wb.resolveLink('#Destination')).toEqual({sheetId:wb.sheets[1].id,range:{r1:2,c1:2,r2:2,c2:2}});
  expect(read).not.toHaveBeenCalled();
});
it.each(['42','"B2"','SEQUENCE(3)','LAMBDA(x,x)','INDIRECT("Invalid")','Two!OtherLoop'])('rejects non-reference or cyclic definition %s', (ref) => {
  const { wb,calc }=setup();
  wb.replaceWith({...wb.toJSON(),names:[...wb.names,{name:'Invalid',ref},{name:'OtherLoop',ref:'One!Invalid',sheet:'Two'}]});
  expect(calc('INDIRECT("Invalid")')).toEqual({error:'#REF!'});
});
it.each([['xlsx',workbookToXlsx],['ods',workbookToOds]])('retains INDIRECT aliases after %s reopening',async(ext,write)=>{
  const { wb,id,calc }=setup(); calc('SUM(INDIRECT("Alias"))');
  const copy=await workbookFromFile(await write(wb),`names.${ext}`);
  expect(copy.getValue(copy.sheets[0].id,6,5)).toBe(60);
  expect(wb.sheetToWorkbook(id).getValue(id,6,5)).toBe(60);
});
