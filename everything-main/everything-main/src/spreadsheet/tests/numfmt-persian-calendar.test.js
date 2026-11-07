// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-persian-calendar.json';

afterEach(() => setLocale('en-US'));

it('matches native Persian dates, name resources, year boundaries and legacy field orders', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"', '""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it('uses astronomical new years and preserves date-serial validity', () => {
  for (const [year,start] of [[1900,21],[1904,21],[2000,20],[2023,21],[2024,20],[2025,21],[2100,21],[9999,18]]) {
    const first = ymdToSerial(year,3,start);
    expect(formatWithCode(first,'[$-160409]yyyy-mm-dd')).toBe(`${year-621}-01-01`);
    expect(formatWithCode(first-1,'[$-160409]yyyy-mm')).toBe(`${year-622}-12`);
    expect(formatWithCode(first+185,'[$-160409]mm-dd')).toBe('06-31');
    expect(formatWithCode(first+186,'[$-160409]mm-dd')).toBe('07-01');
  }
  expect(formatWithCode(0,'[$-160409]yyyy-mm-dd ddd')).toBe('1278-10-11 shanbeh');
  expect(formatWithCode(1,'[$-160409]yyyy-mm-dd ddd')).toBe('1278-10-11 Yekshanbeh');
  for (const field of ['yyyy-mm-dd','h:mm:ss','0 AM/PM','0.0E+00 AM/PM']) {
    expect(formatWithCode(60,`[$-160409]${field}`)).toBe('#####');
  }
  expect(formatWithCode(60,'[$-160409][h]')).toBe('1440');
  expect(formatWithCode(2958465,'[$-160409]yyyy-mm-dd')).toBe('9378-10-13');
});

it('keeps calendar conversion separate from neutral names, numeral shaping and B2 name state', () => {
  for (const locale of ['en-US','de-DE','fr-FR']) {
    setLocale(locale);
    expect(formatWithCode(45000,'[$-160409]yyyy-mm-dd mmmm ddd')).toBe('1401-12-24 Esfand Chahārshanbeh');
    expect(formatWithCode(45000,'[$-160429]mmmm ddd')).toBe('اسفند چهارشنبه');
    expect(formatWithCode(45000,'[$-16040c]mmmm ddd')).toBe('ésfànd Chaharchanbé');
    expect(formatWithCode(45000,'B2[$-160409]ddd mmm ddd')).toBe('Chahārshanbeh اسفند شنبه');
    expect(formatWithCode(45000,'B2[$-160000]yyyy-mm-dd mmm ddd')).toBe('1401-12-24 اسفند الأربعاء');
    expect(formatWithCode(45000,'[$-2160429]yyyy-mm-dd')).toBe('١٤٠١-١٢-٢٤');
  }
  setLocale('en-US');
  expect(formatWithCode(45000,'[$-160000]mmmm ddd')).toBe('December Wed');
  setLocale('de-DE');
  expect(formatWithCode(45000,'[$-160000]mmmm ddd')).toBe('Dezember Mi');
  expect(formatWithCode(45000,'[<0][$-160409]yyyy;[$-60409]yyyy-mm-dd')).toBe('1401-12-24');
});

it('retains serial dates and Persian formats through edit, Undo, external HTML and metadata-free XLSX', async () => {
  const cases = [[45736,'[$-160409]yyyy-mm-dd mmmm ddd'],[45000,'[$-160429]yyyy-mm-dd mmmm'],[45000,'B2[$-160409]ddd mmm ddd'],[45000,'[$-160000]yyyy-mm-dd mmm'],[45000,'[DBNum1][$-160804]yyyy-mm-dd']];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r,[value,code]] of cases.entries()) {
    wb.setInput(id,r,0,String(value));
    wb.applyStyle(id,{r1:r,r2:r,c1:0,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=TEXT(A${r+1},"${code}")`);
    const display = formatWithCode(value,code);
    const html = cellsToHtml([[display]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value); expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,0,0,'45737');
  expect(wb.getValue(id,0,1)).toBe('1404-01-01 Farvardin Jom\'eh');
  wb.undo(); expect(wb.getValue(id,0,1)).toBe('1403-12-30 Esfand Panjshanbeh');
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => {const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob);});
  const zip = X.CFB.read(bytes,{type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'persian.xlsx');
  for (const [r,[value,code]] of cases.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(value);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(back.getValue(back.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
