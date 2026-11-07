import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
const nativeRoundtrip=async wb=>{
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  const part=X.CFB.find(zip,'/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip,'/xl/workbook.xml',new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
  return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}));
};
const setup=()=>{
  const wb=new Workbook({sheets:[{name:'Report',cells:{'5,4':{v:1},'6,4':{v:1}}},{name:'Data',cells:{'4,2':{v:'Amount'},'5,2':{v:5},'6,2':{v:9}}}]});
  wb.addTable(wb.sheets[1].id,{r1:4,c1:2,r2:6,c2:2},{name:'Amounts'});
  return wb;
};
it('preserves row-relative conditional formulas when their source table is omitted', async()=>{
  const source=setup(),id=source.activeSheetId;
  source.addRule(id,{type:'formula',range:{r1:5,c1:4,r2:6,c2:4},value:'Amounts[@Amount]>7',style:{bg:'#ff0000'}});
  const original=source.toJSON();
  let copy=source.sheetToWorkbook(id,{sourceWorkbook:'https://example.com/source.xlsx'});
  for(let cycle=0;cycle<2;cycle++) {
    expect(copy.activeSheet.rules[0].value).toContain('$C$6:$C$7');
    expect(copy.activeSheet.rules[0].value).not.toContain('NaN');
    expect(copy.conditionalStyle(copy.activeSheetId,5,4,1)).toBeNull();
    expect(copy.conditionalStyle(copy.activeSheetId,6,4,1)).toEqual({bg:'#ff0000'});
    copy=await nativeRoundtrip(copy);
  }
  expect(source.toJSON()).toEqual(original);
});
it('anchors validation formulas at their range and retains row-relative behavior',()=>{
  const source=setup(),id=source.activeSheetId;
  source.addValidation(id,{type:'formula',range:{r1:5,c1:4,r2:6,c2:4},source:'=Amounts[@Amount]>7',strict:true});
  const copy=source.sheetToWorkbook(id,{sourceWorkbook:'https://example.com/source.xlsx'});
  expect(copy.validateInput(id,5,4,'1').ok).toBe(false);
  expect(copy.validateInput(id,6,4,'1').ok).toBe(true);
  expect(copy.activeSheet.validations[0].source).toContain('$C$6:$C$7');
});
it('uses the calculated-column anchor when filling new rows after copying',()=>{
  const source=setup(),id=source.activeSheetId;
  source.setInput(id,4,4,'Result');
  source.setInput(id,6,4,'');
  source.addTable(id,{r1:4,c1:4,r2:5,c2:4},{name:'Results'});
  source.setInput(id,5,4,'=Amounts[@Amount]*2');
  const copy=source.sheetToWorkbook(id,{sourceWorkbook:'https://example.com/source.xlsx'});
  expect(copy.getValue(id,5,4)).toBe(10);
  expect(copy.activeSheet.tables[0].calc[0]).toContain('$C$6:$C$7');
  expect(copy.activeSheet.tables[0].calc[0]).toContain('ROW()');
  expect(copy.addTableRow(id,copy.activeSheet.tables[0].id)).toBe(6);
  expect(copy.getValue(id,6,4)).toBe(18);
});
it('anchors sparkline sources at their destination cells rather than treating a binding as coordinates',async()=>{
  const source=setup(),id=source.activeSheetId;
  source.activeSheet.sparklineGroups=[{type:'column',sparklines:[{ref:'F6',formula:'Amounts[@Amount]'},{ref:'F7',formula:'Amounts[@Amount]'}]}];
  const copy=source.sheetToWorkbook(id,{sourceWorkbook:'https://example.com/source.xlsx'});
  const {nativeSparklineData}=await import('../src/core/native-sparkline-data.js');
  for(const spark of copy.activeSheet.sparklineGroups[0].sparklines)expect(spark.formula).toContain("'[1]Data'!$C$6:$C$7");
  expect(nativeSparklineData(copy,id,5,5).points[0].value).toBe(5);
  expect(nativeSparklineData(copy,id,6,5).points[0].value).toBe(9);
});
it.each([false,true])('anchors filter formulas and their stored intervals (parts=%s)',parts=>{
  let source=setup();
  const criterion={formula:'Amounts[@Amount]>7'};
  if(parts)criterion.formulaParts={formula:criterion.formula,parts:[5,6].map(r=>({source:criterion.formula,range:{r1:r,c1:4,r2:r,c2:4}}))};
  const json=source.toJSON();json.sheets[0].filter={range:{r1:4,c1:4,r2:6,c2:4},criteria:{4:criterion}};delete json.sheets[0].filterHidden;
  source=new Workbook(json);
  let copy=source.sheetToWorkbook(source.activeSheetId,{sourceWorkbook:'https://example.com/source.xlsx'});
  const copied=copy.toJSON();delete copied.sheets[0].filterHidden;copy=new Workbook(copied);
  expect(copy.activeSheet.filterHidden.has(5)).toBe(true);expect(copy.activeSheet.filterHidden.has(6)).toBe(false);
  const rule=copy.activeSheet.filter.criteria[4];
  expect(rule.formula).not.toContain('NaN');
  for(const formula of parts?rule.formulaParts.parts.map(p=>p.source):[rule.formula]) {
    expect(formula).toContain("'[1]Data'!$C$6:$C$7");expect(formula).toContain('ROW()');
  }
});
it('keeps named this-row references caller-relative and bounded after their table is omitted',async()=>{
  const source=setup(),id=source.activeSheetId;
  source.defineName('RowAmount','Amounts[@Amount]');
  for(const r of [4,5,6,7])source.setInput(id,r,4,'=RowAmount');
  let copy=source.sheetToWorkbook(id,{sourceWorkbook:'https://example.com/source.xlsx'});
  for(let cycle=0;cycle<2;cycle++) {
    expect([4,5,6,7].map(r=>copy.getValue(copy.activeSheetId,r,4))).toEqual([{error:'#VALUE!'},5,9,{error:'#VALUE!'}]);
    expect(copy.names.find(n=>n.name==='RowAmount').ref).toContain('INDEX(');
    copy=await nativeRoundtrip(copy);
  }
  expect(source.names.find(n=>n.name==='RowAmount').ref).toBe('Amounts[@Amount]');
});
it('preserves caller rows inside the original external name namespace',async()=>{
  const source=setup(),id=source.activeSheetId;
  source.defineName('ScopedAmount','Amounts[@Amount]','Data');
  for(const r of [4,5,6,7])source.setInput(id,r,4,'=Data!ScopedAmount');
  let copy=source.sheetToWorkbook(id,{sourceWorkbook:'https://example.com/source.xlsx'});
  for(let cycle=0;cycle<2;cycle++) {
    expect([4,5,6,7].map(r=>copy.getValue(copy.activeSheetId,r,4))).toEqual([{error:'#VALUE!'},5,9,{error:'#VALUE!'}]);
    copy=await nativeRoundtrip(copy);
  }
});
it('retains a multi-column this-row reference as a reference expression',()=>{
  const source=setup(),id=source.activeSheetId,data=source.sheets[1].id;
  source.setInput(data,4,3,'Other');source.setInput(data,5,3,'2');source.setInput(data,6,3,'4');
  source.resizeTable(data,source.sheets[1].tables[0].id,{r1:4,c1:2,r2:6,c2:3});
  source.defineName('RowValues','Amounts[@[Amount]:[Other]]');
  for(const r of [5,6])source.setInput(id,r,4,'=SUM(RowValues)');
  const copy=source.sheetToWorkbook(id,{sourceWorkbook:'https://example.com/source.xlsx'});
  expect([5,6].map(r=>copy.getValue(id,r,4))).toEqual([7,13]);
});
it('does not read cells outside an omitted table when a copied calculated column grows',async()=>{
  const source=setup(),id=source.activeSheetId;
  source.setCells(source.sheets[1].id,[{r:7,c:2,cell:{v:123}}]);
  source.setInput(id,4,4,'Result');source.setInput(id,6,4,'');
  source.addTable(id,{r1:4,c1:4,r2:5,c2:4},{name:'Results'});
  source.setInput(id,5,4,'=Amounts[@Amount]*2');
  let copy=source.sheetToWorkbook(id,{sourceWorkbook:'https://example.com/source.xlsx'});
  copy=await nativeRoundtrip(copy);
  const copiedId=copy.activeSheetId,table=copy.activeSheet.tables[0].id;
  expect(copy.addTableRow(copiedId,table)).toBe(6);expect(copy.getValue(copiedId,6,4)).toBe(18);
  expect(copy.addTableRow(copiedId,table)).toBe(7);expect(copy.getValue(copiedId,7,4)).toEqual({error:'#VALUE!'});
  copy.undo();expect(copy.activeSheet.tables[0].range.r2).toBe(6);
  copy.redo();expect(copy.getValue(copiedId,7,4)).toEqual({error:'#VALUE!'});
});
it('preserves this-row bounds when copied cell formulas are pasted elsewhere',()=>{
  const source=setup(),id=source.activeSheetId;
  source.setCells(source.sheets[1].id,[{r:7,c:2,cell:{v:123}}]);source.setInput(id,5,4,'=Amounts[@Amount]');
  const copy=source.sheetToWorkbook(id,{sourceWorkbook:'https://example.com/source.xlsx'}),cells=copy.copyRange(id,{r1:5,c1:4,r2:5,c2:4});
  copy.pasteCells(id,cells,6,4,{r:5,c:4});expect(copy.getValue(id,6,4)).toBe(9);
  copy.pasteCells(id,cells,7,4,{r:5,c:4});expect(copy.getValue(id,7,4)).toEqual({error:'#VALUE!'});
});
