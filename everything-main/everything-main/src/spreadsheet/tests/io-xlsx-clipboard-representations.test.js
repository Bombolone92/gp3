// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsFromHtmlRows, cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import * as XLSX from '../src/vendor/xlsx.mjs';
import native from './fixtures/reference-clipboard-representations.json';

it('preserves recovered native clipboard values and formats through native-only XLSX and external HTML', async () => {
  const parsed=parseHtmlClipboard(native.html,native.text), entries=cellsFromHtmlRows(parsed.rows);
  let wb=new Workbook();
  wb.setCells(wb.activeSheetId,entries.map(({i,j,cell})=>({r:i,c:j,cell})));
  const expected=entries.filter(x=>x.j===1).map(x=>({v:x.cell.v,s:x.cell.s}));
  for(let pass=0;pass<2;pass++) {
    const blob=await workbookToXlsx(wb), bytes=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsArrayBuffer(blob);});
    const zip=XLSX.CFB.read(new Uint8Array(bytes),{type:'array'}),part=XLSX.CFB.find(zip,'/xl/workbook.xml');
    part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
    wb=await workbookFromFile(XLSX.CFB.write(zip,{type:'array',fileType:'zip'}),'pasted.xlsx');
    expected.forEach(({v,s},r)=>{
      expect(wb.getValue(wb.activeSheetId,r,1)).toEqual(v);
      expect(wb.getCell(wb.activeSheetId,r,1).f).toBeNull();
      expect(wb.styleAt(wb.activeSheetId,r,1)).toMatchObject({wrap:s.wrap,font:s.font,size:s.size,...(s.code?{code:s.code}:{})});
    });
  }
  const id=wb.activeSheetId, cells=expected.map((_,r)=>[wb.getCell(id,r,1)]), values=expected.map(({v})=>[v]);
  const html=cellsToHtml(expected.map((_,r)=>[wb.getDisplay(id,r,1)]),cells,null,values).replace(/ data-spreadsheet-\w+="[^"]*"/g,'');
  const copied=cellsFromHtmlRows(parseHtmlClipboard(html,native.text).rows).map(x=>x.cell.v);
  expect(copied).toEqual(expected.map(x=>x.v));
});
