// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import boundaries from './fixtures/reference-hijri-month-boundaries.json';
import labels from './fixtures/reference-hijri-labels.json';

it('matches native dates on both sides of every month boundary across the Hijri leap cycle', () => {
  for (const [value, expected] of boundaries.cases) {
    expect(formatWithCode(value, 'b2yyyy-mm-dd'), String(value)).toBe(expected);
  }
});

it('matches native calendar vocabulary and its field-order rules', () => {
  for (const [value, code, expected] of labels.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"', '""')}")`), code).toEqual(expected);
  }
});

const native = [
  [0, 'b2yyyy-mm-dd dddd', '1317-08-29 السبت'],
  [1, 'b2yyyy-mm-dd dddd', '1317-08-29 الأحد'],
  [2, 'b2yyyy-mm-dd', '1317-09-01'], [59, 'b2yyyy-mm-dd', '1317-10-28'],
  [61, 'b2yyyy-mm-dd', '1317-10-29'], [36526, 'b2yyyy-mm-dd', '1420-09-25'],
  [45000, 'b2yyyy-mm-dd', '1444-08-23'], [45007, 'b2yyyy-mm-dd', '1444-09-01'],
  [45306, 'b2yyyy-mm-dd', '1445-07-05'], [100000, 'b2yyyy-mm-dd', '1599-11-08'],
  [1000000, 'b2yyyy-mm-dd', '4139-08-05'], [2958465, 'b2yyyy-mm-dd', '9666-04-03'],
  [45000, 'b2g e bbbb', ' 1444 1987'], [45000, 'b2[$-409]yyyy e bbbb', '1444 1444 1444'],
  [45000, '[$-409]b2yyyy', '2023'], [45000, 'b1[$-60401]yyyy', '1444'],
  [45000, '[$-7041E]yyyy e bbbb ggge', '2566 2023 2566 2023'],
  [45000, 'b2[$-7041E]yyyy e bbbb', '3109 2566 3109'],
  [45000, 'b2yyyy[$-7041E]', '2566'], [45000, 'b2[$-10409]yyyy e bbbb', '2023 2023 2023'],
  [45000, 'yyyy[$-60401]yyyy', '14441444'],
  [45000, '[<0][$-60401]yyyy;yyyy', '1444'],
  [45000, '[<0][$-7041E]yyyy;yyyy', '2023'],
  [45000, '[<0]yyyy;[$-60401]yyyy', '2023'],
  [45000, '[<0][$-411]ggge;ggge', '令和5'],
  [45000, '[<0]ggge;[$-411]ggge', '2023'],
  [45000, '[<0][$-409]bbbb;bbbb', '2566'],
  [45000, '[<0]bbbb;[$-409]bbbb', '2023'],
  [45000 + 12345.6789 / 86400, 'b2yyyy h:mm:ss.000', '1444 3:25:45.679'],
  [45000 + 12345.6789 / 86400, 'b2.000', '.679'],
];
it.each(native)('formats %s with calendar code %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
  expect(calc(`TEXT(${value},"${code}")`)).toBe(expected);
});

it.each(['b2yyyy', 'b2h:mm:ss', 'b2.000', 'b2g', 'b2AM/PM', '[$-60401]yyyy'])('rejects nonexistent Hijri calendar dates for %s', code => {
  for (const value of [-1, 60, 2958466]) {
    expect(formatWithCode(value, code)).toBe('#####');
    expect(calc(`TEXT(${value},"${code}")`)).toEqual({ error:'#VALUE!' });
  }
});

it('does not apply calendar bounds to pure elapsed totals or literal fields', () => {
  expect(formatWithCode(60, 'b2[h]')).toBe('1440');
  expect(formatWithCode(-1, 'b2[h]')).toBe('-24');
  expect(formatWithCode(2958466, 'b2[h]')).toBe('71003184');
  expect(formatWithCode(60, 'b2"x"')).toBe('x');
  expect(formatWithCode(60, '[$-409]b2yyyy')).toBe('1900');
});

it('preserves serials, calendar codes and formulas through edits, HTML and metadata-free XLSX', async () => {
  const cases = native.filter(([,code]) => ['b2yyyy-mm-dd', 'b2g e bbbb', '[$-7041E]yyyy e bbbb ggge'].includes(code));
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r, [value, code, expected]] of cases.entries()) {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, {r1:r,r2:r,c1:0,c2:0}, {fmt:'custom',code});
    wb.setInput(id, r, 1, `=TEXT(A${r+1},"${code}")`);
    expect(wb.getDisplay(id,r,0)).toBe(expected);
    const html = cellsToHtml([[expected]], [[wb.getCell(id,r,0)]], null, [[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value); expect(cell.s.code).toBe(code);
  }
  wb.setInput(id,0,0,'45000'); expect(wb.getValue(id,0,1)).toBe('1444-08-23');
  wb.undo(); expect(wb.getValue(id,0,1)).toBe(cases[0][2]);
  const blob=await workbookToXlsx(wb), bytes=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(new Uint8Array(r.result));r.readAsArrayBuffer(blob);});
  const zip=X.CFB.read(bytes,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  const restored=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'hijri.xlsx');
  for(const [r,[value,code,expected]]of cases.entries()){
    expect(restored.getValue(restored.activeSheetId,r,0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId,r,0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId,r,0)).toBe(expected);
    expect(restored.getValue(restored.activeSheetId,r,1)).toBe(expected);
  }
});
