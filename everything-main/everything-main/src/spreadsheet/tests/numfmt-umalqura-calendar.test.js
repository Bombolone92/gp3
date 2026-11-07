// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-umalqura-calendar.json';

afterEach(() => setLocale('en-US'));

it('matches native Umm al-Qura dates, name resources, year boundaries and legacy field orders', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"', '""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it('uses published lunar months within the table and tabular Hijri outside it', () => {
  for (const [date,expected] of [
    [[1900,4,29],'1317-12-29'], [[1900,4,30],'1318-01-01'],
    [[2029,5,13],'1450-12-29'], [[2029,5,14],'1451-01-01'],
    [[2029,7,12],'1451-03-01'], [[2023,3,22],'1444-08-30'],
    [[2023,3,23],'1444-09-01'], [[9999,12,31],'9666-04-03'],
  ]) expect(formatWithCode(ymdToSerial(...date),'[$-170409]yyyy-mm-dd')).toBe(expected);
  expect(formatWithCode(0,'[$-170409]yyyy-mm-dd ddd')).toBe('1317-08-29 Sat');
  expect(formatWithCode(1,'[$-170409]yyyy-mm-dd ddd')).toBe('1317-08-29 Sun');
  for (const field of ['yyyy-mm-dd','h:mm:ss','0 AM/PM','0.0E+00 AM/PM']) {
    expect(formatWithCode(60,`[$-170409]${field}`)).toBe('#####');
  }
  expect(formatWithCode(60,'[$-170409][h]')).toBe('1440');
});

it('keeps calendar-specific name resources separate across locales and legacy transitions', () => {
  for (const locale of ['en-US','de-DE','fr-FR']) {
    setLocale(locale);
    expect(formatWithCode(45000,'[$-170409]yyyy-mm-dd mmmm dddd')).toBe('1444-08-23 Shaʻban Wednesday');
    expect(formatWithCode(45000,'[$-170429]mmmm dddd')).toBe('شعبان چهار شنبه');
    expect(formatWithCode(45000,'[$-170421]mmm mmmm dddd')).toBe('Sya. Syakban Rabu');
    expect(formatWithCode(45000,'B2[$-170409]ddd mmm ddd')).toBe('Wed شعبان السبت');
    expect(formatWithCode(45000,'B2[$-170000]yyyy-mm-dd mmm ddd')).toBe('1444-08-23 شعبان السبت');
    expect(formatWithCode(45000,'[$-2170401]yyyy-mm-dd')).toBe('١٤٤٤-٠٨-٢٣');
    expect(formatWithCode(45000,'[$-170000]mmmm ddd')).toBe('شعبان الأربعاء');
    // Visiting either resource must not mutate the other calendar's cache.
    expect(formatWithCode(45314,'[$-60429]ddd')).toBe('سه شنبه');
    expect(formatWithCode(45314,'[$-170429]ddd')).toBe('سه شنبه');
    expect(formatWithCode(45314,'[$-60429]ddd')).toBe('سه شنبه');
  }
  expect(formatWithCode(45000,'[<0][$-170409]yyyy;[$-60409]yyyy-mm-dd')).toBe('1444-08-23');
});

it('retains serial dates and Umm al-Qura formats through edit, Undo, external HTML and metadata-free XLSX', async () => {
  const cases = [[45007,'[$-170409]yyyy-mm-dd mmmm ddd'],[45000,'[$-170429]yyyy-mm-dd mmmm'],[45000,'B2[$-170409]ddd mmm ddd'],[45000,'[$-170000]yyyy-mm-dd mmm'],[45000,'[DBNum1][$-170804]yyyy-mm-dd']];
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
  wb.setInput(id,0,0,'45008');
  expect(wb.getValue(id,0,1)).toBe('1444-09-01 Ramadan Thu');
  wb.undo(); expect(wb.getValue(id,0,1)).toBe('1444-08-30 Shaʻban Wed');
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => {const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob);});
  const zip = X.CFB.read(bytes,{type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'umalqura.xlsx');
  for (const [r,[value,code]] of cases.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(value);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(back.getValue(back.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
