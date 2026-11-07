// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-hebrew-calendar.json';

afterEach(() => setLocale('en-US'));

it('matches native Hebrew dates, repeated table years, localized names and legacy field orders', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"', '""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it('keeps an absent neutral thirteenth month name empty without corrupting adjacent literals', () => {
  for (const { value, code, expected } of native.nativeCorruption) {
    expect(formatWithCode(value, code)).toBe(expected);
    expect(calc(`TEXT(${value},"${code}")`)).toBe(expected);
  }
  for (const day of [4,15,29]) {
    const value = ymdToSerial(2024,9,day);
    expect(formatWithCode(value,'[$-80000]"before" mmm mmmm mmmmm "after"')).toBe('before    after');
  }
});

it('keeps calendar conversion separate from name-service ranges, clocks, and locale caches', () => {
  for (const [date,expected] of [
    [[2023,3,15],'5783-06-22'], [[2024,3,11],'5784-07-01'],
    [[2238,12,31],'5999-04-25'], [[2239,1,1],'5999-05-01'],
    [[2240,12,31],'6001-04-21'], [[2241,1,1],'6001-04-21'],
    [[9999,12,31],'13760-04-22'],
  ]) expect(formatWithCode(ymdToSerial(...date),'[$-80409]yyyy-mm-dd')).toBe(expected);
  for (const field of ['yyyy-mm-dd','h:mm:ss','0 AM/PM','0.0E+00 AM/PM']) {
    expect(formatWithCode(60,`[$-80409]${field}`)).toBe('#####');
  }
  expect(formatWithCode(60,'[$-80409][h]')).toBe('1440');
  for (const value of [0,60,2958466]) {
    expect(formatWithCode(value,'B2[$-80000][h]')).toBe(String(value * 24));
    expect(calc(`TEXT(${value},"B2[$-80000][h]")`)).toBe(String(value * 24));
  }
  for (const locale of ['en-US','de-DE','fr-FR']) {
    setLocale(locale);
    expect(formatWithCode(45000,'[$-80409]mmm mmmm mmmmm')).toBe('Adar Adar Adar');
    expect(formatWithCode(45000,'[$-8040d]mmm mmmm mmmmm')).toBe('אדר אדר אדר');
    expect(formatWithCode(45000,'B2[$-80409]ddd mmm ddd')).toBe('Wed آذار الأول جمعة');
    expect(formatWithCode(45000,'[$-2080401]yyyy-mm-dd')).toBe('٥٧٨٣-٠٦-٢٢');
    expect(formatWithCode(45000,'[$-80409]mmm')).toBe('Adar');
  }
  expect(formatWithCode(45000,'[<0][$-80409]yyyy;[$-60409]yyyy-mm-dd')).toBe('5783-06-22');
  const future=ymdToSerial(4503,1,1);
  expect(formatWithCode(future,'[$-80409]mmmm')).toBe('#####');
  expect(formatWithCode(future,'B2[$-80409]mmm')).toBe('طيفت');
  expect(formatWithCode(future,'B2[$-80000]ddd')).toBe('#####');
  expect(formatWithCode(ymdToSerial(2240,1,1),'[$-8040d]mmmm')).toBe('#####');
  expect(formatWithCode(ymdToSerial(2240,1,1),'[$-8040d]yyyy-mm-dd')).toBe('6000-04-11');
});

it('retains serial dates and Hebrew formats through edit, Undo, external HTML and metadata-free XLSX', async () => {
  const cases = [[45361,'[$-80409]yyyy-mm-dd mmmm ddd'],[45000,'[$-8040d]yyyy-mm-dd mmmm'],[45000,'B2[$-80409]ddd mmm ddd'],[45000,'[$-80000]yyyy-mm-dd mmm'],[45000,'[DBNum1][$-80804]yyyy-mm-dd']];
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
  wb.setInput(id,0,0,'45362');
  expect(wb.getValue(id,0,1)).toBe('5784-07-01 AdarII Mon');
  wb.undo(); expect(wb.getValue(id,0,1)).toBe('5784-06-30 AdarI Sun');
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => {const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob);});
  const zip = X.CFB.read(bytes,{type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'hebrew.xlsx');
  for (const [r,[value,code]] of cases.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(value);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(back.getValue(back.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
