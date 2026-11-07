import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xlsxResetCells } from '../src/core/xlsx-style-resets.js';
import * as X from '../src/vendor/xlsx.mjs';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';

async function saved(wb) {
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return { native: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx'),
    own: await workbookFromFile(bytes, 'own.xlsx'), xml: new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content) };
}
const at = (wb, r, c) => wb.styleAt(wb.activeSheetId, r, c);

it('materializes blank clear-format exceptions with native fonts, fills, number formats, borders and alignment', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', colStyles: { 2: {
    font: 'georgia', bold: true, bg: '#abcdef', fmt: 'currency', cur: 'EUR', dec: 3,
    align: 'right', indent: 2, wrap: true, bt: true, bb: true,
  } } }] });
  wb.clearRange(wb.activeSheetId, { r1: 4, c1: 2, r2: 6, c2: 2 }, { contents: false, styles: true });
  const before = wb.toJSON(), { native, own, xml } = await saved(wb);
  for (const back of [native, own]) for (let r = 4; r <= 6; r++) {
    const s = at(back, r, 2);
    for (const key of ['bold', 'bg', 'wrap', 'bt', 'bb', 'indent']) expect(s?.[key], `${r}: ${key}`).toBeFalsy();
    expect(s?.font || 'calibri').toBe('calibri'); expect(s?.fmt || 'general').toBe('general');
    expect(s?.align).toBeFalsy();
  }
  expect(at(native, 3, 2)).toMatchObject({ font: 'georgia', bold: true, bg: '#abcdef', fmt: 'currency' });
  expect(at(native, 7, 2)).toMatchObject({ bg: '#abcdef' });
  expect([...xml.matchAll(/<c\b/g)]).toHaveLength(3);
  expect(wb.toJSON()).toEqual(before); expect(wb.activeSheet.cells.size).toBe(0);
});

it('restores the workbook Normal font and preserves unrelated inherited properties in a partial-key reset', async () => {
  const wb = new Workbook({ normalFont: { name: 'Arial', sz: 15, bold: true }, sheets: [{ name: 'Data',
    colStyles: { 1: { font: 'georgia', size: 32, bold: false, bg: '#123456' } },
    styleResets: [{ range: { r1: 2, c1: 1, r2: 3, c2: 1 }, keys: ['font', 'size', 'bold'] }],
  }] });
  const { native } = await saved(wb);
  expect(at(native, 2, 1)).toMatchObject({ font: 'arial', size: 20, bold: true, bg: '#123456' });
  expect(at(native, 4, 1)).toMatchObject({ font: 'georgia', size: 32, bg: '#123456' });
  expect(at(native, 4, 1).bold).toBeFalsy();
});

it('restores default digit grouping when clearing an inherited false grouping flag', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', colStyles: { 1: { fmt: 'number', group: false } },
    styleResets: [{ range: { r1: 2, c1: 1, r2: 2, c2: 1 }, keys: ['group'] }],
  }] });
  const { native, own } = await saved(wb);
  for (const back of [native, own]) {
    back.setInput(back.activeSheetId, 2, 1, '12345');
    expect(back.getDisplay(back.activeSheetId, 2, 1)).toBe('12,345.00');
    back.setInput(back.activeSheetId, 3, 1, '12345');
    expect(back.getDisplay(back.activeSheetId, 3, 1)).toBe('12345.00');
  }
});

it('handles intersecting defaults, skipped rows and existing cells without duplicate native records', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', colStyles: { 1: { bg: '#abcdef' } }, rowStyles: { 4: { bold: true } },
    cells: { '3,1': { v: 7 }, '4,1': { f: 'B4*2' }, '5,2': { v: null, s: { italic: true } } },
  }] });
  wb.clearRange(wb.activeSheetId, { r1: 3, c1: 1, r2: 5, c2: 2 }, { contents: false, styles: true, skipRow: r => r === 4 });
  const { native, xml } = await saved(wb);
  expect(at(native, 3, 1)?.bg).toBeFalsy(); expect(at(native, 5, 1)?.bg).toBeFalsy();
  expect(at(native, 4, 1)).toMatchObject({ bg: '#abcdef', bold: true });
  expect(native.getValue(native.activeSheetId, 4, 1)).toBe(14);
  const addresses = [...xml.matchAll(/<c\b[^>]*\br="([^"]+)"/g)].map(m => m[1]);
  expect(new Set(addresses).size).toBe(addresses.length);
});

it('exports whole-column clears across sparse row defaults without materializing the rest of the column', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', rows: 400, cols: 26,
    rowStyles: { 5: { italic: true, bg: '#aabbcc' }, 30: { bold: true } }, colStyles: { 2: { fmt: 'percent' } },
  }] });
  wb.clearRange(wb.activeSheetId, { r1: 0, c1: 2, r2: 399, c2: 2 }, { contents: false, styles: true });
  const { native, xml } = await saved(wb);
  expect(at(native, 5, 2)?.italic).toBeFalsy(); expect(at(native, 5, 2)?.bg).toBeFalsy();
  expect(at(native, 30, 2)?.bold).toBeFalsy(); expect(at(native, 5, 3)?.italic).toBe(true);
  expect([...xml.matchAll(/<c\b/g)]).toHaveLength(2);
});

it('walks only intersecting styled lines for a large empty reset rectangle', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data',
    rowStyles: { 7: { italic: true }, [MAX_ROW]: { bold: true } },
    styleResets: [{ range: { r1: 0, c1: 2, r2: MAX_ROW, c2: 3 }, keys: ['italic', 'bold'] }],
  }] });
  expect([...xlsxResetCells(wb.activeSheet)]).toEqual([{ r: 7, c: 2 }, { r: 7, c: 3 }, { r: MAX_ROW, c: 2 }, { r: MAX_ROW, c: 3 }]);
  wb.activeSheet.styleResets = [{ range: { r1: 0, c1: 0, r2: MAX_ROW, c2: MAX_COL }, keys: ['bg'] }];
  expect([...xlsxResetCells(wb.activeSheet)]).toEqual([]);
});

it('does not emit exceptions when a row override or Normal already supplies the cleared appearance', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', colStyles: { 1: { bold: true } }, rowStyles: { 3: { bold: false } },
    styleResets: [{ range: { r1: 3, c1: 1, r2: 3, c2: 1 }, keys: ['bold'] }],
  }] });
  expect([...xlsxResetCells(wb.activeSheet)]).toEqual([]);
  wb.activeSheet.rowStyles.set(3, { bold: true });
  expect([...xlsxResetCells(wb.activeSheet, { bold: true })]).toEqual([]);
});

it('skips large no-op rectangles masked by contiguous row overrides in work proportional to the line styles', () => {
  const count = 4000;
  let reads = 0;
  const style = value => ({ get bg() {
    if (++reads > count * 2 * 12) throw new Error('Visited the Cartesian product of line styles');
    return value;
  } });
  const sheet = {
    colStyles: new Map(Array.from({ length: count }, (_, c) => [c, style('#123456')])),
    rowStyles: new Map(Array.from({ length: count }, (_, r) => [r, style(null)])),
    styleResets: [{ range: { r1: 0, c1: 0, r2: count - 1, c2: count - 1 }, keys: ['bg'] }],
  };
  expect([...xlsxResetCells(sheet)]).toEqual([]);
});

it('matches per-cell inheritance across clipped runs, gaps, mixed keys and overlapping resets', () => {
  const styles = [{}, { bg: '#123456' }, { bg: null }, { bold: true }, { bold: false }, { bg: '#abcdef', bold: true }];
  const sheet = {
    colStyles: new Map(styles.map((s, c) => [c + 1, s])),
    rowStyles: new Map(styles.flatMap((s, r) => [[r * 3, s], [r * 3 + 1, { ...s, italic: true }]])),
    styleResets: [
      { range: { r1: 1, c1: 0, r2: 15, c2: 7 }, keys: ['bg', 'bold'] },
      { range: { r1: 0, c1: 2, r2: 17, c2: 5 }, keys: ['bg'] },
      { range: { r1: 4, c1: 0, r2: 9, c2: 7 }, keys: ['bold'] },
    ],
  };
  const normalize = v => v == null || v === false || v === '' ? null : v;
  for (const normal of [null, { bg: '#123456', bold: true }]) {
    const expected = new Set();
    for (const { range: g, keys } of sheet.styleResets) {
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        const inherited = { ...normal, ...sheet.colStyles.get(c), ...sheet.rowStyles.get(r) };
        if (keys.some(k => normalize(inherited[k]) !== normalize(normal?.[k]))) expected.add(`${r},${c}`);
      }
    }
    expect(new Set([...xlsxResetCells(sheet, normal)].map(({ r, c }) => `${r},${c}`))).toEqual(expected);
  }
});
