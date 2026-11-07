// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode, codeDateKind, codeScalesPercent, codeIsFraction, codeColor, formatCodeError } from '../src/core/numfmt.js';
import { setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-system-date.json';

afterEach(() => setLocale('en-US'));

it('matches native system date/time replacement, declaration inheritance and calendar bounds', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code, { textFunction: true }), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    const literal = typeof value === 'string' ? `"${value}"` : String(value);
    expect(calc(`TEXT(${literal},"${code.replaceAll('"','""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it('uses the selected system pattern when classifying values for input, editing and clipboard', () => {
  expect(codeDateKind(45000, '[$-F800]0%')).toBe('date');
  expect(codeDateKind(45000, '[$-F400]yyyy')).toBe('time');
  expect(codeDateKind(45000, '[<0][$-F800];[$-409]0')).toBe('date');
  expect(codeDateKind(0, '[$-F800];0;0')).toBe(null);
  expect(codeDateKind(45000, '0;[$-F800]yyyy')).toBe(null);
  expect(codeScalesPercent(45000, '[$-F800]0%')).toBe(false);
  expect(codeIsFraction(45000, '[$-F800]# ?/?')).toBe(false);
  expect(codeScalesPercent(-1, '[$-F800];0%')).toBe(true);
  expect(codeColor(45000, '[Red][$-F800]0')).toBe('#ff0000');
});

it.each([
  ['en-US','Wednesday, March 15, 2023','3:04:05 AM'],
  ['en-GB','Wednesday, 15 March 2023','03:04:05'],
  ['de-DE','Mittwoch, 15. März 2023','03:04:05'],
  ['ja-JP','2023年3月15日水曜日','3:04:05'],
  ['ko-KR','2023년 3월 15일 수요일','오전 3:04:05'],
])('follows the app regional setting %s without retaining a stale compiled pattern', (locale, date, time) => {
  setLocale(locale);
  expect(formatWithCode(45000, '[$-F800]yyyy')).toBe(date);
  expect(formatWithCode(45000 + 11045/86400, '[$-F400]yyyy')).toBe(time);
});

it('validates the original pattern before system replacement', () => {
  for (const code of ['[$-F800]0yyyy','[$-F400]ss.0000','[$-F800][h][m]','[$-F800][oops]','[$-F800]0E+','[$-F800][$-409]yyyy']) {
    expect(formatCodeError(code), code).toBeTruthy();
    expect(formatWithCode('text', code)).toBe('#####');
    expect(formatWithCode(45000, code)).toBe('#####');
  }
  expect(formatWithCode(5, '"[$-F800]"0')).toBe('[$-F800]5');
});

it('matches native HTML paste when Excel omits the original date/time serials', () => {
  const html = '<style>.date {mso-number-format:"\\[$-F800\\]yyyy"}.time {mso-number-format:"\\[$-F400\\]yyyy"}</style>'
    + '<table><tr><td class="date">Wednesday, March 15, 2023</td></tr><tr><td class="time">12:00:00 PM</td></tr></table>';
  const cells = cellsFromHtmlRows(parseHtmlClipboard(html).rows).map(entry => entry.cell);
  expect(cells.map(cell => cell.v)).toEqual(['Wednesday, March 15, 2023', 0.5]);
  expect(cells.map(cell => cell.s.code)).toEqual(['[$-F800]yyyy', '[$-F400]yyyy']);
  expect(cells.map(cell => formatWithCode(cell.v, cell.s.code))).toEqual(['Wednesday, March 15, 2023', '12:00:00 PM']);
});

it('keeps a styled string visible when TEXT substitutes a system pattern in its text section', () => {
  const code = '[$-F800];0;0;[$-F400]@';
  expect(formatWithCode('label', code)).toBe('label');
  expect(codeDateKind('label', code)).toBe(null);
  expect(calc(`TEXT("label","${code}")`)).toBe('');
});

it('preserves original system codes and numeric serials across edits, HTML and metadata-free XLSX', async () => {
  const cases = [
    [45000, '[$-F800]yyyy', 'Wednesday, March 15, 2023'],
    [45000.5, '[$-F400]yyyy', '12:00:00 PM'],
    [60, '[$-F800]0', 'Wednesday, February 29, 1900'],
    [45000, '[<0][$-F800];[$-409]0', 'Wednesday, March 15, 2023'],
  ];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r,[value,code,display]] of cases.entries()) {
    wb.setInput(id,r,0,String(value)); wb.applyStyle(id,{r1:r,r2:r,c1:0,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=TEXT(A${r+1},"${code}")`);
    expect(wb.getDisplay(id,r,0)).toBe(display);
    const html=cellsToHtml([[display]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell=cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value); expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,0,0,'45001'); expect(wb.getDisplay(id,0,0)).toBe('Thursday, March 16, 2023');
  wb.undo(); expect(wb.getDisplay(id,0,0)).toBe(cases[0][2]);
  const blob=await workbookToXlsx(wb),bytes=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(new Uint8Array(r.result));r.readAsArrayBuffer(blob);});
  const zip=X.CFB.read(bytes,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  const restored=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'system-date.xlsx');
  for(const [r,[value,code,display]]of cases.entries()){
    expect(restored.getValue(restored.activeSheetId,r,0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId,r,0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId,r,0)).toBe(display);
    expect(restored.getValue(restored.activeSheetId,r,1)).toBe(display);
  }
});
