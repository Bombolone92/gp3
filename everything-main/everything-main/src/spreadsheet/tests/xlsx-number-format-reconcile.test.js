import { afterEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { NUMBER_FORMAT_KEYS, formatValue, numFmtToStyle, setLocale } from '../src/core/format.js';
import { xlsxAttr, xlsxElements } from '../src/core/xlsx-styles.js';
import { xmlTag } from '../src/core/xlsx-export-styles.js';
import { createXlsxStyleReconciler } from '../src/core/xlsx-style-reconcile.js';
import * as X from '../src/vendor/xlsx.mjs';

const area = (r, c) => ({ r1: r, c1: c, r2: r, c2: c });
const currency = { fmt: 'currency', cur: 'EUR', dec: 3, group: false };
const book = () => new Workbook({ sheets: [{ name: 'Numbers', colStyles: { 2: currency },
  cells: { '1,2': { v: 25, s: { bold: true } }, '2,2': { f: 'C2*2' }, '3,2': { v: 0.125, s: { dec: 1 } } },
}] });
const get = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const set = (zip, path, xml) => { const part = X.CFB.find(zip, path); part.content = new TextEncoder().encode(xml); part.size = part.content.length; };
const bytes = zip => X.CFB.write(zip, { type: 'array', fileType: 'zip' });
const reopen = wb => workbookToXlsx(wb).then(blob => workbookFromFile(blob, 'saved.xlsx'));

/** Change only a native XF's number component, leaving private metadata and
 * all other components untouched, as an external format edit would. */
async function edit(wb, edits) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  let styles = get(zip, '/xl/styles.xml'), sheet = get(zip, '/xl/worksheets/sheet1.xml');
  const xfs = xlsxElements(xlsxElements(styles, 'cellXfs')[0], 'xf');
  const formats = xlsxElements(xlsxElements(styles, 'numFmts')[0], 'numFmt');
  let next = Math.max(163, ...formats.map(tag => Number(xlsxAttr(tag, 'numFmtId')))) + 1;
  for (const { cell, column, row, code } of edits) {
    const re = cell ? new RegExp(`<c\\b[^>]*\\br="${cell}"[^>]*>`)
      : row ? new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*>`)
        : new RegExp(`<col\\b[^>]*\\bmin="${column}"[^>]*>`);
    const old = sheet.match(re)?.[0]; expect(old, JSON.stringify(edits)).toBeTruthy();
    const attr = column ? 'style' : 's';
    const index = Number(xlsxAttr(old, attr) || 0);
    const numberId = code === 'General' ? 0 : next++;
    if (numberId) formats.push(xmlTag('numFmt', { numFmtId: numberId, formatCode: code }));
    const changed = xfs[index].replace(/numFmtId="\d+"/, `numFmtId="${numberId}"`);
    const replacement = old.replace(new RegExp(` ${attr}="\\d+"`), '').replace(/(\/?>)$/, ` ${attr}="${xfs.length}"$1`);
    sheet = sheet.replace(re, replacement); xfs.push(changed);
  }
  styles = styles.replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/, `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`);
  const table = `<numFmts count="${formats.length}">${formats.join('')}</numFmts>`;
  styles = /<numFmts\b/.test(styles) ? styles.replace(/<numFmts\b[^>]*>[\s\S]*?<\/numFmts>/, table) : styles.replace('<fonts', `${table}<fonts`);
  set(zip, '/xl/styles.xml', styles); set(zip, '/xl/worksheets/sheet1.xml', sheet);
  return { zip, wb: await workbookFromFile(bytes(zip), 'edited.xlsx') };
}
afterEach(() => setLocale('en-US'));

it.each(['General', '0.00%', '0.0000" kg"', '[Red][<0]0.0;[Blue]0.00;"zero"', '@'])('accepts a native %s format over inherited currency and partial metadata', async code => {
  const source = book(), { wb } = await edit(source, [{ cell: 'C2', code }, { cell: 'C3', code }, { cell: 'C4', code }]);
  const id = wb.activeSheetId;
  for (const [r, value] of [[1, 25], [2, 50], [3, 0.125]]) {
    expect(wb.getDisplay(id, r, 2)).toBe(String(formatValue(value, numFmtToStyle(code))));
    expect(wb.styleAt(id, r, 2)?.cur).toBeFalsy();
    expect(wb.getValue(id, r, 2)).toBe(value);
  }
  expect(wb.styleAt(id, 1, 2).bold).toBe(true); expect(wb.getCell(id, 2, 2).f).toBe('C2*2');
  expect(wb.styleAt(id, 10, 2)).toMatchObject(currency);
  const back = await reopen(wb);
  for (const r of [1, 2, 3]) expect(back.getDisplay(back.activeSheetId, r, 2)).toBe(wb.getDisplay(id, r, 2));
});

it('reconciles General over a stored custom reset and a sparse number-format region', async () => {
  const source = new Workbook({ sheets: [{ name: 'Numbers', colStyles: { 2: currency },
    styleResets: [{ range: { r1: 1, c1: 2, r2: 3, c2: 3 }, keys: ['fmt', 'code'], values: { fmt: 'custom', code: '0.00" units"' } }],
    cells: { '1,2': { v: 7, s: { fmt: null, code: '' } }, '2,2': { v: 8 } },
  }] });
  const { wb } = await edit(source, [{ cell: 'C2', code: '0.0%' }, { cell: 'C3', code: 'General' }, { cell: 'D4', code: 'General' }]);
  expect(wb.getDisplay(wb.activeSheetId, 1, 2)).toBe('700.0%');
  expect(wb.getDisplay(wb.activeSheetId, 2, 2)).toBe('8');
  wb.setInput(wb.activeSheetId, 3, 3, '9'); expect(wb.getDisplay(wb.activeSheetId, 3, 3)).toBe('9');
  expect(wb.styleAt(wb.activeSheetId, 1, 3).code).toBe('0.00" units"');
});

it.each(['column', 'row'])('accepts a native whole-%s number edit while retaining stored cells’ native formats', async axis => {
  const source = new Workbook({ sheets: [{ name: 'Numbers', [`${axis === 'column' ? 'col' : 'row'}Styles`]: { 2: currency },
    cells: { '2,2': { v: 25 }, '2,4': { v: 12 }, '4,2': { v: 7 } },
  }] });
  const { wb } = await edit(source, [{ [axis]: 3, code: '0.00%' }]);
  expect(wb.styleAt(wb.activeSheetId, axis === 'row' ? 2 : 1000, axis === 'column' ? 2 : 100).fmt).toBe('percent');
  for (const [r, c] of [[2, 2], [2, 4], [4, 2]]) expect(wb.getDisplay(wb.activeSheetId, r, c)).toBe(source.getDisplay(source.activeSheetId, r, c));
  expect(wb.activeSheet.cells.size).toBe(3);
});

it('keeps complete row number formats after a crossing column component changes', () => {
  const cols = { 2: currency }, rows = { 4: { bold: true } };
  createXlsxStyleReconciler({ cols, rows, resets: [], formats: [{ fmt: 'percent', dec: 2 }, {}],
    xml: '<worksheet><cols><col min="3" max="3" style="0"/></cols><sheetData><row r="5" customFormat="1" s="1"/></sheetData></worksheet>' });
  expect(cols[2].fmt).toBe('percent');
  for (const key of NUMBER_FORMAT_KEYS) expect(rows[4][key]).toBeFalsy();
  expect(rows[4]).toHaveProperty('fmt', null);
});

it('removes stale whole-column number metadata when the native default is removed', async () => {
  const { zip } = await edit(book(), []);
  set(zip, '/xl/worksheets/sheet1.xml', get(zip, '/xl/worksheets/sheet1.xml').replace(/<col\b[^>]*\bmin="3"[^>]*\/>/, ''));
  const wb = await workbookFromFile(bytes(zip), 'removed.xlsx');
  expect(wb.styleAt(wb.activeSheetId, 1000, 2)?.fmt).toBeFalsy();
  expect(wb.getDisplay(wb.activeSheetId, 1, 2)).toBe('€25.000');
});

it.each(['en-US', 'de-DE', 'ja-JP'])('keeps unchanged partial formatting and later inheritance edits in %s', async locale => {
  setLocale(locale); const source = book();
  source.activeSheet.rowStyles.set(5, { fmt: 'date', dateStyle: 'long' });
  source.setCells(source.activeSheetId, [{ r: 5, c: 2, cell: { v: 45200 } }]);
  const wb = await reopen(source), id = wb.activeSheetId;
  expect(wb.getCell(id, 1, 2).s).toEqual({ bold: true });
  expect(wb.getCell(id, 2, 2).s).toBeUndefined(); expect(wb.getCell(id, 3, 2).s).toEqual({ dec: 1 });
  expect(wb.getDisplay(id, 5, 2)).toBe(source.getDisplay(source.activeSheetId, 5, 2));
  wb.applyStyle(id, { r1: 0, c1: 2, r2: wb.activeSheet.rows - 1, c2: 2 }, { cur: 'USD' });
  expect(wb.styleAt(id, 3, 2)).toMatchObject({ fmt: 'currency', cur: 'USD', dec: 1 });
});

it('retains named inheritance when a custom code is equivalent to the native named format', async () => {
  const source = book(); source.setCells(source.activeSheetId, [{ r: 3, c: 2, cell: { v: 0.25, s: { fmt: 'custom', code: '0.0%' } } }]);
  const wb = await reopen(source);
  expect(wb.getCell(wb.activeSheetId, 3, 2).s).toEqual({ fmt: 'custom', code: '0.0%' });
});

it('accepts a native spill-destination edit without freezing the other destinations', async () => {
  const source = new Workbook({ sheets: [{ name: 'Numbers', rowStyles: { 0: currency },
    cells: { '0,0': { f: 'SEQUENCE(4)', s: { dec: 1 } } } }] });
  const { wb } = await edit(source, [{ cell: 'A3', code: '0.00%' }]), id = wb.activeSheetId;
  expect([0, 1, 2, 3].map(r => wb.getDisplay(id, r, 0))).toEqual(['€1.0', '€2.0', '300.00%', '€4.0']);
  expect(wb.getCell(id, 1, 0)?.s?.fmt).toBeUndefined();
  wb.applyStyle(id, area(0, 0), { cur: 'USD' });
  expect(wb.getDisplay(id, 1, 0)).toBe('$2.0'); expect(wb.getDisplay(id, 2, 0)).toBe('300.00%');
  const back = await reopen(wb);
  expect(back.getDisplay(back.activeSheetId, 2, 0)).toBe('300.00%');
});

it('preserves unchanged native destinations when only a spill anchor’s format changes externally', async () => {
  const source = new Workbook({ sheets: [{ name: 'Numbers', rowStyles: { 0: currency }, cells: { '0,0': { f: 'SEQUENCE(3)' } } }] });
  const { wb } = await edit(source, [{ cell: 'A1', code: '0.0%' }]);
  expect([0, 1, 2].map(r => wb.getDisplay(wb.activeSheetId, r, 0))).toEqual(['100.0%', '€2.000', '€3.000']);
});

it('reuses complete numeric projections across dense cells sharing the same native XF', () => {
  let reads = 0;
  const format = { get fmt() { reads++; return 'currency'; }, cur: 'EUR', dec: 3 };
  const reconcile = createXlsxStyleReconciler({ cols: {}, rows: {}, resets: [], formats: [format], xml: '<worksheet><sheetData/></worksheet>' });
  for (let r = 0; r < 20000; r++) expect(reconcile(r, 1, undefined, 0, { nativeNumbers: true })).toMatchObject({ fmt: 'currency', cur: 'EUR', dec: 3 });
  expect(reads).toBeLessThan(10);
});
