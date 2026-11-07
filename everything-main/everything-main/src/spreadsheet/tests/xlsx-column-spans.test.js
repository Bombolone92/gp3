import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function editPart(zip, name, edit) {
  const entry = zip.FileIndex.find((e) => e.name === name);
  entry.content = new TextEncoder().encode(edit(new TextDecoder().decode(entry.content)));
  entry.size = entry.content.length;
}
function sheetXml(bytes) {
  const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' });
  return new TextDecoder().decode(XLSX.CFB.find(zip, 'sheet1.xml').content);
}

/** A sheet as Excel writes it after hiding every column from J on: one element covers the span. */
function spannedFile() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['a', 'b', 'c']]), 'Data');
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  editPart(zip, 'sheet1.xml', (xml) => xml.replace('<sheetData>',
    '<cols><col min="1" max="3" width="20.7109375" customWidth="1"/><col min="10" max="16384" width="9.140625" hidden="1"/></cols><sheetData>'));
  return XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it('writes runs of identical columns as one element, as Excel does', async () => {
  const wb = await workbookFromFile(spannedFile(), 'spans.xlsx');
  const sheet = wb.sheets[0];
  expect(sheet.hiddenCols.size).toBe(16384 - 9);
  const bytes = await (await workbookToXlsx(wb)).arrayBuffer();
  const xml = sheetXml(bytes);
  const cols = xml.match(/<col [^>]*>/g) || [];
  expect(cols.length).toBeLessThanOrEqual(4);
  expect(cols.some((c) => / min="10" max="16384"/.test(c) && /hidden="(1|true)"/.test(c))).toBe(true);
  expect(cols.some((c) => / min="1" max="3"/.test(c) && /customWidth="1"/.test(c))).toBe(true);
  expect(xml.length).toBeLessThan(20000);
  // The spans read back exactly.
  const back = await workbookFromFile(bytes, 'saved.xlsx');
  const backSheet = back.sheets[0];
  expect(backSheet.hiddenCols.size).toBe(16384 - 9);
  expect(backSheet.hiddenCols.has(8)).toBe(false);
  expect(backSheet.hiddenCols.has(9)).toBe(true);
  expect(backSheet.hiddenCols.has(16383)).toBe(true);
  expect(backSheet.colWidths.get(0)).toBe(sheet.colWidths.get(0));
  expect(backSheet.colWidths.get(2)).toBe(sheet.colWidths.get(2));
  expect(backSheet.colWidths.has(3)).toBe(false);
});

it('still writes neighbouring columns of different widths separately', async () => {
  const book = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([['a', 'b', 'c']]);
  ws['!cols'] = [{ wpx: 60 }, { wpx: 120 }, { wpx: 120, hidden: true }, { wpx: 120 }];
  XLSX.utils.book_append_sheet(book, ws, 'Data');
  const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'widths.xlsx');
  const xml = sheetXml(await (await workbookToXlsx(wb)).arrayBuffer());
  const cols = xml.match(/<col [^>]*>/g) || [];
  expect(cols.length).toBe(4);
  expect(cols.map((c) => c.match(/min="(\d+)" max="(\d+)"/).slice(1).join('-'))).toEqual(['1-1', '2-2', '3-3', '4-4']);
});
