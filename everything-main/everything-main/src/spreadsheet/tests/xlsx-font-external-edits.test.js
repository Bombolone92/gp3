import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xlsxAttr, xlsxElements } from '../src/core/xlsx-styles.js';
import { FONT_KEYS, xlsxFontProjection } from '../src/core/xlsx-style-projection.js';
import { createXlsxStyleReconciler } from '../src/core/xlsx-style-reconcile.js';

const pick = s => Object.fromEntries(Object.entries(s || {}).filter(([k]) => FONT_KEYS.includes(k)));
const source = () => new Workbook({ sheets: [{ name: 'Data',
  colStyles: { 0: { font: 'arial', size: 24, bold: true, color: '#cc3300', fmt: 'number', dec: 3 }, 2: { font: 'courier' } },
  rowStyles: { 4: { font: 'times', italic: true } },
  cells: { '0,0': { v: 'Own', s: { font: 'calibri', size: 17, color: '#0000cc', bold: null } },
    '1,0': { v: 12 }, '2,0': { v: 'Reset', s: { font: null } }, '4,3': { v: 'Row' } },
}] });
const bytes = async wb => new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
function zipEditor(data) {
  const zip = X.CFB.read(data, { type: 'array' });
  const get = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const set = (path, text) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(text));
  return { get, set, finish: () => X.CFB.write(zip, { type: 'array', fileType: 'zip' }) };
}
function editFont(data, match, font) {
  const z = zipEditor(data), path = '/xl/styles.xml';
  let styles = z.get(path);
  const fonts = xlsxElements(xlsxElements(styles, 'fonts')[0], 'font');
  const xfs = xlsxElements(xlsxElements(styles, 'cellXfs')[0], 'xf'), changes = new Map();
  const fontId = fonts.length; fonts.push(font);
  const sheet = z.get('/xl/worksheets/sheet1.xml').replace(/<(?:c|row|col)\b[^>]*>/g, head => {
    if (!match(head)) return head;
    const key = /^<col\b/.test(head) ? 'style' : 's', old = Number(xlsxAttr(head, key) || 0);
    if (!changes.has(old)) {
      changes.set(old, xfs.length);
      xfs.push(xfs[old].replace(/fontId="\d+"/, `fontId="${fontId}"`));
    }
    return head.replace(new RegExp(`\\s${key}="[^"]*"`), '').replace(/(\/?>)$/, ` ${key}="${changes.get(old)}"$1`);
  });
  styles = styles.replace(/<fonts\b[^>]*>[\s\S]*?<\/fonts>/, `<fonts count="${fonts.length}">${fonts.join('')}</fonts>`)
    .replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/, `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`);
  z.set(path, styles); z.set('/xl/worksheets/sheet1.xml', sheet); return z.finish();
}
const font = '<font><i/><sz val="15"/><color rgb="FF008800"/><name val="Verdana"/></font>';
const changed = { font: 'verdana', size: 20, color: '#008800', italic: true, bold: false };
const effective = (wb, r, c) => wb.styleAt(wb.activeSheetId, r, c);
const read = data => workbookFromFile(data, 'edited.xlsx');

it('retains private font inheritance and explicit resets when the emitted fonts are unchanged', async () => {
  const wb = source(), back = await read(await bytes(wb));
  for (const key of ['0,0', '1,0', '2,0', '4,3']) expect(pick(back.activeSheet.cells.get(key)?.s)).toEqual(pick(wb.activeSheet.cells.get(key)?.s));
  expect(back.activeSheet.colStyles).toEqual(wb.activeSheet.colStyles);
  expect(back.activeSheet.rowStyles).toEqual(wb.activeSheet.rowStyles);
  expect(back.normalFont).toBeNull();
});

it.each(['cell', 'column', 'row'])('accepts native %s font changes instead of restoring stale private overrides', async target => {
  const wb = source();
  const match = target === 'cell' ? h => /^<c\b/.test(h) && xlsxAttr(h, 'r') === 'A1'
    : target === 'column' ? h => /^<col\b/.test(h) && xlsxAttr(h, 'min') === '1'
      || /^<c\b/.test(h) && /^A\d+$/.test(xlsxAttr(h, 'r'))
      : h => /^<row\b/.test(h) && xlsxAttr(h, 'r') === '5' || /^<c\b/.test(h) && /\D5$/.test(xlsxAttr(h, 'r'));
  const back = await read(editFont(await bytes(wb), match, font));
  const points = target === 'cell' ? [[0, 0]] : target === 'column' ? [[0, 0], [1, 0], [2, 0], [80, 0]] : [[4, 3], [4, 20]];
  for (const [r, c] of points) expect(xlsxFontProjection(effective(back, r, c))).toMatchObject(changed);
  const reopened = await read(await bytes(back));
  for (const [r, c] of points) expect(pick(effective(reopened, r, c))).toEqual(pick(effective(back, r, c)));
  const native = zipEditor(await bytes(back));
  native.set('/xl/workbook.xml', native.get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  const external = await read(native.finish());
  for (const [r, c] of points) expect(xlsxFontProjection(effective(external, r, c))).toMatchObject(changed);
  const [r, c] = points[0], copied = back.copyRange(back.activeSheetId, { r1: r, c1: c, r2: r, c2: c });
  back.pasteCells(back.activeSheetId, copied, 20, 7, { r, c });
  expect(xlsxFontProjection(effective(back, 20, 7))).toMatchObject(changed);
});

it('keeps stored complete cell fonts when only an unallocated column default changes', async () => {
  const wb = source(), back = await read(editFont(await bytes(wb), h => /^<col\b/.test(h) && xlsxAttr(h, 'min') === '1', font));
  expect(effective(back, 80, 0)).toMatchObject(changed);
  expect(effective(back, 1, 0)).toMatchObject({ font: 'arial', size: 24, bold: true, color: '#cc3300' });
  expect(effective(back, 0, 0)).toMatchObject({ font: 'calibri', size: 17, color: '#0000cc' });
});

it('accepts cleared flags, automatic black and the Normal face over stale explicit formatting', async () => {
  const wb = source(); wb.activeSheet.cells.get('0,0').s = { font: 'arial', size: 32, color: '#00aa00', bold: true, italic: true, underline: true, strike: true };
  const back = await read(editFont(await bytes(wb), h => /^<c\b/.test(h) && xlsxAttr(h, 'r') === 'A1', '<font><sz val="12"/><color auto="1"/><name val="Calibri"/></font>'));
  expect(pick(effective(back, 0, 0))).toEqual({ font: 'calibri', size: 16, color: 'windowtext', bold: false, italic: false, underline: false, strike: false });
});

it('accepts an externally changed Normal font while stored XFs retain their own fonts', async () => {
  const wb = source(), z = zipEditor(await bytes(wb));
  z.set('/xl/styles.xml', z.get('/xl/styles.xml').replace(/<font>[\s\S]*?<\/font>/, font));
  const back = await read(z.finish());
  expect(back.normalFont).toMatchObject({ name: 'Verdana', sz: 15, italic: true, color: '#008800' });
  expect(xlsxFontProjection(effective(back, 80, 20))).toMatchObject(changed);
  expect(effective(back, 1, 0)).toMatchObject({ font: 'arial', size: 24, bold: true, color: '#cc3300' });
});

it('compares the exporter’s clamped sizes without freezing an unchanged private size', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 'Large', s: { size: 900 } } } }] });
  const back = await read(await bytes(wb));
  expect(back.activeSheet.cells.get('0,0').s.size).toBe(900);
});

it('honors removal of a native line font and complete row fonts at changed-column intersections', async () => {
  const wb = source(), data = await bytes(wb), z = zipEditor(data);
  z.set('/xl/worksheets/sheet1.xml', z.get('/xl/worksheets/sheet1.xml').replace(/<col\b[^>]*>/g, h => xlsxAttr(h, 'min') === '1' ? h.replace(/ style="\d+"/, '') : h));
  const removed = await read(z.finish());
  expect(removed.activeSheet.colStyles.get(0)?.font).toBeUndefined();
  expect(effective(removed, 1, 0)).toMatchObject({ font: 'arial', size: 24 });
  const edited = await read(editFont(data, h => /^<col\b/.test(h) && xlsxAttr(h, 'min') === '1', font));
  // Export now materializes this blank intersection's composite font. Editing
  // only the column XF must leave that native cell's original font intact.
  expect(effective(edited, 4, 0)).toMatchObject({ font: 'times', italic: true, size: 24, bold: true });
  const legacy = zipEditor(data);
  legacy.set('/xl/worksheets/sheet1.xml', legacy.get('/xl/worksheets/sheet1.xml')
    .replace(/<c\b(?=[^>]*\br="A5")[^>]*(?:\/>|>[\s\S]*?<\/c>)/, ''));
  const unallocated = await read(editFont(legacy.finish(), h => /^<col\b/.test(h) && xlsxAttr(h, 'min') === '1', font));
  expect(effective(unallocated, 4, 0)).toMatchObject({ font: 'times', italic: true, size: 16 });
  expect(effective(unallocated, 4, 0).bold).toBeFalsy();
});

it('reads an omitted cell s as XF zero and ignores cell-like elements outside sheetData', async () => {
  const wb = source(), z = zipEditor(await bytes(wb));
  z.set('/xl/worksheets/sheet1.xml', z.get('/xl/worksheets/sheet1.xml')
    .replace(/<c\b[^>]*r="A1"[^>]*>/, h => h.replace(/ s="\d+"/, ''))
    .replace('</worksheet>', '<extLst><ext uri="example"><c r="A1" s="99"/></ext></extLst></worksheet>'));
  const back = await read(z.finish());
  expect(xlsxFontProjection(effective(back, 0, 0))).toEqual(xlsxFontProjection());
});

it('does not reuse a cached font patch when the next cell has a different native XF', async () => {
  const wb = source();
  for (const r of [10, 11, 12]) wb.setInput(wb.activeSheetId, r, 0, '123');
  const back = await read(editFont(await bytes(wb), h => /^<c\b/.test(h) && xlsxAttr(h, 'r') === 'A12', font));
  expect(effective(back, 10, 0).font).toBe('arial');
  expect(xlsxFontProjection(effective(back, 11, 0))).toMatchObject(changed);
  expect(effective(back, 12, 0).font).toBe('arial');
});

it('keeps inactive precision settings when native General columns change fonts', () => {
  const decimals = [1, 2, 3];
  // These inactive decimal settings all export as General. A complete native
  // XF cannot represent three different active precisions at once.
  const cols = Object.fromEntries(decimals.map((dec, c) => [c, { font: 'arial', fmt: 'general', dec }]));
  createXlsxStyleReconciler({ cols, rows: {}, resets: [], normalFont: null,
    formats: [{ font: 'verdana', size: 20 }], xml: '<worksheet><cols><col min="1" max="3" style="0"/></cols></worksheet>' });
  for (const [c, dec] of decimals.entries()) expect(cols[c]).toEqual({ font: 'verdana', size: 20, fmt: 'general', dec });
});
