// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode, formatCodeError, codeDateKind, codeScalesPercent, codeIsFraction } from '../src/core/numfmt.js';
import { editText, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-numeric-meridiem.json';

afterEach(() => setLocale('en-US'));

it('matches native numeric meridiem, locale, field order and rounded-zero results', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code, { textFunction: true }), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    const literal = typeof value === 'string' ? `"${value.replaceAll('"', '""')}"` : String(value);
    expect(calc(`TEXT(${literal},"${code.replaceAll('"', '""')}")`), `${value}: ${code}`).toEqual(expected);
    if (value === 'label') expect(Boolean(formatCodeError(code)), code).toBe(Boolean(expected?.error));
  }
});

it('keeps numeric meridiem formats numeric for editing, input and clipboard classification', () => {
  expect(codeDateKind(.75, '0.00AM/PM')).toBe(null);
  expect(codeDateKind(.75, 'AM/PM')).toBe('time');
  expect(codeScalesPercent(.75, '0%AM/PM')).toBe(true);
  expect(codeIsFraction(.75, '# ?/?AM/PM')).toBe(true);
  expect(codeIsFraction(.75, '0AM/PM/')).toBe(false);
  expect(editText({v:.75,s:{fmt:'custom',code:'0.00AM/PM'}})).toBe('0.75');
  expect(formatWithCode(.49999999, '0.00AM/PM')).toBe('0.50PM');
  expect(formatWithCode(.49999, '0.00AM/PM')).toBe('0.50AM');
  expect(formatWithCode(-.51, '0,AM/PM')).toBe('0PM');
  expect(formatWithCode(-.1, '0;0AM/PM')).toBe('#####');
});

it('separates the tagged period language from numeric decimal marks and untagged A/P case', () => {
  setLocale('de-DE');
  expect(formatWithCode(.75, '[$-411]0.00A/P')).toBe('0,75午後');
  expect(formatWithCode(.75, '0.00a/p')).toBe('0,75p');
  expect(formatWithCode(.75, '[$-zz]0.00a/p')).toBe('0,75p');
  expect(formatWithCode('label', '[$-411]0;0;0;AM/PM@')).toBe('午前label');
  expect(formatWithCode('label', '[$-411]AM/PM@')).toBe('AMlabel');
});

it('preserves values and custom codes through edit/undo, HTML and metadata-free XLSX', async () => {
  const cases = [[.75,'0.00AM/PM','0.75PM'],[.75,'0%AM/PM','75%PM'],[.75,'# ?/?AM/PM',' 3/4PM'],[45000.5,'0.00E+00AM/PM','4.50E+04PM'],[-.51,'0,AM/PM','0PM'],[.75,'[$-411]0A/P','1午後']];
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const [r,[value,code,display]] of cases.entries()) {
    wb.setInput(id,r,0,String(value));
    wb.applyStyle(id,{r1:r,r2:r,c1:0,c2:0},{fmt:'custom',code});
    wb.setInput(id,r,1,`=A${r+1}*2`);
    expect(wb.getDisplay(id,r,0)).toBe(display);
    const html = cellsToHtml([[display]],[[wb.getCell(id,r,0)]],null,[[value]]).replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,'');
    const cell = cellsFromHtmlRows(parseHtmlClipboard(html).rows)[0].cell;
    expect(cell.v).toBe(value); expect(cell.s.code).toBe(code);
    // Excel's HTML copy omits x:num for these formats. With no raw serial,
    // both Excel and this reader retain the displayed label as text.
    const labelOnly = cellsFromHtmlRows(parseHtmlClipboard(html.replace(/ x:num="[^"]*"/g, '')).rows)[0].cell;
    expect(labelOnly.v).toBe(display); expect(labelOnly.s.code).toBe(code);
  }
  wb.setInput(id,0,0,'0.25'); expect(wb.getDisplay(id,0,0)).toBe('0.25AM');
  wb.undo(); expect(wb.getValue(id,0,0)).toBe(.75);
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result)); reader.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes,{type:'array'}), part = X.CFB.find(zip,'/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')); part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'meridiem.xlsx');
  for (const [r,[value,code,display]] of cases.entries()) {
    expect(restored.getValue(restored.activeSheetId,r,0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId,r,0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId,r,0)).toBe(display);
    expect(restored.getValue(restored.activeSheetId,r,1)).toBe(value*2);
  }
});
