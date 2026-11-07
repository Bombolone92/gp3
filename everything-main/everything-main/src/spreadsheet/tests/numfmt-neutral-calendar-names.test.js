// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { setLocale, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-neutral-calendar-names.json';

afterEach(() => setLocale('en-US'));

it('matches native neutral-calendar month and weekday selection, transitions and boundaries', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value,code),`${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"','""')}")`),`${value}: ${code}`).toEqual(expected);
  }
});

it('distinguishes neutral calendar defaults from explicit languages without sharing mutable name state', () => {
  for (const locale of ['en-US','de-DE','fr-FR']) {
    setLocale(locale);
    expect(formatWithCode(45583,'[$-40000]mmmm ddd')).toBe(formatWithCode(45583,'mmmm ddd'));
    expect(formatWithCode(45583,'B2[$-10000]ddd mmm ddd')).toBe('الجمعة أكتوبر الجمعة');
    expect(formatWithCode(45583,'B2[$-10409]ddd mmm ddd')).toBe('Fri أكتوبر السبت');
    expect(formatWithCode(45583,'B2[$-60000]mmmm ddd mmm ddd')).toBe('ربيع\u00a0الثاني الجمعة ربيع\u00a0الثاني الأربعاء');
    expect(formatWithCode(45583,'B2[$-70000]mmmm ddd mmm ddd')).toBe('ตุลาคม ศ. أكتوبر سبت');
    expect(formatWithCode(45583,'B2[$-40000]mmmm ddd')).toBe('十月 الجمعة');
    expect(formatWithCode(45583,'[$-40409]mmmm ddd')).toBe('十月 週五');
  }
});

it('uses calendar validity and era conversion for neutral weekday names while preserving ordinary dates', () => {
  expect(formatWithCode(0,'B2[$-10000]d ddd')).toBe('1 الإثنين');
  expect(formatWithCode(0,'B2[$-20409]d ddd')).toBe('1 Sat');
  expect(formatWithCode(0,'[$-20409]d ddd')).toBe('0 Sat');
  expect(formatWithCode(ymdToSerial(1933,10,18),'B2[$-30000]ddd')).toBe('الأحد');
  expect(formatWithCode(ymdToSerial(1933,10,18),'B2[$-30409]ddd')).toBe('Wed');
  expect(formatWithCode(ymdToSerial(2016,2,29),'B2[$-30000]ddd')).toBe('الخميس');
  expect(formatWithCode(45583,'B2[$-50000]ddd')).toBe('#####');
  expect(formatWithCode(45583,'B2[$-50000]"ddd" mmmm')).toBe('ddd October');
  expect(formatWithCode(45583,'B2[$-50409]ddd')).toBe('Fri');
  expect(formatWithCode(ymdToSerial(1911,12,31),'B2[$-40409]h:mm')).toBe('#####');
  expect(formatWithCode(ymdToSerial(1912,1,1),'B2[$-40000]ddd')).toBe('الإثنين');
  expect(formatWithCode(1,'B2[$-40000][h]')).toBe('24');
});

it('retains neutral calendar semantics through edits, typed HTML and metadata-free XLSX', async () => {
  const examples = [[45583,'[$-40000]ddd mmmm'],[1,'B2[$-10000]d mmmm ddd'],[45583,'B2[$-20000]mmmm ddd mmm ddd'],[ymdToSerial(1933,10,18),'B2[$-30000]ddd mmmm'],[45583,'B2[$-40000]mmmm ddd'],[45583,'B2[$-50000]mmmm'],[45583,'B2[$-60000]mmmm ddd mmm ddd'],[45583,'B2[$-70000]mmmm ddd mmm ddd']];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r,[value,code]] of examples.entries()) {
    wb.setInput(id,r,0,String(value)); wb.applyStyle(id,{r1:r,c1:0,r2:r,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=TEXT(A${r+1},"${code}")`);
    const html = cellsToHtml([[formatWithCode(value,code)]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value); expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,1,0,'2'); expect(wb.getValue(id,1,1)).toBe('2 يناير الثلاثاء');
  wb.undo(); expect(wb.getValue(id,1,1)).toBe('1 يناير الإثنين');
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes,{type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'neutral-calendar.xlsx');
  for (const [r,[value,code]] of examples.entries()) {
    expect(back.getValue(back.activeSheetId,r,0)).toBe(value);
    expect(back.styleAt(back.activeSheetId,r,0).code).toBe(code);
    expect(back.getDisplay(back.activeSheetId,r,0)).toBe(formatWithCode(value,code));
    expect(back.getValue(back.activeSheetId,r,1)).toBe(formatWithCode(value,code));
  }
});
