// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-lunisolar-calendar.json';

afterEach(() => setLocale('en-US'));

it('matches native lunisolar month boundaries, every supported year, names and Rokuyou cycles', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"', '""')}")`), `${value}: ${code}`).toEqual(expected);
  }
}, 30000);

it('keeps missing neutral month names empty without reading an unrelated narrow character', () => {
  for (const { value, code, expected } of native.nativeCorruption) {
    expect(formatWithCode(value, code)).toBe(expected);
    expect(calc(`TEXT(${value},"${code}")`)).toBe(expected);
  }
  for (const calendar of [14,15,17,18,19]) {
    expect(formatWithCode(45331,`[$-${calendar.toString(16)}0000]"before" mmm mmmm mmmmm "after"`)).toBe('before    after');
  }
});

it('separates calendar conversion from elapsed totals, first-tag selection and regional names', () => {
  for (const calendar of [14,15,17,18,19]) {
    const tag = `[$-${calendar.toString(16)}0409]`;
    for (const field of ['yyyy-mm-dd','h:mm:ss','0 AM/PM','0.0E+00 AM/PM']) expect(formatWithCode(60,tag+field)).toBe('#####');
    for (const value of [0,60,2958466]) {
      expect(formatWithCode(value,tag+'[h]')).toBe(String(value*24));
      expect(formatWithCode(value,`B2[$-${calendar.toString(16)}0000][h]`)).toBe(String(value*24));
    }
    expect(formatWithCode(45000,`[<0]${tag}yyyy;[$-60409]yyyy-mm-dd`)).toBe('2023-02-24');
  }
  // Japanese and Chinese resources have independent astronomical month data.
  const date = ymdToSerial(2023,5,25);
  expect(formatWithCode(date,'[$-e0409]yyyy-mm-dd')).toBe('2023-05-06');
  expect(formatWithCode(date,'[$-f0409]yyyy-mm-dd')).toBe('2023-05-07');
  for (const locale of ['en-US','de-DE','fr-FR']) {
    setLocale(locale);
    expect(formatWithCode(44951,'[$-e0409]mmm')).toBe('正月');
    expect(formatWithCode(44951,'[$-e0412]mmm')).toBe('정월');
    expect(formatWithCode(44951,'[$-f0404]mmm')).toBe('一月');
    expect(formatWithCode(44951,'[$-110404]mmm')).toBe('正月');
    expect(formatWithCode(44951,'[$-130404]mmm')).toBe('Jan');
  }
  setLocale('de-DE');
  expect(formatWithCode(44951,'[$-e0000]mmmm')).toBe('Januar');
});

it('preserves lunisolar serials and formats through editing, Undo, public HTML and metadata-free XLSX', async () => {
  const cases = [[44951,'[$-e0412]yyyy-mm-dd mmmm ddd'],[45000,'[$-f0404]yyyy-mm-dd mmmm'],[45000,'B2[$-110409]ddd mmm ddd'],[45331,'[$-120409]yyyy-mm-dd mmm'],[45000,'B2[$-130000]yyyy-mm-dd ddd'],[45000,'[DBNum1][$-f0804]yyyy-mm-dd']];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r,[value,code]] of cases.entries()) {
    wb.setInput(id,r,0,String(value));
    wb.applyStyle(id,{r1:r,r2:r,c1:0,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=TEXT(A${r+1},"${code}")`);
    const html = cellsToHtml([[formatWithCode(value,code)]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value); expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,0,0,'44952');
  expect(wb.getValue(id,0,1)).toBe('2023-01-05 정월 목');
  wb.undo(); expect(wb.getValue(id,0,1)).toBe('2023-01-04 정월 수');
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => {const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob);});
  const zip = X.CFB.read(bytes,{type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'lunisolar.xlsx');
  for (const [r,[value,code]] of cases.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(value);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(back.getValue(back.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
