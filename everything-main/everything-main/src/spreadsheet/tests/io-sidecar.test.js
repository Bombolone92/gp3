import { describe, expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { META_SHEET, workbookFromFile, workbookToXlsx } from '../src/core/io.js';

describe('metadata sheet name collisions', () => {
  it.each(['__proto__', 'constructor', 'toString'])('preserves metadata for a sheet named %s', async (name) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.renameSheet(id, name);
    wb.setInput(id, 0, 0, '42');
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true, bg: '#ffeeaa' });
    wb.setFrozen(id, 2, 1);
    const back = await workbookFromFile(await workbookToXlsx(wb), 'named.xlsx');
    expect(back.activeSheet.name).toBe(name);
    expect(back.getCell(back.activeSheetId, 0, 0)).toMatchObject({ v: 42, s: { bold: true, bg: '#ffeeaa' } });
    expect(back.activeSheet.frozenRows).toBe(2);
    expect(back.activeSheet.frozenCols).toBe(1);
  });

  it.each([false, true])('keeps a user sheet named _puter_meta (styles: %s)', async (styled) => {
    const wb = new Workbook({ sheets: [{ name: META_SHEET }, { name: `${META_SHEET}2` }, { name: 'Summary' }] });
    const [data, other, summary] = wb.sheets;
    wb.setInput(data.id, 0, 0, '21');
    wb.setInput(other.id, 0, 0, 'other data');
    wb.setInput(summary.id, 0, 0, `=${META_SHEET}!A1*2`);
    if (styled) wb.applyStyle(data.id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true });
    const saved = await workbookToXlsx(wb);
    const raw = XLSX.read(await saved.arrayBuffer());
    expect(new Set(raw.SheetNames).size).toBe(raw.SheetNames.length);
    const back = await workbookFromFile(saved, 'collision.xlsx');
    expect(back.sheets.map((s) => s.name)).toEqual(wb.sheets.map((s) => s.name));
    expect(back.getValue(back.sheetByName(META_SHEET).id, 0, 0)).toBe(21);
    expect(back.getValue(back.sheetByName('Summary').id, 0, 0)).toBe(42);
    if (styled) expect(back.getCell(back.sheetByName(META_SHEET).id, 0, 0).s.bold).toBe(true);
  });
});
