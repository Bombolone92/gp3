import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

async function nativeOnly(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), {type:'array'});
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, {type:'array',fileType:'zip'}), 'product-underflow');
}

it('preserves product formulas, database criteria, edits and shifted copies through native-only XLSX saves', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  const rows = [['Value',null,'Value'],['1e-154','1e-154','<>'],['1e-154','1e-154'],['1e307','0']];
  rows.forEach((row,r)=>row.forEach((v,c)=>{if(v!==null)wb.setInput(id,r,c,v)}));
  const formulas = ['PRODUCT(A2:A4)','DPRODUCT(A1:A4,"Value",C1:C2)','SUMPRODUCT(A2:A4,B2:B4)','SUMSQ(A2:A3)'];
  formulas.forEach((f,c)=>wb.setInput(id,0,c+3,'='+f));
  for (let pass=0;pass<2;pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f,c)=>{expect(wb.getCell(id,0,c+3).f).toBe(f);expect(wb.getValue(id,0,c+3)).toBe(0)});
  }
  wb.setInput(id,2,0,'1e-153');
  expect(wb.getValue(id,0,3)).toBe(1e-154 * 1e-153 * 1e307);
  expect(wb.getValue(id,0,4)).toBe(wb.getValue(id,0,3));
  wb.undo(); expect(wb.getValue(id,0,3)).toBe(0);
  wb.pasteCells(id,wb.copyRange(id,{r1:0,c1:0,r2:3,c2:6}),10,0,{r:0,c:0});
  expect(wb.getCell(id,10,4).f).toBe('DPRODUCT(A11:A14,"Value",C11:C12)');
  wb = await nativeOnly(wb); id = wb.activeSheetId;
  for(const r of [0,10])for(let c=3;c<=6;c++)expect(wb.getValue(id,r,c)).toBe(0);
});

it('preserves numeric zero and error types in external HTML copies of product results', () => {
  const values=[[0,6,{error:'#N/A'}]],shown=[['0','6','#N/A']];
  const html=cellsToHtml(shown,[values[0].map(v=>({v}))],null,values).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
  vi.stubGlobal('DOMParser',new JSDOM('').window.DOMParser);
  try {expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(x=>x.cell.v)).toEqual(values[0]);}
  finally {vi.unstubAllGlobals();}
});
