import { describe, expect, it } from 'vitest';
import { stringifyXlsxMetadata, parseXlsxMetadata } from '../src/core/xlsx-metadata-codec.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const style = { bold: false, bg: null, font: 'Arial', size: 14, color: { rgb: '#123456', theme: 4, tint: 0.2 }, wrap: true };
const repeated = () => Object.fromEntries(Array.from({ length: 40 }, (_, r) => [`${r},0`, structuredClone(style)]));

describe('XLSX private style indexing', () => {
  it('deduplicates exact styles without changing the source or other metadata, and keeps the shared pool read-only', () => {
    const meta = { v: 1, format: 'puter-spreadsheet', sheets: { Data: { styles: repeated(), nativeStyles: true, charts: [{ text: '😺 _x000A_ <&>' }] } } };
    const before = structuredClone(meta), json = stringifyXlsxMetadata(meta);
    expect(json.length).toBeLessThan(JSON.stringify(meta).length / 2);
    expect(JSON.parse(json).sheets.Data.styles.values).toHaveLength(1);
    expect(meta).toEqual(before);
    const back = parseXlsxMetadata(json);
    expect(back).toEqual(before);
    expect(back.sheets.Data.styles['0,0']).toBe(back.sheets.Data.styles['1,0']);
    expect(() => { back.sheets.Data.styles['0,0'].color.rgb = '#ffffff'; }).toThrow(TypeError);
    expect(back.sheets.Data.styles['1,0'].color.rgb).toBe('#123456');
  });

  it('retains small legacy maps and distinguishes absent, null, false, and empty overrides', () => {
    const styles = { '0,0': {}, '1,0': { bg: null }, '2,0': { bold: false }, '3,0': { code: '' } };
    const meta = { sheets: { Data: { styles } } };
    expect(JSON.parse(stringifyXlsxMetadata(meta))).toEqual(meta);
    expect(parseXlsxMetadata(JSON.stringify(meta))).toEqual(meta);
  });

  it.each(['colStyles', 'rowStyles'])('indexes repeated %s independently of cell overrides and preserves legacy maps', field => {
    const lines = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [i, structuredClone(style)]));
    lines[23] = { ...style, bg: '#fedcba', bold: null };
    const meta = { sheets: { Data: { [field]: lines, styles: repeated(), other: { note: 'unchanged' } }, Small: { [field]: { 2: { bold: false }, 3: {} } } } };
    const before = structuredClone(meta), json = stringifyXlsxMetadata(meta), raw = JSON.parse(json);
    expect(json.length).toBeLessThan(JSON.stringify(meta).length / 2);
    expect(raw.sheets.Data[field].values).toHaveLength(2);
    expect(raw.sheets.Small[field]).toEqual(before.sheets.Small[field]);
    expect(meta).toEqual(before);
    const back = parseXlsxMetadata(json);
    expect(back).toEqual(before);
    expect(back.sheets.Data[field][0]).toBe(back.sheets.Data[field][1]);
    expect(back.sheets.Data[field][23]).not.toBe(back.sheets.Data[field][0]);
    expect(() => { back.sheets.Data[field][0].color.rgb = '#ffffff'; }).toThrow(TypeError);
    expect(parseXlsxMetadata(JSON.stringify(before))).toEqual(before);
  });

  it.each(['colStyles', 'rowStyles'])('rejects invalid pooled %s keys and indices without inheriting prototype properties', field => {
    const meta = JSON.parse('{"sheets":{"__proto__":{}}}');
    meta.sheets.__proto__[field] = { encoding: 'style-index-v1', values: [{ wrap: true }, null, []],
      cells: JSON.parse('{"0":0,"17":0,"1,0":0,"-1":0,"1":-1,"2":0.5,"3":"0","4":9,"5":1,"6":2,"__proto__":0,"constructor":0}') };
    const back = parseXlsxMetadata(JSON.stringify(meta)).sheets.__proto__[field];
    expect(back).toEqual({ 0: { wrap: true }, 17: { wrap: true } });
    expect(Object.getPrototypeOf(back)).toBeNull();
    expect(back[0]).toBe(back[17]);
  });

  it('keeps exact null, false, empty and absent properties distinct in repeated line styles', () => {
    const variants = [{}, { bg: null }, { bold: false }, { code: '' }];
    const lines = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [i, variants[i % variants.length]]));
    const meta = { sheets: { Data: { colStyles: lines, rowStyles: lines } } };
    const raw = JSON.parse(stringifyXlsxMetadata(meta));
    expect(raw.sheets.Data.colStyles.values).toHaveLength(4);
    expect(parseXlsxMetadata(JSON.stringify(raw))).toEqual(meta);
  });

  it('supports special sheet names and ignores invalid indices and prototype keys', () => {
    const meta = JSON.parse('{"sheets":{"__proto__":{"styles":{"encoding":"style-index-v1","values":[{"bold":false},null,[]],"cells":{"0,0":0,"1,0":-1,"2,0":0.5,"3,0":"0","4,0":9,"5,0":1,"6,0":2,"__proto__":0}}}}}');
    const back = parseXlsxMetadata(JSON.stringify(meta));
    expect(Object.keys(back.sheets)).toEqual(['__proto__']);
    expect(back.sheets.__proto__.styles).toEqual({ '0,0': { bold: false } });
    expect(Object.getPrototypeOf(back.sheets.__proto__.styles)).toBeNull();
    const source = { sheets: Object.fromEntries([['__proto__', { styles: repeated() }]]) };
    expect(parseXlsxMetadata(stringifyXlsxMetadata(source))).toEqual(source);
  });

  it.each([null, 42, [], { encoding: 'style-index-v1', values: {}, cells: { '0,0': 0 } }])('handles malformed style maps (%j)', styles => {
    const meta = { sheets: { Data: { styles } } };
    expect(() => parseXlsxMetadata(stringifyXlsxMetadata(meta))).not.toThrow();
  });

  it.each([false, true])('preserves overrides, edits, copies and native baselines over two complete exports (drawing: %s)', async drawing => {
    const cells = Object.fromEntries(Array.from({ length: 40 }, (_, r) => [`${r},0`, { v: r, s: { bold: false, bg: null, wrap: true, color: '#123456', size: 14 } }]));
    let wb = new Workbook({ sheets: [{ name: 'Data', cells, colStyles: { 0: { bold: true, bg: '#ff0000' } } }] });
    if (drawing) wb.addChart(wb.activeSheetId, { type: 'text', text: '😺 _x000A_ <&>', anchor: { r: 0, c: 3 } });
    for (let cycle = 0; cycle < 2; cycle++) {
      const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
      const raw = X.read(bytes, { type: 'array' });
      const json = Object.entries(raw.Sheets._puter_meta).filter(([a]) => /^A\d+$/.test(a)).map(([, c]) => c.v).join('');
      const metadata = JSON.parse(json).sheets.Data;
      expect(metadata.styles.encoding).toBe('style-index-v1');
      if (drawing) expect(metadata.nativeDrawings).toHaveLength(1);
      wb = await workbookFromFile(bytes);
      expect(wb.getCell(wb.activeSheetId, 5, 0).s).toMatchObject({ bold: false, bg: null, wrap: true, color: '#123456', size: 14 });
      expect(wb.styleAt(wb.activeSheetId, 50, 0)).toMatchObject({ bold: true, bg: '#ff0000' });
      expect(wb.getValue(wb.activeSheetId, 39, 0)).toBe(39);
      if (drawing) expect(wb.activeSheet.charts[0].text).toBe('😺 _x000A_ <&>');
    }
    const id = wb.activeSheetId;
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { color: '#abcdef' });
    expect(wb.getCell(id, 1, 0).s.color).toBe('#123456');
    wb.undo(); expect(wb.getCell(id, 0, 0).s.color).toBe('#123456');
    wb.redo(); expect(wb.getCell(id, 0, 0).s.color).toBe('#abcdef');
    wb.pasteCells(id, wb.copyCells(id, [0], [0]), 0, 1, { r: 0, c: 0 });
    expect(wb.getCell(id, 0, 1).s.color).toBe('#abcdef');
  });

  it('retains pooled line defaults, independent edits, undo and copies through app and native-only exports', async () => {
    const cols = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [i, { font: 'arial', color: '#123456', bg: '#ffeecc', bold: true, wrap: true }]));
    const rows = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [i, { italic: true, bg: null, color: '#223344' }]));
    cols[23] = { ...cols[23], color: '#998877' }; rows[23] = { ...rows[23], italic: false };
    let wb = new Workbook({ sheets: [{ name: 'Lines', rows: 128, cols: 128, colStyles: cols, rowStyles: rows,
      cells: { '0,0': { v: 1 }, '2,2': { v: 3.5, s: { italic: false, bold: false, bg: '#fedcba' } } } }] });
    for (let cycle = 0; cycle < 2; cycle++) {
      const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
      const raw = X.read(bytes, { type: 'array' });
      const json = Object.entries(raw.Sheets._puter_meta).filter(([a]) => /^A\d+$/.test(a)).map(([, c]) => c.v).join('');
      for (const field of ['colStyles', 'rowStyles']) expect(JSON.parse(json).sheets.Lines[field].values).toHaveLength(2);
      wb = await workbookFromFile(bytes);
      expect(wb.styleAt(wb.activeSheetId, 80, 2)).toMatchObject({ color: '#123456', bg: '#ffeecc', bold: true, wrap: true });
      expect(wb.styleAt(wb.activeSheetId, 2, 80)).toMatchObject({ color: '#223344', italic: true });
      expect(wb.styleAt(wb.activeSheetId, 80, 23).color).toBe('#998877');
      expect(wb.styleAt(wb.activeSheetId, 2, 2)).toMatchObject({ bg: '#fedcba', bold: false, italic: false });
      expect(wb.getValue(wb.activeSheetId, 2, 2)).toBe(3.5);
    }
    const id = wb.activeSheetId;
    wb.clearHistory(); wb.applyStyle(id, { r1: 0, c1: 2, r2: wb.activeSheet.rows - 1, c2: 2 }, { color: '#abcdef' });
    expect(wb.styleAt(id, 80, 2).color).toBe('#abcdef'); expect(wb.styleAt(id, 80, 3).color).toBe('#123456');
    wb.undo(); expect(wb.styleAt(id, 80, 2).color).toBe('#123456');
    wb.redo(); expect(wb.styleAt(id, 80, 2).color).toBe('#abcdef');
    wb.setInput(id, 80, 2, '7'); wb.pasteCells(id, wb.copyRange(id, { r1: 80, c1: 2, r2: 80, c2: 2 }), 90, 90, { r: 80, c: 2 });
    expect(wb.getValue(id, 90, 90)).toBe(7); expect(wb.styleAt(id, 90, 90).color).toBe('#abcdef');
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
    const native = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    for (const [r, c] of [[80, 2], [80, 3], [2, 80], [80, 23], [2, 2], [90, 90]]) {
      const style = wb.styleAt(id, r, c), actual = native.styleAt(native.activeSheetId, r, c);
      for (const key of ['color', 'bg', 'bold', 'italic', 'wrap']) {
        const effective = value => ['bold', 'italic', 'wrap'].includes(key) ? !!value : value ?? null;
        expect(effective(actual[key]), `${r},${c} ${key}`).toEqual(effective(style[key]));
      }
    }
  });
});
