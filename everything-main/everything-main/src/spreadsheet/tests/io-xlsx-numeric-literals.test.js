import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import native from './fixtures/reference-numeric-literals.json';

async function exportBytes(wb, external = false) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  if (!external) return bytes;
  const zip = X.CFB.read(bytes,{type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));
  part.size = part.content.length;
  return X.CFB.write(zip,{type:'array',fileType:'zip'});
}

it('preserves long bare constants and expressions through external XLSX round trips', async () => {
  let wb = new Workbook();
  for (const [r, { formula }] of native.entryControls.entries()) wb.setInput(wb.activeSheetId, r, 0, '=' + formula);
  for (let pass = 0; pass < 3; pass++) {
    for (const [r, { formula, value }] of native.entryControls.entries()) {
      expect(wb.getCell(wb.activeSheetId, r, 0).f).toBe(formula);
      expect(wb.getValue(wb.activeSheetId, r, 0)).toBe(value);
    }
    if (pass < 2) wb = await workbookFromFile(await exportBytes(wb, true), 'long-literals.xlsx');
  }
});

it('recalculates imported literals and preserves them through two native XLSX saves', async () => {
  const raw = X.utils.book_new();
  X.utils.book_append_sheet(raw, {'!ref':'A1:C2', A1:{t:'n',v:2}, A2:{t:'n',v:3},
    B1:{t:'n',v:99,f:'A1+1.234567890123459'}, B2:{t:'n',v:99,f:'A2+1e-308'},
    C1:{t:'n',v:1e308,f:'1e307*10'}, C2:{t:'s',v:'1.234567890123459'}}, 'Literals');
  let wb = await workbookFromFile(X.write(raw,{type:'array',bookType:'xlsx'}),'literals');
  for (let pass=0;pass<3;pass++) {
    const id=wb.activeSheetId;
    expect(wb.getValue(id,0,1)).toBe(3.23456789012345);
    expect(wb.getValue(id,1,1)).toBe(3);
    expect(wb.getValue(id,0,2)).toBe(1e308);
    expect(wb.getValue(id,1,2)).toBe('1.234567890123459');
    if (pass<2) wb = await workbookFromFile(await exportBytes(wb,true),'roundtrip');
  }
  const id=wb.activeSheetId;
  wb.setInput(id,0,0,'4'); expect(wb.getValue(id,0,1)).toBe(5.23456789012345);
  wb.undo(); expect(wb.getValue(id,0,1)).toBe(3.23456789012345);
  wb.pasteCells(id,wb.copyRange(id,{r1:0,c1:0,r2:0,c2:1}),9,0,{r:0,c:0});
  expect(wb.getCell(id,9,1).f).toContain('A10');
  expect(wb.getValue(id,9,1)).toBe(3.23456789012345);
});

it('exports rejected literals as recoverable text rather than an invalid native formula', async () => {
  const wb = new Workbook(), id=wb.activeSheetId;
  const formulas=['1e308','IFERROR(1e999,99)','1e309%','0e-309'];
  formulas.forEach((f,r)=>wb.setInput(id,r,0,'='+f));
  const bytes=await exportBytes(wb), raw=X.read(bytes,{type:'array'}).Sheets.Sheet1;
  formulas.forEach((f,r)=>expect(raw[`A${r+1}`]).toMatchObject({t:'s',v:'='+f}));
  for(const cell of Object.values(raw)) if(cell && typeof cell==='object') expect(cell.f).toBeUndefined();
  const privateBack=await workbookFromFile(bytes,'private'), externalBack=await workbookFromFile(await exportBytes(wb,true),'external');
  formulas.forEach((f,r)=>{
    expect(privateBack.getCell(privateBack.activeSheetId,r,0).f).toBe(f);
    expect(privateBack.getValue(privateBack.activeSheetId,r,0)).toEqual({error:'#ERROR!'});
    expect(externalBack.getValue(externalBack.activeSheetId,r,0)).toBe('='+f);
  });
});

it('copies literal formulas privately and their computed numeric values externally', () => {
  const cell={f:'1.234567890123459'}, value=1.23456789012345;
  const html=cellsToHtml([[String(value)]],[[cell]],null,[[value]]);
  vi.stubGlobal('DOMParser',new JSDOM('').window.DOMParser);
  try {
    expect(parseHtmlClipboard(html).cells[0][0].f).toBe(cell.f);
    const external=html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    expect(cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell.v).toBe(value);
  } finally {vi.unstubAllGlobals();}
});
