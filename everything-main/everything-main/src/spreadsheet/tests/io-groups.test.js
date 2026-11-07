import { afterEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { META_SHEET, workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { MAX_ROW, MAX_COL } from '../src/core/refs.js';

afterEach(() => vi.restoreAllMocks());

async function importGroups(groups) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[42]]), 'Data');
  const metadata = JSON.stringify({ v: 1, sheets: { Data: { groups } } });
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[metadata]]), META_SHEET);
  return workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'groups.xlsx');
}

describe('imported outline bounds', () => {
  it.each([['row', 'rows', MAX_ROW], ['col', 'cols', MAX_COL]])('ignores out-of-grid %s groups before collapsing them', async (axis, key, max) => {
    const valid = { from: 1, to: 3, collapsed: false };
    const wb = await importGroups({ [key]: [
      valid,
      { from: 0, to: 1e100 },
      { from: 1e100, to: 1e100 },
      { from: max, to: max + 1 },
    ] });
    const hidden = axis === 'row' ? wb.activeSheet.hiddenRows : wb.activeSheet.hiddenCols;
    const add = hidden.add.bind(hidden);
    let calls = 0;
    // Stop a buggy loop promptly instead of hanging the test process.
    vi.spyOn(hidden, 'add').mockImplementation((index) => {
      if (++calls > 1000) throw new Error('Outline exceeded its iteration budget');
      return add(index);
    });
    expect(() => wb.setAllGroups(wb.activeSheetId, axis, true)).not.toThrow();
    expect([...hidden]).toEqual([1, 2, 3]);
    wb.undo();
    expect(wb.activeSheet.groups[key]).toEqual([valid]);
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
    wb.redo();
    const back = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'saved.xlsx');
    expect(back.activeSheet.groups[key]).toEqual([{ ...valid, collapsed: true }]);
    back.setAllGroups(back.activeSheetId, axis, false);
    expect([...(axis === 'row' ? back.activeSheet.hiddenRows : back.activeSheet.hiddenCols)]).toEqual([]);
  });

  it.each([['row', 'rows', MAX_ROW], ['col', 'cols', MAX_COL]])('retains valid %s groups at the file format limit', async (axis, key, max) => {
    const group = { from: max - 1, to: max, collapsed: false };
    const wb = await importGroups({ [key]: [group] });
    const back = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'saved.xlsx');
    expect(back.activeSheet.groups[key]).toEqual([group]);
    back.toggleGroup(back.activeSheetId, axis, group.from, group.to);
    expect([...(axis === 'row' ? back.activeSheet.hiddenRows : back.activeSheet.hiddenCols)]).toEqual([max - 1, max]);
  });
});
