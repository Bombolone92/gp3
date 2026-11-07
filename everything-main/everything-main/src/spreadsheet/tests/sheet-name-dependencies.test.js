import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function source(formula='Charge(50)') {
  const wb=new Workbook({sheets:[{name:'Data'},{name:'Other'}],names:[
    {name:'Rate',ref:'0.2'}, {name:'Charge',ref:'LAMBDA(x,x*Rate)'},
    {name:'Unused',ref:'999'}, {name:'Elsewhere',ref:'Other!A1'},
  ]}); wb.setInput(wb.sheets[0].id,0,0,`=${formula}`); return wb;
}
it.each(['Charge(50)', 'Data!Charge(50)', 'LET(Rate,7,Data!Charge(50))'])(
  'retains function and transitive dependencies for %s', (formula) => {
    const wb=source(formula), before=wb.toJSON(), copy=wb.sheetToWorkbook(wb.sheets[0].id);
    expect(copy.getValue(copy.activeSheetId,0,0)).toBe(10);
    expect(copy.names.map(n=>n.name)).toEqual(['Rate','Charge']);
    copy.defineName('Rate','0.4'); expect(copy.getValue(copy.activeSheetId,0,0)).toBe(20);
    expect(wb.toJSON()).toEqual(before);
  },
);
it('keeps the selected sheet’s local precedence without copying other scopes', () => {
  const wb=source(); wb.defineName('Rate','0.3','Data'); wb.defineName('Rate','0.5','Other');
  const copy=wb.sheetToWorkbook(wb.sheets[0].id);
  expect(copy.getValue(copy.activeSheetId,0,0)).toBe(15);
  expect(copy.names).toEqual([{name:'Charge',ref:'LAMBDA(x,x*Rate)'},{name:'Rate',ref:'0.3',sheet:'Data'}]);
});
it('does not collect lexical variables, quoted text, or a name matching a called built-in', () => {
  const wb=source('LET(Rate,5,Rate)+SUM(1,2)'); wb.defineName('SUM','999');
  const copy=wb.sheetToWorkbook(wb.sheets[0].id);
  expect(copy.getValue(copy.activeSheetId,0,0)).toBe(8); expect(copy.names).toEqual([]);
});
it('terminates cyclic name discovery and preserves its error', () => {
  const wb=source('Loop'); wb.defineName('Loop','Again+0'); wb.defineName('Again','Loop');
  const copy=wb.sheetToWorkbook(wb.sheets[0].id);
  expect(copy.names.map(n=>n.name)).toEqual(['Again','Loop']);
  expect(copy.getValue(copy.activeSheetId,0,0)).toEqual({error:'#CYCLE!'});
});
it('retains definitions used only by calculated-column templates', () => {
  const wb=source('1'), json=wb.toJSON(); json.sheets[0].cells={'0,0':{v:'Value'},'0,1':{v:'Fee'},'1,0':{v:10}};
  json.sheets[0].tables=[{id:'t',name:'Items',range:{r1:0,c1:0,r2:1,c2:1},calc:{1:'Charge([@Value])'}}];
  const loaded=new Workbook(json), copy=loaded.sheetToWorkbook(loaded.sheets[0].id), id=copy.activeSheetId;
  const row=copy.addTableRow(id,'t'); copy.setInput(id,row,0,'50'); expect(copy.getValue(id,row,1)).toBe(10);
});
it('keeps names used by conditional formatting, validation, and filter formulas', () => {
  const wb=source('10'), id=wb.sheets[0].id; wb.defineName('Threshold','5'); wb.defineName('ValidationFloor','4'); wb.defineName('FilterFloor','6');
  const range={r1:0,c1:0,r2:1,c2:0};
  wb.addRule(id,{type:'formula',range,value:'A1>Threshold',style:{bold:true}});
  wb.addValidation(id,{type:'formula',range,source:'A1>ValidationFloor',strict:true});
  const json=wb.toJSON(); json.sheets[0].cells['1,0']={v:3}; json.sheets[0].cells['2,0']={v:9};
  json.sheets[0].filter={range:{r1:0,c1:0,r2:2,c2:0},criteria:{0:{formula:'A2>FilterFloor'}}};
  const loaded=new Workbook(json), copy=loaded.sheetToWorkbook(id), out=copy.activeSheetId;
  expect(copy.conditionalStyle(out,0,0,10)).toMatchObject({bold:true});
  expect(copy.validateInput(out,0,0,'10').ok).toBe(true);
  expect(copy.names.map(n=>n.name)).toEqual(['FilterFloor','Threshold','ValidationFloor']);
  expect([...copy.sheets[0].filterHidden]).toEqual([1]);
});
it('keeps definitions used by literal and computed hyperlink destinations', () => {
  const wb=source('1'), id=wb.sheets[0].id;
  wb.defineName('Base','Data!B2:B4'); wb.defineName('Alias','Base');
  wb.setLink(id,0,0,'#Alias','Go'); const copy=wb.sheetToWorkbook(id);
  expect(copy.names.map(n=>n.name)).toEqual(['Alias','Base']);
  expect(copy.resolveLink(copy.linkAt(copy.activeSheetId,0,0).url)?.range).toEqual({r1:1,c1:1,r2:3,c2:1});
  wb.setInput(id,0,0,'=HYPERLINK("#"&"Alias","Go")'); const dynamic=wb.sheetToWorkbook(id,{sourceWorkbook:'../Source.xlsx'});
  expect(dynamic.resolveLink(dynamic.linkAt(dynamic.activeSheetId,0,0).url)).not.toBeNull();
});
it('does not treat quoted names or external links as dependencies', () => {
  const wb=source('HYPERLINK("https://example.com/Rate","Charge")'), copy=wb.sheetToWorkbook(wb.sheets[0].id);
  expect(copy.names).toEqual([]);
  expect(copy.linkAt(copy.activeSheetId,0,0).url).toBe('https://example.com/Rate');
});
it('retains referenced omitted-sheet definitions with cached source values', () => {
  const wb=source('Elsewhere'), copy=wb.sheetToWorkbook(wb.sheets[0].id,{sourceWorkbook:'../Source.xlsx'});
  expect(copy.sheets.map(s=>s.name)).toEqual(['Data']);
  expect(copy.getValue(copy.activeSheetId,0,0)).toBe(0);
});
it.each([['xlsx',workbookToXlsx],['ods',workbookToOds]])('preserves exported formula dependencies through %s reopening',async(ext,write)=>{
  const wb=source(); let copy=wb.sheetToWorkbook(wb.sheets[0].id);
  copy=await workbookFromFile(await write(copy),`sheet.${ext}`);
  expect(copy.getValue(copy.activeSheetId,0,0)).toBe(10);
});
