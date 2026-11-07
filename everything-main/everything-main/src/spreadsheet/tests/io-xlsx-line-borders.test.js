import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const columns = { bl: { bs: 'thick', bc: '#2468ac' }, br: { bs: 'thick', bc: '#2468ac' } };
const mixed = { bt: { bs: 'medium', bc: '#7823ab' }, bb: { bs: 'double', bc: '#438912' }, bl: { bs: 'dotted', bc: '#912456' } };
const row = { bt: { bs: 'dashed', bc: '#cd4321' }, bb: { bs: 'dashed', bc: '#cd4321' } };
const xmlSides = { bt: 'top', bb: 'bottom', bl: 'left', br: 'right' };
const border = sides => '<border>' + Object.entries(xmlSides).map(([key, tag]) => sides[key]
  ? `<${tag} style="${sides[key].bs}"><color rgb="FF${sides[key].bc.slice(1).toUpperCase()}"/></${tag}>` : `<${tag}/>`).join('') + '<diagonal/></border>';
function fixture() {
  return otherProgramsXlsx({ styles: { borders: [border(columns), border(mixed), border(row)],
    cellXfs: [1, 2, 3].map(borderId => `<xf numFmtId="0" fontId="0" fillId="0" borderId="${borderId}" xfId="0"/>`),
  }, sheetXml: { Data: { head: '<cols><col min="3" max="4" style="1"/><col min="6" max="6" style="2"/></cols>',
    rows: '<row r="2"><c r="C2"><v>5</v></c></row><row r="3"><c r="F3" s="2"><v>7</v></c></row><row r="6" s="3" customFormat="1"/>',
  } } });
}
function checkBorder(wb, r, c, expected) {
  const style = wb.styleAt(wb.activeSheetId, r, c);
  for (const key of Object.keys(xmlSides)) {
    expect(!!style?.[key], `${r},${c} ${key}`).toBe(!!expected[key]);
    if (expected[key]) expect(style[`${key}Border`] || { bs: style.bs || 'thin', bc: style.bc || '#000000' }).toEqual(expected[key]);
  }
}
function check(wb) {
  checkBorder(wb, 10, 2, columns); checkBorder(wb, 300, 3, columns);
  checkBorder(wb, 10, 5, mixed); checkBorder(wb, 2, 5, mixed);
  checkBorder(wb, 5, 2, row); checkBorder(wb, 5, 5, row); checkBorder(wb, 5, 20, row);
  checkBorder(wb, 1, 2, {}); // Stored XF 0 overrides the column's complete border.
  expect(wb.activeSheet.cells.size).toBeLessThan(10);
}
async function exported(wb, nativeOnly) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  if (!nativeOnly) return workbookFromFile(bytes, 'saved.xlsx');
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
}

it('imports complete shared/mixed borders on intersecting lines without materializing empty cells', async () => {
  const wb = await workbookFromFile(fixture(), 'lines.xlsx'); check(wb);
  const json = new Workbook(wb.toJSON()); check(json);
  wb.setInput(wb.activeSheetId, 10, 5, '42'); checkBorder(wb, 10, 5, mixed);
  expect(wb.getValue(wb.activeSheetId, 10, 5)).toBe(42);
});

it.each([false, true])('preserves line borders across repeated XLSX saves, native-only=%s', async nativeOnly => {
  let wb = await workbookFromFile(fixture(), 'lines.xlsx');
  for (let i = 0; i < 2; i++) { wb = await exported(wb, nativeOnly); check(wb); }
});

it('exports clear-format exceptions and edits while retaining outside line borders', async () => {
  const wb = await workbookFromFile(fixture(), 'lines.xlsx'), id = wb.activeSheetId;
  wb.clearRange(id, { r1: 9, c1: 2, r2: 11, c2: 5 }, { contents: false, styles: true });
  wb.setInput(id, 10, 5, '42');
  const back = await exported(wb, true);
  for (const r of [9, 10, 11]) for (const c of [2, 3, 5]) checkBorder(back, r, c, {});
  checkBorder(back, 12, 2, columns); checkBorder(back, 12, 5, mixed); checkBorder(back, 5, 5, row);
  expect(back.getValue(back.activeSheetId, 10, 5)).toBe(42);
});
