import { DEFAULT_FONT_COLOR } from '../src/core/font-color.js';
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

// Cell colours travel in this app's sidecar; the solid fill another program gave a cell,
// which the reader hands on, was ignored, so an Excel file's yellow input cells opened plain
// and were saved back plain. The fill's colour is the cell's background now.
const STYLES = {
  fills: [
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>', // fillId 2
    '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.5999"/><bgColor indexed="64"/></patternFill></fill>', // 3
    '<fill><patternFill patternType="gray125"><fgColor rgb="FF00FF00"/></patternFill></fill>', // 4
    '<fill><patternFill patternType="none"><fgColor rgb="FF00FF00"/></patternFill></fill>', // 5
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0000FF"/></patternFill></fill>', // 6
  ],
  numFmts: ['<numFmt numFmtId="164" formatCode="0.00"/>'],
  cellXfs: [
    '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>', // s=1 yellow
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/>', // s=2 theme
    '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>', // s=3 pattern
    '<xf numFmtId="0" fontId="0" fillId="5" borderId="0" xfId="0"/>', // s=4 none
    '<xf numFmtId="164" fontId="0" fillId="6" borderId="0" xfId="0" applyNumberFormat="1" applyFill="1"/>', // s=5 blue with a number format
  ],
};
const ROWS = '<row r="1"><c r="A1" s="1"><v>1</v></c><c r="B1" s="2"><v>2</v></c><c r="C1" s="3"><v>3</v></c><c r="D1" s="4"><v>4</v></c><c r="E1" s="5"><f>A1+1</f><v>2</v></c><c r="F1"><v>6</v></c><c r="G1" s="1"/></row>';

it('reads solid cell fills from another program\'s file, and keeps them through a save', async () => {
  const wb = await workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: { rows: ROWS } }, styles: STYLES }), 'inputs.xlsx');
  const id = wb.activeSheetId;
  expect(wb.getCell(id, 0, 0)).toEqual({ v: 1, f: null, s: { valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, bg: '#ffff00', nativeFill: expect.objectContaining({ paint: '#ffff00' }) } });
  expect(wb.getCell(id, 0, 1).s.bg).toMatchObject({ theme: 4, tint: 0.5999, base: '#4f81bd' });
  expect(wb.getCell(id, 0, 1).s.bg.rgb).toMatch(/^#[0-9a-f]{6}$/); // paint resolved through the file's theme
  expect(wb.getCell(id, 0, 2).s.bg).toBeUndefined(); // a pattern has no one colour
  expect(wb.getCell(id, 0, 3).s.bg).toBeUndefined();
  expect(wb.getCell(id, 0, 4)).toEqual({ v: null, f: 'A1+1', s: { valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, fmt: 'number', dec: 2, group: false, bg: '#0000ff', nativeFill: expect.objectContaining({ paint: '#0000ff' }) } });
  expect(wb.getCell(id, 0, 5).s.bg).toBeUndefined();
  expect(wb.getCell(id, 0, 6)).toEqual({ v: null, f: null, s: { valign: 'bottom', font: 'calibri', scheme: 'minor', size: 16, color: DEFAULT_FONT_COLOR, bg: '#ffff00', nativeFill: expect.objectContaining({ paint: '#ffff00' }) } }); // an empty coloured cell keeps its colour
  const back = await workbookFromFile(await workbookToXlsx(wb), 'inputs.xlsx');
  expect(back.getCell(back.activeSheetId, 0, 0).s).toEqual(wb.getCell(id, 0, 0).s);
  expect(back.getCell(back.activeSheetId, 0, 4).s).toMatchObject({ bg: '#0000ff', fmt: 'number' });
  expect(back.getCell(back.activeSheetId, 0, 6).s).toEqual(wb.getCell(id, 0, 6).s);
});

it('accepts native fill replacements over private overrides, and newly added fills', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data' }] });
  wb.setInput(wb.activeSheetId, 0, 0, '1');
  wb.setInput(wb.activeSheetId, 0, 1, '2');
  wb.applyStyle(wb.activeSheetId, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bg: '#ff0000', bold: true });
  const saved = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(saved, { type: 'array' });
  const styles = X.CFB.find(zip, '/xl/styles.xml');
  let xf = 0, fillId = 0;
  const styleXml = new TextDecoder().decode(styles.content)
    .replace(/<fills count="(\d+)">([\s\S]*?)<\/fills>/, (m, n, body) => { fillId = Number(n); return `<fills count="${fillId + 1}">${body}<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>`; })
    .replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/, (m, n, body) => { xf = Number(n); return `<cellXfs count="${xf + 1}">${body}<xf numFmtId="0" fontId="0" fillId="${fillId}" borderId="0" xfId="0" applyFill="1"/></cellXfs>`; });
  styles.content = new TextEncoder().encode(styleXml);
  styles.size = styles.content.length;
  const sheet = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  const sheetXml = new TextDecoder().decode(sheet.content).replace(/<c r="(A1|B1)"( s="\d+")?/g, (m, addr) => `<c r="${addr}" s="${xf}"`);
  sheet.content = new TextEncoder().encode(sheetXml);
  sheet.size = sheet.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'mine.xlsx');
  // The replacement XF also has a complete non-bold font; stale private bold
  // no longer overrides that external edit.
  expect(back.getCell(back.activeSheetId, 0, 0).s).toEqual({ bg: '#ffff00', bold: false, nativeFill: expect.objectContaining({ paint: '#ffff00' }) });
  expect(back.getCell(back.activeSheetId, 0, 1).s).toEqual({ bg: '#ffff00', nativeFill: expect.objectContaining({ paint: '#ffff00' }) });
});
