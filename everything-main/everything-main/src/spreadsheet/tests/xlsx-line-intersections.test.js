import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xlsxRowStyleBase, xlsxLineIntersectionCells } from '../src/core/xlsx-line-intersections.js';
import { MAX_COL, MAX_ROW } from '../src/core/refs.js';
import { xlsxFontProjection } from '../src/core/xlsx-style-projection.js';
import { createXlsxStyleReconciler } from '../src/core/xlsx-style-reconcile.js';
import * as X from '../src/vendor/xlsx.mjs';

const at = (wb, r, c) => wb.styleAt(wb.activeSheetId, r, c);
async function saved(wb) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const own = await workbookFromFile(bytes, 'own.xlsx');
  const zip = X.CFB.read(bytes, { type: 'array' });
  const get = p => new TextDecoder().decode(X.CFB.find(zip, p).content);
  const xml = get('/xl/worksheets/sheet1.xml');
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  const native = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  return { own, native, xml };
}

it('exports complete blank intersection formats without mutating sparse row and column patches', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data',
    colStyles: { 2: { bg: '#123456', font: 'georgia', fmt: 'currency', cur: 'EUR', dec: 3, bt: true, align: 'right' } },
    rowStyles: { 3: { bold: true, wrap: true } },
  }] });
  const before = wb.toJSON(), { own, native, xml } = await saved(wb);
  expect(own.getCell(own.activeSheetId, 3, 2)?.s?.fmt).toBeUndefined();
  for (const back of [own, native]) {
    expect(at(back, 3, 2)).toMatchObject({ bg: '#123456', font: 'georgia', bold: true, wrap: true, fmt: 'currency', cur: 'EUR', dec: 3, bt: true, align: 'right' });
    expect(at(back, 4, 2).bold).toBeFalsy(); expect(at(back, 3, 3).bg).toBeFalsy();
    back.setInput(back.activeSheetId, 3, 2, '1234.5');
    expect(back.getDisplay(back.activeSheetId, 3, 2)).toBe('€1,234.500');
    const range = { r1: 3, c1: 2, r2: 3, c2: 2 };
    back.pasteCells(back.activeSheetId, back.copyRange(back.activeSheetId, range), 7, 5, { r: 3, c: 2 });
    expect(at(back, 7, 5)).toMatchObject({ bg: '#123456', font: 'georgia', bold: true });
  }
  expect(own.activeSheet.rowStyles).toEqual(wb.activeSheet.rowStyles);
  expect(wb.toJSON()).toEqual(before); expect(wb.activeSheet.cells.size).toBe(0);
  expect([...xml.matchAll(/<c\b/g)]).toHaveLength(1);
});

it('honors explicit row resets, existing cells, sparse clears and Normal at intersections', async () => {
  const wb = new Workbook({ normalFont: { name: 'Arial', sz: 11 }, sheets: [{ name: 'Data',
    colStyles: { 1: { bg: '#abcdef', font: 'georgia' }, 2: { bg: '#abcdef', font: 'georgia' } },
    rowStyles: { 4: { bg: null, font: null, bold: true }, 6: { italic: true } },
    cells: { '6,1': { v: 12, s: { bg: '#cc3300' } } },
    styleResets: [{ range: { r1: 6, c1: 2, r2: 6, c2: 2 }, keys: ['bg', 'font'] }],
  }] });
  const { native, xml } = await saved(wb);
  expect(at(native, 4, 1).bg).toBeFalsy(); expect(at(native, 4, 1).font).toBe('calibri');
  expect(at(native, 6, 1)).toMatchObject({ bg: '#cc3300', font: 'georgia', italic: true });
  expect(at(native, 6, 2)).toMatchObject({ font: 'arial', italic: true }); expect(at(native, 6, 2).bg).toBeFalsy();
  const addresses = [...xml.matchAll(/<c\b[^>]*\br="([^"]+)"/g)].map(m => m[1]);
  expect(new Set(addresses).size).toBe(addresses.length);
});

it('uses a shared row base only for properties present across the complete XLSX grid', async () => {
  const cols = Object.fromEntries(Array.from({ length: MAX_COL + 1 }, (_, c) => [c, { font: c % 2 ? 'arial' : 'Arial', bg: c % 2 ? '#abcdef' : '#ABCDEF' }]));
  const wb = new Workbook({ sheets: [{ name: 'Data', colStyles: cols, rowStyles: { 3: { bold: true }, 7: { italic: true } } }] });
  const { native, own, xml } = await saved(wb);
  expect([...xml.matchAll(/<c\b/g)]).toHaveLength(0);
  for (const back of [native, own]) for (const c of [0, 16, MAX_COL]) {
    expect(xlsxFontProjection(at(back, 3, c))).toMatchObject({ font: 'arial', bold: true });
    expect(xlsxFontProjection(at(back, 7, c))).toMatchObject({ font: 'arial', italic: true });
  }
  expect(own.activeSheet.rowStyles).toEqual(wb.activeSheet.rowStyles);
  own.activeSheet.colStyles.set(5, { font: 'georgia' });
  expect(at(own, 3, 5)).toMatchObject({ font: 'georgia', bold: true });
  wb.activeSheet.colStyles.delete(MAX_COL);
  expect(xlsxRowStyleBase(wb.activeSheet)).toBeNull();
});

it('does not scan a Cartesian grid for repeated complete row formats or uniform column defaults', () => {
  let reads = 0;
  const count = 4000;
  const style = () => ({ get bg() { if (++reads > count * 12) throw new Error('Quadratic style reads'); return '#abcdef'; } });
  const sheet = { colStyles: new Map(Array.from({ length: count }, (_, c) => [c, style()])),
    rowStyles: new Map(Array.from({ length: count }, (_, r) => [r, style()])) };
  expect([...xlsxLineIntersectionCells(sheet)]).toEqual([]);
  sheet.colStyles = new Map(Array.from({ length: MAX_COL + 1 }, (_, c) => [c, { font: 'arial' }]));
  sheet.rowStyles = new Map([[MAX_ROW, { italic: true }]]);
  expect([...xlsxLineIntersectionCells(sheet, null, xlsxRowStyleBase(sheet))]).toEqual([]);
});

it('keeps native row components after an external column edit with a saved shared row base', () => {
  const cols = { 0: { font: 'arial', bg: '#abcdef' } }, rows = { 3: { bold: true } };
  createXlsxStyleReconciler({ cols, rows, resets: [], rowBase: { font: 'arial', bg: '#abcdef' },
    formats: [{ font: 'verdana', bg: '#123456' }, { font: 'arial', bg: '#abcdef', bold: true }],
    xml: '<worksheet><cols><col min="1" max="1" style="0"/></cols><sheetData><row r="4" s="1" customFormat="1"/></sheetData></worksheet>',
  });
  expect(cols[0]).toMatchObject({ font: 'verdana', bg: '#123456' });
  expect(rows[3]).toMatchObject({ font: 'arial', bg: '#abcdef', bold: true });
});

it('retains the older Normal row baseline when no shared-row marker was saved', () => {
  const cols = { 0: { font: 'arial' } }, rows = { 3: { bold: true } };
  createXlsxStyleReconciler({ cols, rows, resets: [],
    formats: [{ font: 'arial' }, { font: 'calibri', bold: true }],
    xml: '<worksheet><cols><col min="1" max="1" style="0"/></cols><sheetData><row r="4" s="1" customFormat="1"/></sheetData></worksheet>',
  });
  expect(rows[3]).toEqual({ bold: true });
});
