// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-saka-calendar.json';

afterEach(() => setLocale('en-US'));

it('matches native Saka dates, name resources, year boundaries and legacy field orders', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"', '""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it('uses Gregorian leap rules at the Saka new year and preserves date-serial validity', () => {
  for (const [year, start] of [[1900,22],[1904,21],[2000,21],[2023,22],[2024,21],[2100,22],[2400,21]]) {
    const first = ymdToSerial(year,3,start);
    expect(formatWithCode(first,'[$-100409]yyyy-mm-dd')).toBe(`${year-78}-01-01`);
    expect(formatWithCode(first-1,'[$-100409]yyyy-mm-dd')).toBe(`${year-79}-12-30`);
    expect(formatWithCode(ymdToSerial(year,4,21),'[$-100409]yyyy-mm-dd')).toBe(`${year-78}-02-01`);
  }
  expect(formatWithCode(0,'[$-100409]yyyy-mm-dd ddd')).toBe('1821-10-11 Sani');
  expect(formatWithCode(1,'[$-100409]yyyy-mm-dd ddd')).toBe('1821-10-11 Ravi');
  for (const field of ['yyyy-mm-dd','h:mm:ss','0 AM/PM','0.0E+00 AM/PM']) {
    expect(formatWithCode(60,`[$-100409]${field}`)).toBe('#####');
  }
  expect(formatWithCode(60,'[$-100409][h]')).toBe('1440');
  expect(formatWithCode(2958465,'[$-100409]yyyy-mm-dd')).toBe('9921-10-10');
});

it('keeps calendar conversion separate from neutral names, numeral shaping and B2 name state', () => {
  for (const locale of ['en-US','de-DE','fr-FR']) {
    setLocale(locale);
    expect(formatWithCode(45000,'[$-100409]yyyy-mm-dd mmmm ddd')).toBe('1944-12-24 Phalguna Budh');
    expect(formatWithCode(45000,'[$-100439]mmmm ddd')).toBe('फल्गुण बुधवार');
    expect(formatWithCode(45000,'B2[$-100409]ddd mmm ddd')).toBe('Budh फल्गुण शनिवार');
    expect(formatWithCode(45000,'B2[$-100000]yyyy-mm-dd mmm ddd')).toBe('1944-12-24 फल्गुण الأربعاء');
    expect(formatWithCode(45000,'[$-2100439]yyyy-mm-dd')).toBe('١٩٤٤-١٢-٢٤');
  }
  setLocale('en-US');
  expect(formatWithCode(45000,'[$-100000]mmmm ddd')).toBe('December Wed');
  setLocale('de-DE');
  expect(formatWithCode(45000,'[$-100000]mmmm ddd')).toBe('Dezember Mi');
  expect(formatWithCode(45000,'[<0][$-100409]yyyy;[$-60409]yyyy-mm-dd')).toBe('1944-12-24');
});

it('retains serial dates and Saka formats through edit, Undo, external HTML and metadata-free XLSX', async () => {
  const cases = [[45371,'[$-100409]yyyy-mm-dd mmmm ddd'],[45000,'[$-100439]yyyy-mm-dd mmmm'],[45000,'B2[$-100409]ddd mmm ddd'],[45000,'[$-100000]yyyy-mm-dd mmm'],[45000,'[DBNum1][$-100804]yyyy-mm-dd']];
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
  wb.setInput(id,0,0,'45372');
  expect(wb.getValue(id,0,1)).toBe('1946-01-01 Chaitra Guru');
  wb.undo(); expect(wb.getValue(id,0,1)).toBe('1945-12-30 Phalguna Budh');
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => {const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob);});
  const zip = X.CFB.read(bytes,{type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'saka.xlsx');
  for (const [r,[value,code]] of cases.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(value);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(back.getValue(back.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
