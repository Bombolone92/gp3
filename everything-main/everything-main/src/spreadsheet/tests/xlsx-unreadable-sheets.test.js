import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function zipOf(book) {
  return XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx', bookSST: true })), { type: 'array' });
}
function editPart(zip, name, edit) {
  const entry = zip.FileIndex.find((e) => e.name === name);
  entry.content = new TextEncoder().encode(edit(new TextDecoder().decode(entry.content)));
  entry.size = entry.content.length;
}
function removePart(zip, name) {
  const i = zip.FileIndex.findIndex((e) => e.name === name);
  zip.FileIndex.splice(i, 1);
  zip.FullPaths.splice(i, 1);
}
const bytesOf = (zip) => XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });

function twoSheetBook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['SENTINEL', 17], ['second', 5]]), 'Data');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['other']]), 'Other');
  return book;
}

it.each([
  ['an index past the string table', '<v>999</v>'],
  ['an index that is not a number', '<v>abc</v>'],
])('imports the rest of a sheet when one shared string has %s', async (_, bad) => {
  const zip = zipOf(twoSheetBook());
  editPart(zip, 'sheet1.xml', (xml) => xml.replace('<c r="A2" t="s"><v>1</v>', `<c r="A2" t="s">${bad}`));
  const bytes = bytesOf(zip);
  const raw = XLSX.read(bytes, { type: 'array', sheetStubs: true });
  expect(raw.Sheets.Data.A2?.v).toBeUndefined();
  const wb = await workbookFromFile(bytes, 'strings.xlsx');
  const id = wb.sheetByName('Data').id;
  expect(wb.getValue(id, 0, 0)).toBe('SENTINEL');
  expect(wb.getValue(id, 0, 1)).toBe(17);
  expect(wb.getValue(id, 1, 1)).toBe(5);
  expect(wb.getCell(id, 1, 0)).toBeUndefined();
  // Saving the opened file keeps the data that was readable.
  const back = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  const backId = back.sheetByName('Data').id;
  expect(back.getValue(backId, 0, 0)).toBe('SENTINEL');
  expect(back.getValue(backId, 1, 1)).toBe(5);
});

it('refuses a file whose sheet part cannot be read instead of opening it empty', async () => {
  const zip = zipOf(twoSheetBook());
  removePart(zip, 'sheet1.xml');
  const bytes = bytesOf(zip);
  // The vendor leaves the damaged sheet out of the book without a word.
  const raw = XLSX.read(bytes, { type: 'array' });
  expect(raw.SheetNames).toEqual(['Data', 'Other']);
  expect(raw.Sheets.Data).toBeUndefined();
  await expect(workbookFromFile(bytes, 'damaged.xlsx')).rejects.toThrow(/Sheet "Data" could not be read/);
});

it('still opens a file whose sheet holds nothing', async () => {
  const zip = zipOf(twoSheetBook());
  editPart(zip, 'sheet1.xml', () => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>');
  const wb = await workbookFromFile(bytesOf(zip), 'empty-sheet.xlsx');
  expect(wb.sheets.map((s) => s.name)).toEqual(['Data', 'Other']);
  expect(wb.usedRange(wb.sheetByName('Data').id)).toBeNull();
});
