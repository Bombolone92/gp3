// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-japanese-era-fields.json';

it('matches native Japanese era conversion, re-entry boundaries, widths, directives and digit alphabets', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value,code),`${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"','""')}")`),`${value}: ${code}`).toEqual(expected);
  }
});

it('keeps source-era conversion, era fields and neutral weekday lookup independent', () => {
  const day = ymdToSerial(3930,7,30);
  expect(formatWithCode(day-1,'B2[$-30409]yyyy e g mm dd')).toBe('45 45 M 07 29');
  expect(formatWithCode(day,'B2[$-30409]yyyy e g mm dd')).toBe('01 1 T 07 30');
  expect(formatWithCode(45583,'B2[$-30000]yyyy ddd')).toBe('4294965435 الجمعة');
  expect(formatWithCode(45583,'[$-30000]B2yyyy e g')).toBe('06 6 R');
  expect(formatWithCode(45583,'B2[$-411]yyyy e g')).toBe('1446 1446 ');
  expect(formatWithCode(60,'B2[$-30411]yyyy')).toBe('#####');
  expect(formatWithCode(60,'B2[$-30411][h]')).toBe('1440');
});

it('preserves numeric dates and era formats through edits, HTML and metadata-free XLSX', async () => {
  const examples = [[45583,'B2[$-30411]yyyy e g'],[ymdToSerial(3930,7,30),'B2[$-30409]y ee ggg'],[45583,'B2[DBNum3][$-30411]yyyy'],[45583,'B2[$-2030411]yyyy'],[45583,'[$-30411]B2yyyy e g']];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r,[value,code]] of examples.entries()) {
    wb.setInput(id,r,0,String(value)); wb.applyStyle(id,{r1:r,c1:0,r2:r,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=TEXT(A${r+1},"${code}")`);
    const html = cellsToHtml([[formatWithCode(value,code)]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value); expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,1,0,String(examples[1][0]-1)); expect(wb.getValue(id,1,1)).toBe('45 45 明治');
  wb.undo(); expect(wb.getValue(id,1,1)).toBe('01 01 大正');
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes,{type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'japanese-era.xlsx');
  for (const [r,[value,code]] of examples.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(value);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(back.getValue(back.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
