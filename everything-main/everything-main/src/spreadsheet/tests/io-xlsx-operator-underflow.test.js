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
  return workbookFromFile(X.CFB.write(zip, {type:'array',fileType:'zip'}), 'operator-underflow');
}

it('retains arithmetic, dependency edits, Undo and shifted copies through native-only XLSX saves', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1e-307');
  const formulas = ['A1/10','A1*0.1','A1%','1/(A1/10)','EXP(-710)','F1*1e307','F1/0.1','F1/F1'];
  formulas.forEach((f,c) => wb.setInput(id,0,c+1,'='+f));
  const tiny = Math.exp(-710), expected = [0,0,0,{error:'#DIV/0!'},tiny,tiny*1e307,tiny/0.1,{error:'#DIV/0!'}];
  for (let pass=0;pass<2;pass++) {
    wb = await nativeOnly(wb); id = wb.activeSheetId;
    formulas.forEach((f,c) => {
      expect(wb.getCell(id,0,c+1).f).toBe(f);
      expect(wb.getValue(id,0,c+1)).toEqual(expected[c]);
    });
  }
  wb.setInput(id,0,0,'1e-306'); expect(wb.getValue(id,0,1)).toBe(1e-306 / 10);
  wb.undo(); expect(wb.getValue(id,0,1)).toBe(0);
  wb.pasteCells(id,wb.copyRange(id,{r1:0,c1:0,r2:0,c2:8}),8,0,{r:0,c:0});
  expect(wb.getCell(id,8,1).f).toBe('A9/10');
  expect(wb.getCell(id,8,6).f).toBe('F9*1e307');
  expected.forEach((v,c) => expect(wb.getValue(id,8,c+1)).toEqual(v));
});

it('copies zero numbers and division errors as their external HTML types', () => {
  const values = [[0,{error:'#DIV/0!'},0.1]], shown = [['0','#DIV/0!','0.1']];
  const html = cellsToHtml(shown,[values[0].map(v=>({v}))],null,values).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
  vi.stubGlobal('DOMParser',new JSDOM('').window.DOMParser);
  try { expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(x=>x.cell.v)).toEqual(values[0]); }
  finally { vi.unstubAllGlobals(); }
});
