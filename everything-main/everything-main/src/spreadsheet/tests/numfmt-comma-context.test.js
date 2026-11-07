// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { editText, setLocale } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

afterEach(() => setLocale('en-US'));

// TEXT results measured in desktop Excel: comma runs, literal boundaries,
// digit fields, scientific magnitude, dates, conditions, locale tags and fill.
const native = [
  [0,",?/?",",0/1"],
  [2.75,",?/?",",11/4"],
  [0,"?/?x,,","0/1x,"],
  [2.75,"?/?x,,","11/4x,"],
  [0,"?/?\"\",","0/1,"],
  [2.75,"?/?\"\",","11/4,"],
  [0,"?/?*x,","0/1,"],
  [2.75,"?/?*x,","11/4,"],
  [0,"?/?\\,,","0/1,,"],
  [2.75,"?/?\\,,","11/4,,"],
  [0,",,0",",0"],
  [2.75,",,0",",3"],
  [1234567.89,",,0",",1234568"],
  [0,"0x,,,","0x,"],
  [2.75,"0x,,,","3x,"],
  [1234567.89,"0x,,,","1234568x,"],
  [0,"0,,,x","0x"],
  [2.75,"0,,,x","0x"],
  [1234567.89,"0,,,x","0x"],
  [0,"0,\"x\"00","0x00"],
  [2.75,"0,\"x\"00","0x03"],
  [1234567.89,"0,\"x\"00","12345x68"],
  [0,"0x,00","0x,00"],
  [2.75,"0x,00","0x,03"],
  [1234567.89,"0x,00","12345x,68"],
  [0,"0,0","00"],
  [2.75,"0,0","03"],
  [1234567.89,"0,0","1,234,568"],
  [0,"0.0,0","0.00"],
  [2.75,"0.0,0","2.75"],
  [1234567.89,"0.0,0","1234567.89"],
  [0,"0.0x,0","0.0x,0"],
  [2.75,"0.0x,0","2.7x,5"],
  [1234567.89,"0.0x,0","1234567.8x,9"],
  [0,".0,",".0"],
  [2.75,".0,",".0"],
  [1234567.89,".0,","1234.6"],
  [0,",.0",",.0"],
  [2.75,",.0",",2.8"],
  [1234567.89,",.0",",1234567.9"],
  [0,"0E+00,","0E+00"],
  [2.75,"0E+00,","3E+00"],
  [1234567.89,"0E+00,","1E+06"],
  [0,"0,E+00","0E+00"],
  [2.75,"0,E+00","3E+00"],
  [1234567.89,"0,E+00","1E+06"],
  [0,"0[Red],","0"],
  [2.75,"0[Red],","0"],
  [1234567.89,"0[Red],","1235"],
  [0,"0[$-409],","0,"],
  [2.75,"0[$-409],","3,"],
  [1234567.89,"0[$-409],","1234568,"],
  [0,"0* ,","0,"],
  [2.75,"0* ,","3,"],
  [1234567.89,"0* ,","1234568,"],
  [0,"0_,,","0 ,"],
  [2.75,"0_,,","3 ,"],
  [1234567.89,"0_,,","1234568 ,"],
  [0,"0\\,,","0,,"],
  [2.75,"0\\,,","3,,"],
  [1234567.89,"0\\,,","1234568,,"],
  [0,"?/?[$-409],","0/1,"],
  [2.75,"?/?[$-409],","11/4,"],
  [1234567.89,"?/?[$-409],","11111111/9,"],
  [0,"?/?\"x\",,0","0/1x,0"],
  [2.75,"?/?\"x\",,0","11/4x,0"],
  [1234567.89,"?/?\"x\",,0","11111111/9x,0"],
  [0,"?/?\"x\",0,","0/1x,0"],
  [2.75,"?/?\"x\",0,","#VALUE!"],
  [1234567.89,"?/?\"x\",0,","#VALUE!"],
  [0,"?/?\"x\",0x,","0/1x,0x,"],
  [2.75,"?/?\"x\",0x,","11/4x,0x,"],
  [1234567.89,"?/?\"x\",0x,","11111111/9x,0x,"],
  [0,"[>1],0;0","0"],
  [2.75,"[>1],0;0",",3"],
  [1234567.89,"[>1],0;0",",1234568"],
  [0,"0,_,","0 "],
  [2.75,"0,_,","0 "],
  [1234567.89,"0,_,","1235 "],
  [0,"0.00E+00%%","0.00E+00%%"],
  [2.75,"0.00E+00%%","2.75E+00%%"],
  [0,"0.0\"x\",E+00","0.0x,E+00"],
  [2.75,"0.0\"x\",E+00","2.8x,E+00"],
  [45678.75,"ddd,, mmm","Tue, Jan"],
  [45678.75,"yyyy,,mm","2025,01"],
  [45678.75,"[h],,","1096290,"],
];
it.each(native)('formats %s with comma context %s', (value, code, expected) => {
  expect(formatWithCode(value, code, { overflow: '#VALUE!' })).toBe(expected);
});

it('keeps literal commas distinct from locale-dependent numeric separators', () => {
  setLocale('de-DE');
  expect(formatWithCode(1234.5, ',#,##0.0"x",')).toBe(',1.234,5x,');
  expect(formatWithCode(-1234.5, ',#,##0.0"x",')).toBe('-,1.234,5x,');
  expect(formatWithCode(-1234.5, '0;[Red](,0"x",)')).toBe('(,1235x,)');
});

it.each([
  [2.75, '0.00E+00%%', '2.75'],
  [-2.75, '0.00E+00%%', '-2.75'],
  [2.75, '%0E+00', '2.75'],
  [2.75, '0.00%;0.00E+00%', '275%'],
  [-2.75, '0.00%;0.00E+00%', '-2.75'],
  [2.75, '[>0]0.00E+00%;0.0%', '2.75'],
  [-2.75, '[>0]0.00E+00%;0.0%', '-275%'],
  [2.75, '0"%"', '2.75'],
])('edits %s according to the selected section of %s', (v, code, expected) => {
  expect(editText({ v, s: { fmt: 'custom', code } })).toBe(expected);
});

it('preserves comma semantics through TEXT, edits, clipboard and metadata-free XLSX', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const codes = new Set([',,0', '0x,,,', '0,"x"00', '0x,00', '0,0', ',?/?', '?/?x,,', '?/?"x",,0', '0.00E+00%%', '0.0"x",E+00']);
  const cases = native.filter(([value, code]) => value === 2.75 && codes.has(code));
  expect(cases.length).toBe(codes.size);
  cases.forEach(([value, code, expected], r) => {
    wb.setInput(id, r, 0, String(value));
    wb.applyStyle(id, { r1:r, r2:r, c1:0, c2:0 }, { fmt:'custom', code });
    wb.setInput(id, r, 1, `=TEXT(A${r + 1},"${code.replaceAll('"', '""')}")`);
    expect(wb.getDisplay(id, r, 0)).toBe(expected);
    expect(wb.getValue(id, r, 1)).toBe(expected);
    const cell = wb.getCell(id, r, 0), html = cellsToHtml([[expected]], [[cell]], null, [[value]]);
    expect(parseHtmlClipboard(html).cells[0][0].s.code).toBe(code);
    const external = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
    const pasted = cellsFromHtmlRows(parseHtmlClipboard(external).rows)[0].cell;
    expect(pasted.v).toBe(value); expect(pasted.s.code).toBe(code);
  });
  const editRow = cases.findIndex(([, code]) => code === ',,0');
  wb.setInput(id, editRow, 0, '7.25'); expect(wb.getValue(id, editRow, 1)).toBe(',7'); wb.undo();
  const scientificRow = cases.findIndex(([, code]) => code === '0.00E+00%%');
  wb.setInput(id, scientificRow, 0, '7.25');
  expect(wb.getValue(id, scientificRow, 0)).toBe(7.25);
  expect(wb.getDisplay(id, scientificRow, 0)).toBe('7.25E+00%%');
  expect(editText(wb.getCell(id, scientificRow, 0))).toBe('7.25'); wb.undo();
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(new Uint8Array(r.result)); r.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(bytes, { type:'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type:'array', fileType:'zip' }), 'native.xlsx');
  cases.forEach(([value, code, expected], r) => {
    expect(restored.getValue(restored.activeSheetId, r, 0)).toBe(value);
    expect(restored.styleAt(restored.activeSheetId, r, 0).code).toBe(code);
    expect(restored.getDisplay(restored.activeSheetId, r, 0)).toBe(expected);
    expect(restored.getValue(restored.activeSheetId, r, 1)).toBe(expected);
  });
});
