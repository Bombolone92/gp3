// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatDate, formatTime, formatValue, serialToYMD, editText, parseInput, setLocale, styleToNumFmt } from '../src/core/format.js';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { calc, calcValues } from './helpers/calc.js';
import * as X from '../src/vendor/xlsx.mjs';

afterEach(() => setLocale('en-US'));

// Checked against desktop Excel. Clock fields add half a
// second in serial space; hidden seconds never imply minute/hour rounding.
it.each([
  [0, 59.49, '00:00:59'], [0, 59.5, '00:00:59'], [0, 59.51, '00:01:00'],
  [0, 3599.49, '00:59:59'], [0, 3599.5, '01:00:00'],
  [2, 43199.5, '12:00:00'], [2, 86399.49, '23:59:59'], [2, 86399.5, '00:00:00'],
  [45000, 30, '00:00:30'], [45000, 86399.49, '23:59:59'],
  [2958465, 43199.5, '12:00:00'],
])('extracts clock fields for day %s plus %s seconds', (day, seconds, expected) => {
  const v = day + seconds / 86400;
  const [h,m,s] = expected.split(':').map(Number);
  expect(formatTime(v, true)).toBe(expected);
  expect(formatTime(v)).toBe(expected.slice(0, 5));
  expect(formatWithCode(v, 'hh:mm:ss')).toBe(expected);
  expect(formatWithCode(v, 'hh:mm')).toBe(expected.slice(0, 5));
  expect(formatWithCode(v, 'h')).toBe(String(h));
  expect(formatWithCode(v, 'h AM/PM')).toBe(`${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`);
  for (const [fn,n] of [['HOUR',h],['MINUTE',m],['SECOND',s]]) expect(calcValues(`${fn}(A1)`, {A1:v})).toBe(n);
});

it.each([
  [0,'1900-01-01',1,1], [31,'1900-02-01',1,4],
  [59,'1900-02-29',29,4], [60,'1900-03-01',1,5],
  [45000,'2023-03-16',16,5], [2958464,'9999-12-31',31,6],
])('carries the half second into date fields after serial %s', (day, iso, date, weekday) => {
  for (const gap of [.5001,.5,.4999]) {
    const v = day + 1 - gap / 86400;
    const carries = gap <= .5;
    const before = formatDate(day);
    expect(formatDate(v)).toBe(carries ? iso : before);
    expect(formatWithCode(v, 'yyyy-mm-dd')).toBe(carries ? iso : before);
    expect(formatValue(v, {fmt:'datetime'})).toBe(`${carries ? iso : before} ${carries ? '00:00' : '23:59'}`);
    expect(calcValues('DAY(A1)', {A1:v})).toBe(carries ? date : serialToYMD(day).d);
    expect(calcValues('MONTH(A1)', {A1:v})).toBe(Number((carries ? iso : before).slice(5,7)));
    expect(calcValues('YEAR(A1)', {A1:v})).toBe(Number((carries ? iso : before).slice(0,4)));
    expect(calcValues('WEEKDAY(A1)', {A1:v})).toBe(carries ? weekday : serialToYMD(day).weekday + 1);
    expect(calcValues('EDATE(A1,0)', {A1:v})).toBe(calc(`EDATE(${day},0)`));
    expect(calcValues('EOMONTH(A1,0)', {A1:v})).toBe(calc(`EOMONTH(${day},0)`));
    expect(serialToYMD(v)).toEqual(serialToYMD(day));
  }
});

it('checks the calendar limit after rounding and retains fractional-second precision', () => {
  const v = 2958465 + 86399.5 / 86400;
  for (const code of ['yyyy-mm-dd','hh:mm','hh:mm:ss']) {
    expect(formatWithCode(v, code)).toBe('#####');
    expect(calcValues('TEXT(A1,B1)', {A1:v,B1:code})).toEqual({error:'#VALUE!'});
  }
  for (const fn of ['YEAR','MONTH','DAY','WEEKDAY','HOUR','MINUTE','SECOND']) expect(calcValues(`${fn}(A1)`, {A1:v})).toEqual({error:'#NUM!'});
  expect(formatWithCode(v, 'yyyy-mm-dd hh:mm:ss.0')).toBe('9999-12-31 23:59:59.5');
  expect(formatWithCode(59.5 / 86400, 'hh:mm:ss.000')).toBe('00:00:59.500');
  expect(formatWithCode(60 + 86399.9999 / 86400, 'yyyy-mm-dd hh:mm:ss.000')).toBe('1900-03-01 00:00:00.000');
  setLocale('de-DE');
  expect(formatDate(59 + 86399.6/86400, 'medium')).toBe('29.02.1900');
});

it('keeps raw serial precision through editing, portable clipboard and XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const values = [59.5/86400, 45000+30/86400, 59+86399.6/86400, 2958465+86399.5/86400];
  for (const [r,v] of values.entries()) {
    const style = r % 2 ? {fmt:'datetime'} : {fmt:'custom',code:'hh:mm'};
    wb.setInput(id,r,0,v,{literal:true,style});
    wb.setInput(id,r,1,`=SECOND(A${r+1})`);
    const cell = wb.getCell(id,r,0);
    // The formula bar follows the application's 15-significant-digit input policy.
    expect(parseInput(editText(cell)).v.toPrecision(15)).toBe(v.toPrecision(15));
    const html = cellsToHtml([[wb.getDisplay(id,r,0)]],[[cell]],null,[[v]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(pasted.v).toBe(v);
    expect(styleToNumFmt(pasted.s)).toBe(styleToNumFmt(style));
  }
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const reader=new FileReader(); reader.onload=()=>resolve(new Uint8Array(reader.result)); reader.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes,{type:'array'}), part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size=part.content.length;
  const restored=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'clocks.xlsx');
  for(const [r,v] of values.entries()) {
    expect(restored.getValue(restored.activeSheetId,r,0)).toBe(v);
    expect(restored.getDisplay(restored.activeSheetId,r,0)).toBe(wb.getDisplay(id,r,0));
    expect(restored.getValue(restored.activeSheetId,r,1)).toEqual(wb.getValue(id,r,1));
  }
});
