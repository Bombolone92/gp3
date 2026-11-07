// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { dateToSerial, serialToDate, serialToYMD, ymdToSerial, formatDate, parseInput, setLocale, styleToNumFmt, editText } from '../src/core/format.js';
import { formatWithCode } from '../src/core/numfmt.js';
import { calc } from './helpers/calc.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { calendarDays, serialToParts, partsToSerial } from '../src/ui/datepicker.js';
import { chartDateAxis } from '../src/core/chart-date-axis.js';
import * as X from '../src/vendor/xlsx.mjs';

afterEach(() => setLocale('en-US'));

// Control dates checked against desktop Excel, including the Lotus-compatible weekdays.
const dates = [
  [0,1900,1,0,6], [1,1900,1,1,0], [2,1900,1,2,1], [31,1900,1,31,2],
  [32,1900,2,1,3], [58,1900,2,27,1], [59,1900,2,28,2], [60,1900,2,29,3],
  [61,1900,3,1,4], [366,1900,12,31,1], [367,1901,1,1,2], [1462,1904,1,1,5],
  [36526,2000,1,1,6], [45351,2024,2,29,4], [2958465,9999,12,31,5],
];
it.each(dates)('preserves calendar fields and weekday for serial %s', (n,y,m,d,weekday) => {
  expect(serialToYMD(n)).toEqual({y,m,d,weekday});
  expect(serialToYMD(n+.5)).toEqual({y,m,d,weekday});
  expect(ymdToSerial(y,m,d)).toBe(n);
  const iso = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  expect(formatDate(n)).toBe(iso);
  expect(formatWithCode(n, 'yyyy-mm-dd')).toBe(iso);
  expect(calc(`TEXT(${n},"yyyy-mm-dd")`)).toBe(iso);
  for (const [fn, expected] of [['YEAR',y],['MONTH',m],['DAY',d],['WEEKDAY',weekday+1]]) expect(calc(`${fn}(${n})`)).toBe(expected);
  if (n) expect(parseInput(iso).v).toBe(n);
});
it('bridges real Gregorian instants without changing sub-day precision', () => {
  for (const [n,y,m,d] of dates.filter(([n])=>n!==0&&n!==60)) {
    for (const fraction of [0,.125,.5,.75]) {
      const dt = new Date(Date.UTC(y,m-1,d)+fraction*86400000);
      expect(dateToSerial(dt)).toBe(n+fraction);
      expect(serialToDate(n+fraction).getTime()).toBe(dt.getTime());
    }
  }
  expect(serialToDate(0).toISOString()).toBe('1899-12-31T00:00:00.000Z');
  expect(serialToDate(60).toISOString()).toBe('1900-02-28T00:00:00.000Z');
  expect(Number.isNaN(serialToYMD(Infinity).y)).toBe(true);
  expect(Number.isNaN(dateToSerial(new Date(NaN)))).toBe(true);
});
it.each(['en-US','de-DE','fr-FR','ja-JP','ru-RU'])('localizes fictitious days in %s without normalizing them away', locale => {
  setLocale(locale);
  for (const style of ['medium','long']) {
    const formatter = new Intl.DateTimeFormat(locale,{dateStyle:style,timeZone:'UTC'});
    for (const [n,m,d] of [[0,1,0],[60,2,29]]) {
      const expected = formatter.formatToParts(new Date(Date.UTC(1900,m-1,1))).map(p=>p.type==='day'?String(d):p.value).join('');
      expect(formatDate(n,style)).toBe(expected);
    }
  }
});
it('normalizes day overflow in serial space and distinguishes arithmetic month ends', () => {
  const cases = [
    ['DATE(1900,1,0)',0],['DATE(1900,1,60)',60],['DATE(1900,2,29)',60],
    ['DATE(1900,2,30)',61],['DATE(1900,3,0)',60],['DATE(1900,3,-1)',59],
    ['DATE(1900,13,0)',366],['DATE(1900,0,60)',{error:'#NUM!'}],
    ['DATEVALUE("1900-02-29")',60],['DATEVALUE("1899-12-31")',{error:'#VALUE!'}],
    ['EDATE(0,1)',31],['EDATE(31,1)',59],['EDATE(60,0)',59],['EDATE(60,1)',89],
    ['EDATE(31,-1)',{error:'#NUM!'}],['EOMONTH(0,-1)',{error:'#NUM!'}],['EOMONTH(1,-1)',{error:'#NUM!'}],['EOMONTH(31,-1)',{error:'#NUM!'}],
    ['EOMONTH(0,1)',59],['EOMONTH(60,0)',59],['EOMONTH(61,-1)',59],
    ['WORKDAY(59,1)',60],['WORKDAY(60,1)',61],['WORKDAY(61,2)',65],
    ['DAYS360(59,60)',1],['DAYS360(59,61)',3],['DAYS360(60,61)',1],
    ['YEARFRAC(59,60)',-1/360],['YEARFRAC(59,61)',1/360],['YEARFRAC(60,61)',2/360],
  ];
  for (const [formula,value] of cases) expect(calc(formula), formula).toEqual(value);
  for (let n=0;n<800;n++) { const {y,m,d}=serialToYMD(n); expect(ymdToSerial(y,m,d)).toBe(n); }
  expect(parseInput('2100-02-29').v).toBe('2100-02-29');
  expect(parseInput('2000-02-29').v).toBe(36585);
  expect(formatDate(calc('DATE(2100,2,29)'))).toBe('2100-03-01');
  expect(ymdToSerial(1900,0,32)).toBe(1); // helper supports proleptic chart boundaries; DATE validates its month
});
it('uses the same calendar in picker and date-axis geometry', () => {
  for (const [n,y,m,d] of dates) { expect(serialToParts(n)).toEqual({y,m,d}); expect(partsToSerial(y,m,d)).toBe(n); }
  const feb=calendarDays(1900,2), leap=feb.findIndex(x=>x.m===2&&x.d===29);
  expect(feb[leap+1]).toEqual({y:1900,m:3,d:1,other:true});
  expect(leap % 7).toBe(2); // Wednesday in the 1900 system's weekday sequence
  expect(calendarDays(1900,1)).toContainEqual({y:1900,m:1,d:0,other:false});
  const axis=chartDateAxis([0,1,59,60,61],{min:0,max:61});
  expect(axis.span).toBe(62); expect(axis.ticks()).toEqual(Array.from({length:62},(_,i)=>i));
  expect(axis.fraction(60)-axis.fraction(59)).toBeCloseTo(1/62);
});
it('retains serial dates through native XLSX and clipboard, edits and undo', async () => {
  const wb=new Workbook(), id=wb.activeSheetId;
  for(const [r,[n]] of dates.entries()) {
    wb.setInput(id,r,0,n,{literal:true,style:{fmt:'custom',code:'yyyy-mm-dd'}});
    wb.setInput(id,r,1,`=DAY(A${r+1})`);
    const display=wb.getDisplay(id,r,0), cell=wb.getCell(id,r,0);
    expect(parseInput(editText(cell)).v).toBe(n);
    const html=cellsToHtml([[display]],[[cell]],null,[[n]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const pasted=cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(pasted.v).toBe(n); expect(styleToNumFmt(pasted.s)).toBe('yyyy-mm-dd');
  }
  wb.setInput(id,7,0,'1900-03-01'); expect(wb.getValue(id,7,0)).toBe(61); wb.undo(); expect(wb.getValue(id,7,0)).toBe(60);
  const blob=await workbookToXlsx(wb), bytes=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(new Uint8Array(r.result));r.readAsArrayBuffer(blob);});
  const zip=X.CFB.read(bytes,{type:'array'}), part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  const restored=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'calendar.xlsx');
  for(const [r,[n,, ,d]] of dates.entries()) { expect(restored.getValue(restored.activeSheetId,r,0)).toBe(n);expect(restored.getDisplay(restored.activeSheetId,r,0)).toBe(wb.getDisplay(id,r,0));expect(restored.getValue(restored.activeSheetId,r,1)).toBe(d); }
});
