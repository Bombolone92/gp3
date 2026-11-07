import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function setup(source='=Options') {
  const wb=new Workbook({sheets:[{name:'Data'},{name:'Other'}],names:[
    {name:'Base',ref:'Data!A1:A3'},{name:'Options',ref:'Base'},
    {name:'Options',ref:'Other!A1:A2',sheet:'Other'},
  ]}); const id=wb.sheets[0].id;
  ['Red','Green','Red'].forEach((v,r)=>wb.setInput(id,r,0,v));
  ['Blue','Yellow'].forEach((v,r)=>wb.setInput(wb.sheets[1].id,r,0,v));
  wb.addValidation(id,{type:'list',source,range:{r1:0,c1:3,r2:4,c2:3},strict:true,chips:true});
  return {wb,id,rule:wb.sheet(id).validations[0]};
}
it.each(['=Options','=Data!Options','=Base','=Data!A1:A3','=A1:A3','=OFFSET(Base,0,0,2,1)','=INDIRECT("Options")'])(
  'resolves the validation list source %s',source=>{
    const {wb,id,rule}=setup(source);
    expect(wb.listOptionsFor(id,rule)).toEqual(['Red','Green']);
    expect(wb.validateInput(id,0,3,'Green').ok).toBe(true);
    expect(wb.validateValue(id,0,3,'Purple').ok).toBe(false);
    wb.setInput(id,0,3,'Red'); expect(wb.validateCell(id,0,3).ok).toBe(true);
    expect(wb.chipAt(id,0,3)).not.toBeNull();
  },
);
it('resolves unqualified and explicitly qualified local names in the correct scope',()=>{
  const {wb,id,rule}=setup(); const other=wb.sheets[1].id;
  expect(wb.listOptionsFor(other,rule)).toEqual(['Blue','Yellow']);
  expect(wb.listOptionsFor(id,{...rule,source:'=Other!Options'})).toEqual(['Blue','Yellow']);
  expect(wb.listOptionsFor(other,{...rule,source:'=Data!Options'})).toEqual(['Red','Green']);
});
it('retains numeric, boolean, and literal text types with the same label',()=>{
  const {wb,id,rule}=setup('=Data!A1:A4');
  ['5',"'5",'TRUE',"'TRUE"].forEach((v,r)=>wb.setInput(id,r,0,v));
  expect(wb.listOptionsFor(id,rule,{typed:true})).toEqual([5,'5',true,'TRUE']);
});
it('follows name edits, undo, and redo',()=>{
  const {wb,id,rule}=setup(); expect(wb.listOptionsFor(id,rule)).toEqual(['Red','Green']);
  wb.defineName('Options','Other!A1:A2'); expect(wb.listOptionsFor(id,rule)).toEqual(['Blue','Yellow']);
  wb.undo(); expect(wb.listOptionsFor(id,rule)).toEqual(['Red','Green']);
  wb.redo(); expect(wb.listOptionsFor(id,rule)).toEqual(['Blue','Yellow']);
});
it('follows spill resizing through a named source',()=>{
  const {wb,id,rule}=setup('=Spilled'); wb.defineName('Spilled','Data!F1#');
  wb.setInput(id,0,5,'=SEQUENCE(3)'); expect(wb.listOptionsFor(id,rule,{typed:true})).toEqual([1,2,3]);
  wb.setInput(id,0,5,'=SEQUENCE(2,1,8)'); expect(wb.listOptionsFor(id,rule,{typed:true})).toEqual([8,9]);
});
it('keeps sparse named ranges sparse and caches their values',()=>{
  const {wb,id,rule}=setup(); wb.defineName('Options','Data!A1:XFD1048576');
  const compute=vi.spyOn(wb,'_compute');
  for(let i=0;i<20;i++)expect(wb.listOptionsFor(id,rule)).toEqual(['Red','Green']);
  expect(compute).toHaveBeenCalledTimes(3);
});
it.each(['=Missing','=42','=SUM(1,2)','=SEQUENCE(2)','=IF(','=Loop'])(
  'rejects invalid or non-reference source %s instead of offering its text',source=>{
    const {wb,id,rule}=setup(source); wb.defineName('Loop','INDIRECT("Loop")');
    expect(wb.listOptionsFor(id,rule)).toEqual([]);
    expect(wb.validateValue(id,0,3,source).ok).toBe(false);
  },
);
it('keeps literal lists and arrays literal even when they contain a name',()=>{
  const {wb,id,rule}=setup();
  expect(wb.listOptionsFor(id,{...rule,source:'Options'})).toEqual(['Options']);
  expect(wb.listOptionsFor(id,{...rule,source:['=Options','Red']})).toEqual(['=Options','Red']);
});
it('preserves qualified sources through sheet rename and undo',()=>{
  const {wb,id}=setup('=Data!Options'); wb.renameSheet(id,'Source Data');
  expect(wb.sheet(id).validations[0].source).toBe("='Source Data'!Options");
  expect(wb.listOptionsFor(id,wb.sheet(id).validations[0])).toEqual(['Red','Green']);
  wb.undo(); expect(wb.sheet(id).validations[0].source).toBe('=Data!Options');
});
it('retains validation-only aliases on sheet export and XLSX reopening',async()=>{
  const {wb,id}=setup(); let copy=wb.sheetToWorkbook(id);
  expect(copy.names.map(n=>n.name)).toEqual(['Base','Options']);
  copy=await workbookFromFile(await workbookToXlsx(copy),'validation.xlsx');
  expect(copy.listOptionsFor(copy.activeSheetId,copy.activeSheet.validations[0])).toEqual(['Red','Green']);
});
