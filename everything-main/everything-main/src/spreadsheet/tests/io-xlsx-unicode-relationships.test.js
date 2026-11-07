import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function makeBook(target) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:B1', A1: { t: 's', v: 'Open', l: { Target: target } }, B1: { t: 'n', v: 17 },
  }, 'Data');
  return book;
}

it.each([
  'https://example.com/café', 'https://example.com/日本語', 'https://example.com/😀',
  'https://例え.テスト/資料', 'https://example.com/e\u0301', 'https://example.com/Ã©',
  'https://example.com/你好?q=José&_x0041_=€', 'mailto:josé@example.com',
  'https://example.com/%F0%9F%98%80?q=%C3%A9', 'https://example.com/ascii?x=1&y=2',
])('preserves UTF-8 relationship target %s', async (target) => {
  let raw = makeBook(target);
  for (let round = 0; round < 2; ++round) {
    raw = XLSX.read(XLSX.write(raw, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    expect(raw.Sheets.Data.A1.l.Target).toBe(target);
  }
  let wb = await workbookFromFile(XLSX.write(makeBook(target), { type: 'array', bookType: 'xlsx' }), 'unicode.xlsx');
  for (let round = 0; round < 2; ++round) {
    expect(wb.linkAt(wb.activeSheetId, 0, 0)).toEqual({ url: target, label: 'Open' });
    expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(17);
    wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
});

it.each([
  ['https://example.com/caf&#233;', 'https://example.com/café'],
  ['https://example.com/&#x1F600;?q=&#x20AC;', 'https://example.com/😀?q=€'],
  ['https://example.com/é&#x1F600;?q=&amp;amp;', 'https://example.com/é😀?q=&amp;'],
  ['https://example.com/é_x0041_', 'https://example.com/é_x0041_'],
])('decodes Unicode before XML entities, exactly once: %s', async (encoded, expected) => {
  const zip = XLSX.CFB.read(new Uint8Array(XLSX.write(makeBook('SENTINEL'), { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const entry = zip.FileIndex.find((e) => e.name === 'sheet1.xml.rels');
  entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content).replace('SENTINEL', encoded));
  entry.size = entry.content.length;
  const wb = await workbookFromFile(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'entities.xlsx');
  expect(wb.linkAt(wb.activeSheetId, 0, 0)?.url).toBe(expected);
});
