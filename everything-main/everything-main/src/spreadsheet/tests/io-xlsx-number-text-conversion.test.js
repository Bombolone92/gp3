import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

async function nativeOnly(wb) {
  const zip=X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  const part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));
  part.size=part.content.length;
  return workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'number-text');
}

it('preserves text results and live formulas through native-only saves, edits, Undo and internal paste', async () => {
  let wb=new Workbook(), id=wb.activeSheetId;
  const inputs=[1e15,1e-7,1e20,1/3], expected=['1000000000000000','0.0000001','1E+20','0.333333333333333'];
  wb.setCells(id,inputs.flatMap((v,r)=>[{r,c:0,cell:{v}},...['A'+(r+1)+'&""',`VALUETOTEXT(A${r+1})`,`ARRAYTOTEXT(A${r+1},1)`].map((f,c)=>({r,c:c+1,cell:{f}}))]));
  for(let pass=0;pass<2;pass++) {
    wb=await nativeOnly(wb);id=wb.activeSheetId;
    for(let r=0;r<inputs.length;r++) {
      expect(wb.getValue(id,r,0)).toBe(inputs[r]);
      expect(wb.getValue(id,r,1)).toBe(expected[r]);
      expect(wb.getValue(id,r,2)).toBe(expected[r]);
      expect(wb.getValue(id,r,3)).toBe(`{${expected[r]}}`);
      expect(wb.getCell(id,r,2).f).toBe(`VALUETOTEXT(A${r+1})`);
    }
  }
  wb.setInput(id,0,0,'1e20');expect(wb.getValue(id,0,1)).toBe('1E+20');
  wb.undo();expect(wb.getValue(id,0,1)).toBe(expected[0]);
  wb.pasteCells(id,wb.copyRange(id,{r1:0,c1:0,r2:0,c2:3}),9,0,{r:0,c:0});
  expect(wb.getCell(id,9,2).f).toBe('VALUETOTEXT(A10)');
  expect(wb.getValue(id,9,2)).toBe(expected[0]);
});

it('keeps converted numbers as typed text in external HTML copies', () => {
  const values=[['1000000000000000','0.0000001','1E+20','0.333333333333333']];
  const cells=[values[0].map(v=>({v}))];
  const html=cellsToHtml(values,cells,null,values).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
  vi.stubGlobal('DOMParser',new JSDOM('').window.DOMParser);
  try {
    expect(cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(x=>x.cell.v)).toEqual(values[0]);
  } finally {vi.unstubAllGlobals();}
});
