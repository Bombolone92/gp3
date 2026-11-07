// @vitest-environment jsdom
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { readXlsxStyles } from '../src/core/xlsx-styles.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

function styles(pattern, themes = {}) {
  const xml = `<styleSheet><fills><fill>${pattern}</fill></fills><dxfs><dxf><fill>${pattern}</fill></dxf></dxfs><tableStyles><tableStyle name="Example"><tableStyleElement type="headerRow" dxfId="0"/></tableStyle></tableStyles></styleSheet>`;
  return readXlsxStyles({ files: { 'xl/styles.xml': { content: new TextEncoder().encode(xml) } }, Themes: themes });
}

// Checked in desktop Excel: differential fills use background
// paint; foreground-only records inherit earlier table/cell shading unchanged.
it.each(['', ' patternType="solid"'])('uses background for differential shading and foreground for XF fills (%s)', type => {
  const result = styles(`<patternFill${type}><fgColor rgb="FFEEDD22"/><bgColor rgb="FF2266AA"/></patternFill>`);
  expect(result.dxfs[0].bg).toBe('#2266aa');
  expect(result.tables.get('Example').headerRow.bg).toBe('#2266aa');
  expect(result.fills[0].bg).toBe(type ? '#eedd22' : undefined);
  expect(result.fills[0].nativeFill.paint).toBe(type ? '#eedd22' : null);
  expect(result.fills[0].nativeFill.xml).toContain('fgColor rgb="FFEEDD22"');
});

it.each([
  ['<fgColor rgb="FF123456"/>', undefined],
  ['<fgColor rgb="FF123456"/><bgColor rgb="invalid"/>', undefined],
  ['<bgColor rgb="FF000000"/>', '#000000'],
  ['<bgColor indexed="3"/>', { indexed: 3, base: '#00ff00', rgb: '#00ff00' }],
  ['<bgColor indexed="64"/>', '#000000'],
  ['<bgColor indexed="064"/>', '#000000'],
  ['<bgColor indexed="65"/>', '#ffffff'],
  ['<bgColor auto="1"/>', '#ffffff'],
  ['<bgColor auto="true" rgb="FF123456"/>', '#ffffff'],
  ['<bgColor auto="0" rgb="FF123456"/>', '#123456'],
  ['<bgColor theme="4" tint="0.5"/>', { theme: 4, tint: 0.5, base: '#000000', rgb: '#808080' }],
])('reads differential background %s', (colors, expected) => {
  const themes = { themeElements: { clrScheme: Array.from({ length: 5 }, () => ({ rgb: '000000' })) } };
  expect(styles(`<patternFill patternType="solid">${colors}</patternFill>`, themes).dxfs[0].bg).toEqual(expected);
});

it('retains an explicit no-fill override even when colors are present', () => {
  expect(styles('<patternFill patternType="none"><bgColor rgb="FFFF0000"/></patternFill>').dxfs[0].bg).toBe('transparent');
});

it.each([
  ['<patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill>', '#ffcc88'],
  ['<patternFill><bgColor auto="1"/></patternFill>', '#ffffff'],
  ['<patternFill patternType="none"/>', 'transparent'],
])('distinguishes inherited, automatic and cleared table shading (%s)', (pattern, bg) => {
  const customStyle = { wholeTable: { bg: '#ffcc88' }, ...styles(pattern).tables.get('Example') };
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'Header' }, '1,0': { v: 1 } }, tables: [{ name: 'Items', style: 'custom', customStyle, range: { r1: 0, c1: 0, r2: 1, c2: 0 } }] }] });
  expect(wb.conditionalStyle(wb.activeSheetId, 0, 0, 'Header').bg).toBe(bg);
});

it('applies the same background semantics to imported conditional formatting', async () => {
  const wb = await workbookFromFile(otherProgramsXlsx({
    sheetXml: { Data: { rows: '<row r="1"><c r="B1"><v>12</v></c></row>', tail: '<conditionalFormatting sqref="B1:B3"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>10</formula></cfRule></conditionalFormatting>' } },
    patch: { '/xl/styles.xml': xml => xml.replace(/<dxfs[^>]*(?:\/>|>[\s\S]*?<\/dxfs>)/, '<dxfs count="1"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor rgb="FF2266AA"/></patternFill></fill></dxf></dxfs>') },
  }), 'conditional.xlsx');
  const id = wb.activeSheetId;
  expect(wb.conditionalStyle(id, 0, 1, wb.getValue(id, 0, 1)).bg).toBe('#2266aa');
  wb.setInput(id, 0, 1, '9'); expect(wb.conditionalStyle(id, 0, 1, wb.getValue(id, 0, 1))).toBeNull();
});

it('preserves differential fills through editing, native export and external HTML', async () => {
  const parsed = styles('<patternFill patternType="solid"><fgColor rgb="FFCC2255"/><bgColor rgb="FF2266AA"/></patternFill>');
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '2,1': { v: 'Header' }, '3,1': { v: 12 } }, tables: [{ name: 'Entries', style: 'custom', customStyle: parsed.tables.get('Example'), range: { r1: 2, c1: 1, r2: 3, c2: 1 } }] }] });
  const id = wb.activeSheetId, coat = book => book.conditionalStyle(book.activeSheetId, 2, 1, 'Header');
  wb.setInput(id, 3, 1, '19'); expect(coat(wb).bg).toBe('#2266aa'); wb.undo();
  const html = cellsToHtml([['Header']], [[wb.getCell(id, 2, 1)]], [[coat(wb)]]);
  const externalHtml = html.replace(/ data-spreadsheet-\w+="[^"]*"/g, '');
  expect(parseHtmlClipboard(externalHtml).rows[0][0].style.bg).toBe('#2266aa');
  const blob = await workbookToXlsx(wb);
  const bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  const restored = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  expect(coat(restored).bg).toBe('#2266aa');
});
