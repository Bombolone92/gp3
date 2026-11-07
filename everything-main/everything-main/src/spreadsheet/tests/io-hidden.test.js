import { describe, expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

describe('very hidden worksheets', () => {
  it('keeps supporting data and formulas when importing and saving an Excel workbook', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 'n', f: 'Lookup!A1*2', v: 42 } }, 'Summary');
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[21]]), 'Lookup');
    book.Workbook = { Sheets: [{ name: 'Summary', Hidden: 0 }, { name: 'Lookup', Hidden: 2 }] };
    const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'hidden.xlsx');
    expect(wb.sheets.map((s) => s.name)).toEqual(['Summary', 'Lookup']);
    expect(wb.sheetByName('Lookup').hidden).toBe(true);
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
    const saved = await workbookToXlsx(wb);
    const raw = XLSX.read(await saved.arrayBuffer());
    expect(raw.Workbook.Sheets.find((s) => s.name === 'Lookup').Hidden).toBe(2);
    const reopened = await workbookFromFile(saved, 'hidden.xlsx');
    expect(reopened.getValue(reopened.activeSheetId, 0, 0)).toBe(42);
    // Users can still explicitly show a hidden sheet, and undo the action.
    const lookup = reopened.sheetByName('Lookup');
    reopened.setSheetHidden(lookup.id, false);
    reopened.undo();
    expect(reopened.sheetByName('Lookup').hidden).toBe(true);
    const undone = XLSX.read(await (await workbookToXlsx(reopened)).arrayBuffer());
    expect(undone.Workbook.Sheets.find((s) => s.name === 'Lookup').Hidden).toBe(2);
  });
});
