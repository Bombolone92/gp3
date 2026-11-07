import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { META_SHEET, workbookFromFile, workbookToXlsx, sheetToHtml } from '../src/core/io.js';

afterEach(() => { delete Object.prototype.s; });

describe('untrusted workbook metadata', () => {
  it('ignores style coordinates outside the supported grid before exporting', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[42]]), 'Data');
    const styles = {
      '0,0': { bold: true },
      '1048576,0': { fmt: 'number' },
      '0,16384': { fmt: 'number' },
      [`0,${'9'.repeat(309)}`]: { fmt: 'number' },
    };
    const json = JSON.stringify({ v: 1, sheets: { Data: { styles } } });
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[json]]), META_SHEET);
    const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'styles.xlsx');
    expect([...wb.activeSheet.cells.keys()]).toEqual(['0,0']);
    expect(wb.getCell(wb.activeSheetId, 0, 0).s.bold).toBe(true);
    const back = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'saved.xlsx');
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(42);
  });

  it.each(['rules', 'protectedRanges', 'validations', 'charts', 'tables'])('opens cell data when the %s metadata collection is malformed', async (field) => {
    for (const invalid of [{ invalid: true }, 'invalid', 42, true]) {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[42, 'Keep this cell']]), 'Data');
      const metadata = { [field]: invalid, styles: { '0,0': { bold: true } } };
      const json = JSON.stringify({ v: 1, sheets: { Data: metadata } });
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[json]]), META_SHEET);
      const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'metadata.xlsx');
      expect(wb.activeSheet[field]).toEqual([]);
      expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
      expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe('Keep this cell');
      expect(wb.getCell(wb.activeSheetId, 0, 0).s.bold).toBe(true);
      const back = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'saved.xlsx');
      expect(back.getValue(back.activeSheetId, 0, 1)).toBe('Keep this cell');
    }
  });

  it.each([
    { rows: [1, 'Infinity', 1e100, 2.5, -1], cols: [2, 'Infinity', 1e100, 3.5, -1] },
    { rows: { invalid: true }, cols: 42 },
  ])('ignores invalid hidden-line indices instead of letting them drive export loops (%j)', async (hidden) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[42]]), 'Data');
    const json = JSON.stringify({ v: 1, sheets: { Data: { hidden } } });
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[json]]), META_SHEET);
    const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'hidden.xlsx');
    expect([...wb.activeSheet.hiddenRows]).toEqual(Array.isArray(hidden.rows) ? [1] : []);
    expect([...wb.activeSheet.hiddenCols]).toEqual(Array.isArray(hidden.cols) ? [2] : []);
    const back = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'saved.xlsx');
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(42);
    expect([...back.activeSheet.hiddenRows]).toEqual([...wb.activeSheet.hiddenRows]);
    expect([...back.activeSheet.hiddenCols]).toEqual([...wb.activeSheet.hiddenCols]);
  });

  it.each([[400, 60], [400.5, 60.5], [1e100, 1e100], ['invalid', 'invalid']])('validates saved dimensions %s × %s without hiding imported cells', async (rows, cols) => {
    const book = XLSX.utils.book_new();
    const data = XLSX.utils.aoa_to_sheet([[42]]);
    data.AZ200 = { t: 's', v: 'Keep this cell' };
    data['!ref'] = 'A1:AZ200';
    XLSX.utils.book_append_sheet(book, data, 'Data');
    const json = JSON.stringify({ v: 1, sheets: { Data: { rows, cols } } });
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[json]]), META_SHEET);
    const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'dimensions.xlsx');
    expect(wb.activeSheet.rows).toBe(rows === 400 ? 400 : 220);
    expect(wb.activeSheet.cols).toBe(cols === 60 ? 60 : 57);
    expect(wb.getValue(wb.activeSheetId, 199, 51)).toBe('Keep this cell');
  });

  it('does not mutate object prototypes through style keys', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[42]]), 'Data');
    const json = '{"v":1,"sheets":{"Data":{"styles":{"__proto__":{"bold":true},"0,0":{"italic":true}}}}}';
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[json]]), META_SHEET);
    const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'untrusted.xlsx');
    expect(Object.hasOwn(Object.prototype, 's')).toBe(false);
    expect(wb.getCell(wb.activeSheetId, 0, 0).s).toEqual({ italic: true });
    expect(wb.activeSheet.cells.size).toBe(1);
  });
});

describe('style values from the metadata sheet', () => {
  async function importStyles(styles) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Total']]), 'Data');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[JSON.stringify({ v: 1, sheets: { Data: { styles } } })]]), META_SHEET);
    return workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'styles.xlsx');
  }

  it('drops colors, alignments, and sizes that are not well formed, keeping the rest', async () => {
    const wb = await importStyles({ '0,0': {
      bold: true, color: 'red;background:url(https://attacker.example/beacon)', bg: '#ABCDEF', align: 'right;color:red', valign: 'top',
      size: '12px;color:red', indent: { toString: () => '1;x' }, dec: 2,
    } });
    expect(wb.getCell(wb.activeSheetId, 0, 0).s).toEqual({ bold: true, bg: '#ABCDEF', valign: 'top', dec: 2 });
  });

  it('writes only well-formed style values into the exported web page', async () => {
    const wb = await importStyles({ '0,0': { color: 'red;background:url(https://attacker.example/beacon)', bg: '#fef3c7', align: 'left' } });
    // A style that slipped past the import (an older file, a future key) is still written safely.
    wb.activeSheet.cells.get('0,0').s.size = '13px;background:url(https://attacker.example/x)';
    const html = sheetToHtml(wb, wb.activeSheetId);
    expect(html).not.toContain('attacker.example');
    expect(html).toContain('background-color:#fef3c7');
    expect(html).toContain('text-align:left');
  });
});
