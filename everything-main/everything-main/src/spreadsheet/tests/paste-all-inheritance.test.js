import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const range = (r1, c1, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const line = { bold: true, bg: '#ffdd99', fmt: 'currency', cur: 'EUR', dec: 3, code: '€0.000',
  bt: true, bs: 'double', bc: '#cc1122', br: true, brBorder: { bs: 'dashed', bc: '#663399' } };
function book() {
  return new Workbook({ sheets: [{ name: 'Copies', colStyles: { 3: line },
    rowStyles: { 4: { underline: true, wrap: true, align: 'right', rot: 35 } },
    cells: { '0,0': { v: 2, s: { italic: true } }, '4,3': { v: 25 } } }] });
}
function plain(wb, r, c, italic = false) {
  const s = wb.styleAt(wb.activeSheetId, r, c);
  expect(!!s?.italic).toBe(italic);
  for (const key of [...Object.keys(line), 'underline', 'wrap', 'align', 'rot']) expect(s?.[key], key).toBeFalsy();
}

it.each([false, true])('copies complete formats, formulas and notes with undo, transpose=%s', transpose => {
  const wb = book(), id = wb.activeSheetId;
  wb.setInput(id, 0, 1, '=A1*3');
  const source = wb.copyRange(id, range(0, 0, 0, 1)), snapshot = structuredClone(source);
  wb.clearHistory(); const before = wb.toJSON();
  wb.pasteCells(id, source, 4, 3, { r: 0, c: 0 }, null, { transpose, notes: [['copied', null]] });
  plain(wb, 4, 3, true); plain(wb, transpose ? 5 : 4, transpose ? 3 : 4);
  expect(wb.getValue(id, 4, 3)).toBe(2);
  expect(wb.getCell(id, transpose ? 5 : 4, transpose ? 3 : 4).f).toBe('D5*3'); // transposed, A1 follows its cell to D5
  expect(wb.getNote(id, 4, 3)).toBe('copied'); expect(source).toEqual(snapshot);
  expect(wb.styleAt(id, 6, 3)).toMatchObject(line);
  const after = wb.toJSON(); expect(wb.undoLabels()).toHaveLength(1);
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});

it.each([null, { v: null, f: null }, { v: null, s: {} }])('replaces inherited formats with a blank source: %j', source => {
  const wb = book(), id = wb.activeSheetId;
  wb.pasteCells(id, [[source]], 4, 3, null);
  plain(wb, 4, 3); expect(wb.getValue(id, 4, 3)).toBeNull();
  wb.setInput(id, 4, 3, '42'); plain(wb, 4, 3); expect(wb.getDisplay(id, 4, 3)).toBe('42');
});

it('tiles complete formats over sparse range defaults and skips blanks without clearing their styles', () => {
  const wb = new Workbook({ sheets: [{ styleResets: [{ range: range(2, 2, 20, 20),
    keys: Object.keys(line), values: line }] }] }), id = wb.activeSheetId;
  wb.pasteCells(id, [[{ v: 8 }, null]], 3, 3, null, range(3, 3, 5, 6), { skipBlanks: true });
  for (let r = 3; r <= 5; r++) for (let c = 3; c <= 6; c++) {
    if (c % 2) { plain(wb, r, c); expect(wb.getValue(id, r, c)).toBe(8); }
    else expect(wb.styleAt(id, r, c)).toMatchObject(line);
  }
  expect(wb.styleAt(id, 6, 3)).toMatchObject(line);
});

it('keeps per-side border pens independent when clearing destination shared pens', () => {
  const wb = book(), id = wb.activeSheetId;
  const s = { bb: true, bbBorder: { bs: 'dotted', bc: '#118877' } }, source = [[{ v: 2, s }]];
  wb.pasteCells(id, source, 4, 3, null);
  expect(wb.styleAt(id, 4, 3)).toMatchObject({ ...s, bs: null, bc: null, br: null, brBorder: null });
  wb.getCell(id, 4, 3).s.bbBorder.bc = '#ff0000'; expect(s.bbBorder.bc).toBe('#118877');
});

it('replaces custom Normal defaults across workbooks', () => {
  const source = new Workbook(), wb = new Workbook({ normalFont: { bold: true, sz: 18, name: 'Georgia' } });
  source.setInput(source.activeSheetId, 0, 0, '2');
  wb.pasteCells(wb.activeSheetId, source.copyRange(source.activeSheetId, range(0, 0)), 2, 2, null);
  expect(wb.styleAt(wb.activeSheetId, 2, 2)).toMatchObject({ bold: null, size: null, font: null });
  expect(wb.styleAt(wb.activeSheetId, 3, 2)).toMatchObject({ bold: true, size: 24, font: 'georgia' });
});

it.each([false, true])('copies complete formats through horizontal fill, blank=%s', blank => {
  const wb = book(), id = wb.activeSheetId;
  const row = blank ? 1 : 0;
  wb.fill(id, range(row, 0), range(row, 0, row, 3), { series: false });
  plain(wb, row, 3, !blank); expect(wb.getValue(id, row, 3)).toBe(blank ? null : 2);
});

it('keeps formulas-only destination styles and leaves source snapshots unmodified', () => {
  const wb = book(), id = wb.activeSheetId, source = [[{ v: 2, s: { italic: true } }]];
  wb.pasteCells(id, source, 4, 3, null, null, { keepStyles: true });
  expect(wb.styleAt(id, 4, 3)).toMatchObject({ ...line, underline: true });
  expect(wb.styleAt(id, 4, 3).italic).toBeUndefined(); expect(source[0][0].s).toEqual({ italic: true });
});

it('refuses protected copies and preflights cut destinations without any mutation', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.protectRange(id, range(5, 3)); wb.clearHistory(); const before = wb.toJSON();
  const source = wb.copyRange(id, range(0, 0, 1, 0));
  expect(wb.pasteCells(id, source, 4, 3, null, null, { checkOnly: true })).toBe(false);
  wb.pasteCells(id, source, 4, 3, null);
  expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});

it.each([false, true])('retains replaced formats through XLSX export and reimport, native-only=%s', async nativeOnly => {
  let wb = book(); const id = wb.activeSheetId;
  wb.pasteCells(id, wb.copyRange(id, range(0, 0, 1, 0)), 4, 3, null);
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  if (nativeOnly) {
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
  }
  wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'copies.xlsx');
  plain(wb, 4, 3, true); plain(wb, 5, 3);
  expect(wb.getValue(wb.activeSheetId, 4, 3)).toBe(2);
  expect(wb.getValue(wb.activeSheetId, 5, 3)).toBeNull();
  expect(wb.styleAt(wb.activeSheetId, 6, 3)).toMatchObject({ bold: true, bg: '#ffdd99', br: true });
});
