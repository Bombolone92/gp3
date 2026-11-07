import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { META_SHEET, workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function file(hidden, hiddenFirst = false, allHidden = false) {
  const book = XLSX.utils.book_new();
  const names = hiddenFirst ? ['Lookup', 'Summary'] : ['Summary', 'Lookup'];
  for (const name of names) {
    const sheet = name === 'Summary'
      ? { '!ref': 'A1', A1: { t: 'n', f: 'Lookup!A1*2', v: 42 } }
      : XLSX.utils.aoa_to_sheet([[21]]);
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  const meta = { v: 1, active: 'Lookup', sheets: {} };
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[JSON.stringify(meta)]]), META_SHEET);
  book.Workbook = { Sheets: [
    ...names.map((name) => ({ name, Hidden: name === 'Lookup' ? hidden : allHidden ? 1 : 0 })),
    { name: META_SHEET, Hidden: 2 },
  ] };
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

it.each([[1, false], [2, false], [1, true], [2, true]])('keeps a visible sheet active when metadata points to hidden state %s (hidden first: %s)', async (hidden, hiddenFirst) => {
  const wb = await workbookFromFile(file(hidden, hiddenFirst), 'hidden.xlsx');
  for (const roundTrip of [false, true]) {
    const back = roundTrip ? await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx') : wb;
    expect(back.activeSheet.name).toBe('Summary');
    expect(back.activeSheet.hidden).toBe(false);
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(42);
    const lookup = back.sheetByName('Lookup');
    expect(lookup.hidden).toBe(true);
    expect(lookup.veryHidden).toBe(hidden === 2);
    expect(back.getValue(lookup.id, 0, 0)).toBe(21);
    expect(back.dirty).toBe(false);
  }
});

it('preserves the visible fallback when all source worksheets were hidden', async () => {
  const wb = await workbookFromFile(file(2, false, true), 'all-hidden.xlsx');
  expect(wb.activeSheet.name).toBe('Summary');
  expect(wb.activeSheet.hidden).toBe(false);
  expect(wb.sheetByName('Lookup').hidden).toBe(true);
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
});
