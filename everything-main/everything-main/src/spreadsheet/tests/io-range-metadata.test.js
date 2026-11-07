import { describe, expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { META_SHEET, workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const valid = { r1: 0, c1: 0, r2: 1, c2: 1 };
async function imported(field, ranges) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Amount', 'Name'], [42, 'Keep']]), 'Data');
  const entries = ranges.map((range, i) => ({ name: `Table_${i}`, type: field === 'validations' ? 'number' : 'scale', range }));
  const meta = JSON.stringify({ v: 1, sheets: { Data: { [field]: entries } } });
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[meta]]), META_SHEET);
  return workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'metadata.xlsx');
}

describe('ranges in imported metadata', () => {
  it.each(['tables', 'rules', 'validations', 'protectedRanges'])('rejects invalid %s ranges without discarding cells or valid metadata', async (field) => {
    const invalid = [
      { ...valid, c1: -1e100 }, { ...valid, c2: 1e100 },
      { ...valid, r2: 1048576 }, { ...valid, c2: 16384 },
      { ...valid, c1: 0.5 }, { ...valid, c2: '1' },
      { ...valid, r1: null }, {}, [], 'A1:B2',
    ];
    const wb = await imported(field, [...invalid, valid]);
    expect(wb.activeSheet[field]).toHaveLength(1);
    expect(wb.activeSheet[field][0].range).toEqual(valid);
    expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe(42);
    expect(wb.getValue(wb.activeSheetId, 1, 1)).toBe('Keep');
    if (field === 'tables') expect(wb.tableColumns(wb.activeSheetId, wb.activeSheet.tables[0])).toEqual(['Amount', 'Name']);
    const back = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'saved.xlsx');
    expect(back.activeSheet[field]).toHaveLength(1);
    expect(back.getValue(back.activeSheetId, 1, 0)).toBe(42);
  });

  it.each(['tables', 'rules', 'validations', 'protectedRanges'])('continues normalizing reversed valid %s ranges', async (field) => {
    const wb = await imported(field, [{ r1: 1, c1: 1, r2: 0, c2: 0 }]);
    expect(wb.activeSheet[field][0].range).toEqual(valid);
  });
});
