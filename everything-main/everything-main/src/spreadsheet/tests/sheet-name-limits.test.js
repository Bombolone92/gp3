import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { quoteSheet } from '../src/core/refs.js';

describe('generated worksheet names', () => {
  it.each(['duplicate', 'import'])('keeps repeated %s names within the file format limit', async (operation) => {
    const name = 'Quarterly financial projections'; // 31 characters
    expect(name).toHaveLength(31);
    const source = new Workbook({ sheets: [{ name }] });
    source.setInput(source.activeSheetId, 0, 0, '42');
    source.setInput(source.activeSheetId, 0, 1, `=${quoteSheet(name)}!A1`);
    const wb = operation === 'duplicate' ? source : new Workbook({ sheets: [{ name }] });
    const copies = Array.from({ length: 3 }, () => operation === 'duplicate'
      ? wb.duplicateSheet(source.sheets[0].id) : wb.importSheets(source)[0]);
    expect(new Set(wb.sheets.map((sheet) => sheet.name.toLowerCase())).size).toBe(4);
    for (const copy of copies) {
      expect(copy.name.length).toBeLessThanOrEqual(31);
      expect(wb.getValue(copy.id, 0, 1)).toBe(42);
      expect(copy.cells.get('0,1').f).toBe(`${quoteSheet(copy.name)}!A1`);
    }
    const back = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'names.xlsx');
    expect(back.sheets.map((sheet) => sheet.name)).toEqual(wb.sheets.map((sheet) => sheet.name));
    wb.undo();
    expect(wb.sheets).toHaveLength(3);
    wb.redo();
    expect(wb.sheets).toHaveLength(4);
    expect(wb.getValue(copies[2].id, 0, 1)).toBe(42);
  });
});
