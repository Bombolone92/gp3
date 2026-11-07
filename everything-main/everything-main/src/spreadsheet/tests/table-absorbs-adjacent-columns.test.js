import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

function setup(totalsRow = false) {
  const wb=new Workbook(),id=wb.activeSheetId;
  wb.setCells(id,[['Item','Qty'],['a',2],['b',3]].flatMap((row,r)=>row.map((v,c)=>({r:r+2,c:c+1,cell:{v}}))));
  const tid=wb.addTable(id,parseRange('B3:C5'),{name:'Sales',totalsRow});
  wb.clearHistory();
  return {wb,id,tid,table:()=>wb.tableById(id,tid)};
}
it.each([false,true])('absorbs adjacent pasted columns with totals=%s and undoes the entire paste',totals=>{
  const {wb,id,table}=setup(totals),before=wb.toJSON();
  wb.transaction('Paste',()=>{
    wb.pasteValues(id,[['Qty','Cost'],[4,8],[5,10]],2,3);
    expect(wb.extendTableToCover(id,parseRange('D3:E5'))).toBe(true);
  });
  expect(table().range).toEqual(parseRange(totals?'B3:E6':'B3:E5'));
  expect(wb.tableColumns(id,table())).toEqual(['Item','Qty','Qty2','Cost']);
  expect(wb.getValue(id,3,3)).toBe(4);
  wb.undo();expect(wb.toJSON()).toEqual(before);
  wb.redo();expect(table().range.c2).toBe(4);
});
it('names data-only pasted columns and does not absorb rows past the table',()=>{
  const {wb,id,table}=setup();
  wb.pasteValues(id,[[8],[9],[10],[11]],3,3);
  expect(wb.extendTableToCover(id,parseRange('D4:D7'))).toBe(true);
  expect(table().range).toEqual(parseRange('B3:D5'));
  expect(wb.tableColumns(id,table())[2]).toBe('Column3');
  expect(wb.getValue(id,6,3)).toBe(11);
});
it('adopts a pasted calculated column and preserves it through XLSX',async()=>{
  const {wb,id,table}=setup();
  wb.pasteCells(id,[[{v:'Double'}],[{f:'Sales[@Qty]*2'}],[{f:'Sales[@Qty]*2'}]],2,3);
  expect(wb.extendTableToCover(id,parseRange('D3:D5'))).toBe(true);
  expect(table().calc[2]).toBe('Sales[@Qty]*2');
  expect(wb.getValue(id,4,3)).toBe(6);
  const data=new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer());
  const zip=X.CFB.read(data,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  const saved=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'columns.xlsx');
  expect(saved.activeSheet.tables[0].range).toEqual(parseRange('B3:D5'));
  expect(saved.getValue(saved.activeSheetId,4,3)).toBe(6);
});
it.each(['E3:E5','D2:D5','D6:D8','C4:D5'])('does not absorb a nonadjacent, above, below, or overlapping block %s',range=>{
  const {wb,id,table}=setup();
  expect(wb.extendTableToCover(id,parseRange(range))).toBe(false);
  expect(table().range).toEqual(parseRange('B3:C5'));
});
it('does not treat a totals-row-only paste as a new column',()=>{
  const {wb,id}=setup(true);
  expect(wb.extendTableToCover(id,parseRange('D6:D7'))).toBe(false);
});
it.each(['merge','table','protected'])('retains resize safeguards for %s in the expansion',kind=>{
  const {wb,id,table}=setup();
  if(kind==='merge')wb.mergeCells(id,parseRange('D3:E3'));
  if(kind==='table')wb.addTable(id,parseRange('E3:F5'),{name:'Other'});
  if(kind==='protected')wb.protectRange(id,parseRange('D3:D3'));
  expect(wb.extendTableToCover(id,parseRange('D3:E5'))).toBe(false);
  expect(table().range).toEqual(parseRange('B3:C5'));
});
