import { describe, expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

describe('number formats on empty cells', () => {
  it.each([
    { fmt: 'text' },
    { fmt: 'currency', cur: 'EUR', dec: 2 },
    { fmt: 'custom', code: '00000' },
  ])('keeps $fmt formatting through a save and reopen', async (style) => {
    const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: 200, cols: 40 }] });
    wb.applyStyle(wb.activeSheetId, { r1: 120, r2: 120, c1: 30, c2: 30 }, style);
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const raw = XLSX.read(bytes, { type: 'array', cellNF: true, sheetStubs: true });
    expect(raw.Sheets.Sheet1.AE121?.z).toBeTruthy();
    const back = await workbookFromFile(bytes, 'formatted.xlsx');
    expect(back.getCell(back.activeSheetId, 120, 30)?.s).toMatchObject(style);
    expect(back.getValue(back.activeSheetId, 120, 30)).toBeNull();
    expect(back.activeSheet.rows).toBeGreaterThan(120);
    expect(back.activeSheet.cols).toBeGreaterThan(30);
    if (style.fmt === 'text') {
      back.setInput(back.activeSheetId, 120, 30, '00123');
      expect(back.getValue(back.activeSheetId, 120, 30)).toBe('00123');
    }
  });

  it('imports an empty formatted cell from an external workbook', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { A1: { t: 'z', z: '0.00%' }, '!ref': 'A1' }, 'Data');
    const back = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'external.xlsx');
    expect(back.getCell(back.activeSheetId, 0, 0)?.s).toMatchObject({ fmt: 'percent', dec: 2 });
    expect(back.getValue(back.activeSheetId, 0, 0)).toBeNull();
  });

  it('keeps spilled values and their formats without introducing blocking cells', async () => {
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, '=SEQUENCE(2)');
    wb.applyStyle(wb.activeSheetId, { r1: 1, r2: 1, c1: 0, c2: 0 }, { fmt: 'percent', dec: 2 });
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const raw = XLSX.read(bytes, { type: 'array', cellNF: true });
    expect(raw.Sheets.Sheet1.A2.v).toBe(2);
    expect(raw.Sheets.Sheet1.A2.z).toBe('#,##0.00%');
    const back = await workbookFromFile(bytes, 'spill.xlsx');
    expect(back.getValue(back.activeSheetId, 1, 0)).toBe(2);
    expect(back.getCell(back.activeSheetId, 1, 0)?.s).toMatchObject({ fmt: 'percent', dec: 2 });
    expect(back.getCell(back.activeSheetId, 1, 0)?.v).toBeNull();
  });
});
