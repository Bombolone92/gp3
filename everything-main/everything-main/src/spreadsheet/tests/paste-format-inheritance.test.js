import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

const range = (r1, c1, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const line = { bold: true, bg: '#ffee99', fmt: 'currency', cur: 'USD', dec: 2,
  code: '$0.00', bt: true, bb: true, bl: true, br: true, bs: 'double', bc: '#cc1122',
  brBorder: { bs: 'dashed', bc: '#663399' } };
function book(extra = {}) {
  return new Workbook({ sheets: [{ name: 'Formats', colStyles: { 3: line },
    rowStyles: { 4: { underline: true, wrap: true, align: 'right', rot: 35 } },
    cells: { '0,0': { v: 2, s: { italic: true } }, '4,3': { f: 'A1*7', hyperlink: 'https://example.com' } }, ...extra }] });
}
function plainTarget(wb, r, c, italic = true) {
  const style = wb.styleAt(wb.activeSheetId, r, c);
  expect(!!style?.italic).toBe(italic);
  for (const key of ['bold', 'bg', 'underline', 'wrap', 'align', 'rot', 'fmt', 'cur', 'dec', 'code', 'bt', 'bb', 'bl', 'br', 'bs', 'bc', 'brBorder']) {
    expect(style?.[key], `${r},${c} ${key}`).toBeFalsy();
  }
}
afterEach(() => vi.unstubAllGlobals());

it('replaces column and crossing-row formats while keeping formulas, links, notes and undo', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.setNote(id, 4, 3, 'Retain this note'); wb.clearHistory();
  const before = wb.toJSON(), copied = wb.copyRange(id, range(0, 0)), source = structuredClone(copied);
  wb.pasteStyles(id, copied, 4, 3, null, { merges: [] });
  plainTarget(wb, 4, 3);
  expect(wb.getValue(id, 4, 3)).toBe(14);
  expect(wb.getCell(id, 4, 3)).toMatchObject({ f: 'A1*7', hyperlink: 'https://example.com' });
  expect(wb.getNote(id, 4, 3)).toBe('Retain this note');
  expect(copied).toEqual(source);
  expect(wb.styleAt(id, 5, 3)).toMatchObject(line);
  expect(wb.styleAt(id, 4, 2)).toMatchObject({ underline: true, wrap: true, align: 'right', rot: 35 });
  const after = wb.toJSON();
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
  wb.redo(); expect(wb.toJSON()).toEqual(after);
  wb.clearHistory(); wb.pasteStyles(id, copied, 4, 3, null, { merges: [] });
  expect(wb.canUndo()).toBe(false);
});

it.each([null, { v: null, f: null }, { s: {} }])('pastes a blank source format over an empty inherited cell: %j', cell => {
  const wb = book();
  wb.pasteStyles(wb.activeSheetId, [[cell]], 10, 3);
  plainTarget(wb, 10, 3, false);
  wb.setInput(wb.activeSheetId, 10, 3, '42');
  plainTarget(wb, 10, 3, false);
  expect(wb.getValue(wb.activeSheetId, 10, 3)).toBe(42);
});

it('tiles complete formats over sparse range overrides and retains neighboring overrides', () => {
  const wb = book({ styleResets: [{ range: range(10, 1, 30, 8),
    keys: ['bg', 'italic', 'bt', 'btBorder'], values: { bg: '#bbffaa', italic: true, bt: true, btBorder: { bs: 'thick', bc: '#007799' } } }] });
  wb.pasteStyles(wb.activeSheetId, [[null, { s: { bold: true } }]], 11, 2, range(11, 2, 13, 5));
  for (let r = 11; r <= 13; r++) for (let c = 2; c <= 5; c++) {
    const s = wb.styleAt(wb.activeSheetId, r, c);
    expect(!!s.bold).toBe(c % 2 === 1);
    for (const key of ['bg', 'italic', 'bt', 'btBorder', 'br', 'brBorder', 'code']) expect(s[key]).toBeFalsy();
  }
  expect(wb.styleAt(wb.activeSheetId, 14, 2)).toMatchObject({ bg: '#bbffaa', italic: true, bt: true });
});

it('preserves copied per-side pens when masking inherited shared pens', () => {
  const wb = book(), id = wb.activeSheetId;
  const source = { bl: true, blBorder: { bs: 'dotted', bc: '#118877' }, bb: true, bbBorder: { bs: 'medium', bc: null } };
  wb.pasteStyles(id, [[{ s: source }]], 4, 3);
  expect(wb.styleAt(id, 4, 3)).toMatchObject(source);
  expect(wb.styleAt(id, 4, 3)).toMatchObject({ bc: null, bs: null, bt: null, br: null, brBorder: null });
  wb.getCell(id, 4, 3).s.blBorder.bc = '#ff0000';
  expect(source.blBorder.bc).toBe('#118877');
});

it('copies inherited source formatting and retains the target removed-link marker', () => {
  const wb = book({ colStyles: { 0: { italic: true, bb: true, bbBorder: { bs: 'medium', bc: '#224466' } }, 3: line },
    cells: { '4,3': { v: 'https://example.com', s: { nolink: true } } } });
  wb.pasteStyles(wb.activeSheetId, wb.copyRange(wb.activeSheetId, range(0, 0)), 4, 3);
  expect(wb.styleAt(wb.activeSheetId, 4, 3)).toMatchObject({ italic: true, bb: true,
    bbBorder: { bs: 'medium', bc: '#224466' }, nolink: true, bold: null, br: null });
});

it('replaces custom destination Normal formatting when copying from another workbook', () => {
  const source = new Workbook(); source.setInput(source.activeSheetId, 0, 0, '2');
  const wb = new Workbook({ normalFont: { bold: true, italic: true, sz: 18, name: 'Georgia', color: '#007799' } });
  wb.pasteStyles(wb.activeSheetId, source.copyRange(source.activeSheetId, range(0, 0)), 1, 1);
  expect(wb.styleAt(wb.activeSheetId, 1, 1)).toMatchObject({ bold: null, italic: null, size: null, font: null, color: null });
  expect(wb.styleAt(wb.activeSheetId, 2, 1)).toMatchObject({ bold: true, size: 24, font: 'georgia' });
});

it('refuses a protected target atomically without changing inherited styles or history', () => {
  const wb = book(), id = wb.activeSheetId;
  wb.protectRange(id, range(5, 3)); wb.clearHistory(); const before = wb.toJSON();
  wb.pasteStyles(id, [[null]], 4, 3, range(4, 3, 5, 3), { merges: [] });
  expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});

it.each([false, true])('preserves replacement formatting through two XLSX saves, native-only=%s', async nativeOnly => {
  let wb = book(); wb.pasteStyles(wb.activeSheetId, wb.copyRange(wb.activeSheetId, range(0, 0)), 4, 3);
  wb.pasteStyles(wb.activeSheetId, [[null]], 10, 3);
  for (let pass = 0; pass < 2; pass++) {
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const zip = X.CFB.read(bytes, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
    if (nativeOnly) {
      part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
      part.size = part.content.length;
    }
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'formats.xlsx');
    plainTarget(wb, 4, 3); plainTarget(wb, 10, 3, false);
    expect(wb.getValue(wb.activeSheetId, 4, 3)).toBe(14);
    expect(wb.styleAt(wb.activeSheetId, 12, 3)).toMatchObject({ bold: true, bg: '#ffee99', br: true });
  }
});

it.each([false, true])('replaces inherited defaults from HTML clipboard formats, foreign=%s', foreign => {
  vi.stubGlobal('DOMParser', new JSDOM('').window.DOMParser);
  const wb = book(), id = wb.activeSheetId;
  let html = cellsToHtml([['2']], wb.copyRange(id, range(0, 0)));
  if (foreign) html = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  const parsed = parseHtmlClipboard(html);
  wb.pasteStyles(id, parsed.cells || parsed.rows.map(row => row.map(({ style }) => ({ s: style }))), 4, 3);
  plainTarget(wb, 4, 3); expect(wb.getValue(id, 4, 3)).toBe(14);
});
