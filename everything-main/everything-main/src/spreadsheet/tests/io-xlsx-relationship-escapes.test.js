import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function archive(book) {
  return XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
}
function editPart(zip, name, edit) {
  const entry = zip.FileIndex.find((e) => e.name === name);
  entry.content = new TextEncoder().encode(edit(new TextDecoder().decode(entry.content)));
  entry.size = entry.content.length;
}

it.each([
  'https://example.com/_x0041_', 'https://example.com/_X00aF_',
  'https://example.com/_x005F_x0041_', 'https://example.com/_x0041_x0042_',
  'https://example.com/_xD83D__xDE00_', 'https://example.com/?q=_x000D_&next=_x000A_',
  'https://example.com/?q=_x0041_&literal=&amp;', 'https://example.com/%F0%9F%98%80/_x0041_',
  'mailto:user_x0041_@example.com', 'https://example.com/?a=&amp;&b=&#65;',
])('preserves literal relationship target %s', async (target) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 's', v: 'Link', l: { Target: target } } }, 'Data');
  const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
  let raw = XLSX.read(bytes, { type: 'array' });
  expect(raw.Sheets.Data.A1.l.Target).toBe(target);
  raw = XLSX.read(XLSX.write(raw, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
  expect(raw.Sheets.Data.A1.l.Target).toBe(target);
  let wb = await workbookFromFile(bytes, 'links.xlsx');
  for (let round = 0; round < 2; ++round) {
    expect(wb.linkAt(wb.activeSheetId, 0, 0)).toEqual({ url: target, label: 'Link' });
    expect(wb.getCell(wb.activeSheetId, 0, 0).hyperlink).toBe(target);
    expect(wb.getCell(wb.activeSheetId, 0, 0).f).toBeNull();
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
});

it.each([
  ['https://example.com/&#95;x0041_', 'https://example.com/_x0041_'],
  ['https://example.com/&#x5f;x005F_', 'https://example.com/_x005F_'],
  ['https://example.com/?a=1&amp;b=2', 'https://example.com/?a=1&b=2'],
  ['https://example.com/?q=&amp;amp;', 'https://example.com/?q=&amp;'],
])('decodes XML entities once in external relationship attributes: %s', async (encoded, expected) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, { '!ref': 'A1', A1: { t: 's', v: 'Link', l: { Target: 'SENTINEL' } } }, 'Data');
  const zip = archive(book);
  editPart(zip, 'sheet1.xml.rels', (xml) => xml.replace('SENTINEL', encoded));
  const wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  expect(wb.linkAt(wb.activeSheetId, 0, 0)?.url).toBe(expected);
});

it.each(['sheet_x0041_.xml', 'sheet_x005F_.xml', 'sheet_x0041_x0042_.xml', 'sheet&data.xml'])(
  'resolves the exact worksheet part name %s', async (filename) => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([[42]]), 'Data');
    const zip = archive(book);
    const index = zip.FileIndex.findIndex((e) => e.name === 'sheet1.xml');
    zip.FullPaths[index] = zip.FullPaths[index].replace('sheet1.xml', filename);
    zip.FileIndex[index].name = filename;
    const encoded = filename.replaceAll('&', '&amp;');
    editPart(zip, 'workbook.xml.rels', (xml) => xml.replaceAll('sheet1.xml', encoded));
    editPart(zip, '[Content_Types].xml', (xml) => xml.replaceAll('sheet1.xml', encoded));
    let wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'parts.xlsx');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
    expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(42);
  },
);
