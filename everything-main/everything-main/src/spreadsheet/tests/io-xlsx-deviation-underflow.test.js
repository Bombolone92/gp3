import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

async function nativeOnly(wb) {
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  const part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));
  part.size=part.content.length;
  return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'deviation-underflow');
}

it('preserves variance, database criteria, array kinds, dependency edits and shifted copies through XLSX', async () => {
  let wb=new Workbook(),id=wb.activeSheetId;
  const rows=[['Value',null,'Value'],['0',null,'<>'],['0'],['3e-154']];
  rows.forEach((row,r)=>row.forEach((v,c)=>{if(v!==null)wb.setInput(id,r,c,v)}));
  const formulas=['DEVSQ(A2:A4)','VAR.P(A2:A4)','STDEV.P(A2:A4)','DVAR(A1:A4,"Value",C1:C2)',
    'DSTDEV(A1:A4,"Value",C1:C2)','VARA(A2:A4)','VARA({0,FALSE,3e-154})','AVERAGEA({2,TRUE,3})'];
  formulas.forEach((f,c)=>wb.setInput(id,0,c+3,'='+f));
  const expected=formulas.map((_,c)=>wb.getValue(id,0,c+3));
  expect(expected.slice(1,6)).toEqual([0,0,0,0,0]);
  expect(expected[0]*1e307).toBeCloseTo(0.4,14);
  expect(expected[6]*1e307).toBeCloseTo(0.45,14);
  expect(expected[7]).toBe(2.5);
  for(let pass=0;pass<2;pass++){
    wb=await nativeOnly(wb);id=wb.activeSheetId;
    formulas.forEach((f,c)=>{expect(wb.getCell(id,0,c+3).f).toBe(f);expect(wb.getValue(id,0,c+3)).toBe(expected[c])});
  }
  wb.setInput(id,3,0,'1e-153');expect(wb.getValue(id,0,4)).toBeGreaterThan(2**-1022);
  wb.undo();expect(wb.getValue(id,0,4)).toBe(0);
  wb.pasteCells(id,wb.copyRange(id,{r1:0,c1:0,r2:3,c2:10}),10,0,{r:0,c:0});
  expect(wb.getCell(id,10,6).f).toBe('DVAR(A11:A14,"Value",C11:C12)');
  wb=await nativeOnly(wb);id=wb.activeSheetId;
  for(const r of [0,10])expected.forEach((v,c)=>expect(wb.getValue(id,r,c+3)).toBe(v));
});

it('retains referenced booleans and numbers through external HTML, distinct from computed-array inputs', () => {
  const values=[[0,false,3]],shown=[['0','FALSE','3']];
  const html=cellsToHtml(shown,[values[0].map(v=>({v}))],null,values).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
  vi.stubGlobal('DOMParser',new JSDOM('').window.DOMParser);
  try {
    const wb=new Workbook(),id=wb.activeSheetId;
    wb.setCells(id,cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(({i,j,cell})=>({r:i,c:j,cell})));
    wb.setInput(id,2,0,'=VARA(A1:C1)');expect(wb.getValue(id,2,0)).toBe(3);
    wb.setInput(id,3,0,'=VARA(HSTACK(A1:C1))');expect(wb.getValue(id,3,0)).toBe(4.5);
  } finally {vi.unstubAllGlobals();}
});
