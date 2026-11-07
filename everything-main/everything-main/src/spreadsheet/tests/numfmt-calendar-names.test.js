// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-calendar-names.json';

it('matches native calendar month and weekday vocabularies independently of the locale', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"', '""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it('selects calendar names from the first section while meridiems retain their language', () => {
  expect(formatWithCode(45000,'[$-20407]mmmm dddd')).toBe('March Wednesday');
  expect(formatWithCode(45000,'[$-40409]mmm mmmm mmmmm ddd')).toBe('三月 三月 三 週三');
  expect(formatWithCode(45000,'[$-70409]mmmm ddd')).toBe('มีนาคม พ.');
  expect(formatWithCode(45000,'[$-30401]ddd dddd')).toBe('أربعاء الأربعاء');
  expect(formatWithCode(45000,'[$-10401]ddd dddd')).toBe('الأربعاء الأربعاء');
  expect(formatWithCode(45000,'[<0][$-40409]mmmm;mmmm')).toBe('三月');
  expect(formatWithCode(45000,'[<0]mmmm;[$-40409]mmmm')).toBe('March');
  expect(formatWithCode(45000.75,'[$-20412]mmmm AM/PM')).toBe('March 오후');
  expect(formatWithCode(45000.75,'[$-70409]mmmm AM/PM')).toBe('มีนาคม PM');
});

it('preserves explicit calendar semantics through edits, HTML and metadata-free XLSX', async () => {
  const cases = [[45000,'[$-20407]yyyy mmmm ddd'],[45000,'[$-40409]yyyy mmmm ddd'],[45000,'[$-70409]yyyy mmmm ddd'],[45000,'[$-30401]yyyy mmmm ddd'],[45306,'[$-10801]d mmmm ddd'],[45582,'[$-30801]d mmm mmmm ddd'],[45306,'[$-32c01]mmm mmmm ddd'],[45306,'[$-31801]mmm mmmm ddd'],[45000.75,'[$-1801]h:mm AM/PM'],[45306,'[$-2010401]d mmmm ddd'],[45306,'[$-ar-DZ]d mmmm ddd']];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r,[value,code]] of cases.entries()) {
    wb.setInput(id,r,0,String(value));
    wb.applyStyle(id,{r1:r,r2:r,c1:0,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=TEXT(A${r+1},"${code}")`);
    const expected=formatWithCode(value,code);
    expect(wb.getDisplay(id,r,0)).toBe(expected);
    const html=cellsToHtml([[expected]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell=cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value); expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,0,0,'43585'); expect(wb.getValue(id,0,1)).toBe('2019 April Tue');
  wb.undo(); expect(wb.getValue(id,0,1)).toBe('2023 March Wed');
  const blob=await workbookToXlsx(wb),bytes=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(new Uint8Array(r.result));r.readAsArrayBuffer(blob);});
  const zip=X.CFB.read(bytes,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  const restored=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'calendar-names.xlsx');
  for(const [r,[value,code]]of cases.entries()){
    expect(restored.getValue(restored.activeSheetId,r,0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId,r,0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(restored.getValue(restored.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
