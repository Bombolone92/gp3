// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-hijri-initial-field.json';

it('matches native B2 initialization, name reuse, field order and calendar boundaries', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"', '""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it('keeps the initial weekday result until mmm replaces it without leaking state between cells', () => {
  for (let repeat = 0; repeat < 3; repeat++) {
    expect(formatWithCode(1, 'B2ddd d mmmm dddd')).toBe('الإثنين 29 الإثنين الإثنين');
    expect(formatWithCode(1, 'B2d mmmm ddd')).toBe('29 شعبان الأحد');
    expect(formatWithCode(1, 'B2ddd mmm ddd')).toBe('الإثنين شعبان السبت');
    expect(formatWithCode(1, 'B2[$-0401]ddd')).toBe('الأحد');
    expect(formatWithCode(1, 'dddd')).toBe('Sunday');
    expect(formatWithCode(2722365, 'B2ddd')).toBe('الإثنين');
    expect(formatWithCode(2722366, 'B2ddd')).toBe('#####');
    expect(formatWithCode(2722366, 'B2d ddd')).toBe('1 الثلاثاء');
  }
});

it('retains initial-field semantics through edits, HTML and metadata-free XLSX', async () => {
  const examples = [[1,'B2ddd d mmmm dddd'],[1,'B2d mmmm ddd'],[45583,'B2ddd mmmm mmmmm'],[1,'B2ddd mmm ddd'],[1,'B2[h] ddd'],[2722365,'B2ddd'],[2722366,'B2d ddd'],[1,'B2[$-409]ddd mmmm ddd']];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code]] of examples.entries()) {
    wb.setInput(id,r,0,String(value)); wb.applyStyle(id,{r1:r,c1:0,r2:r,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=TEXT(A${r+1},"${code}")`);
    const expected = formatWithCode(value,code);
    const html = cellsToHtml([[expected]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value); expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,0,0,'2'); expect(wb.getValue(id,0,1)).toBe('الثلاثاء 1 الثلاثاء الثلاثاء');
  wb.undo(); expect(wb.getValue(id,0,1)).toBe('الإثنين 29 الإثنين الإثنين');
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes,{type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'initial-field.xlsx');
  for (const [r,[value,code]] of examples.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(value);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(back.getValue(back.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
