import { expect, it } from 'vitest';
import * as XLSX from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

// Text such as www.puter.com is a link by itself, saved with the address it implies as its
// target. Reading the file compared the text to that target and, finding them different,
// wrapped the text in a HYPERLINK formula after every save.
it.each(['www.puter.com', 'WWW.Puter.com/docs', 'someone@example.com', 'https://puter.com/x'])('keeps %s as plain text through a save', async (text) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, text);
  const link = wb.linkAt(id, 0, 0);
  expect(link?.url).toBeTruthy();
  const back = await workbookFromFile(await workbookToXlsx(wb), 'links.xlsx');
  const bid = back.activeSheetId;
  expect(back.getCell(bid, 0, 0)).toMatchObject({ v: text, f: null });
  expect(back.linkAt(bid, 0, 0)).toEqual(link);
  expect(back.dirty).toBe(false);
});

it('preserves a native link separately from text whose label differs from its target', async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, {
    '!ref': 'A1:B1',
    A1: { t: 's', v: 'www.puter.com', l: { Target: 'https://example.com/elsewhere' } },
    B1: { t: 's', v: 'Puter', l: { Target: 'https://puter.com' } },
  }, 'Links');
  const wb = await workbookFromFile(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), 'links.xlsx');
  const id = wb.activeSheetId;
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 'www.puter.com', f: null, hyperlink: 'https://example.com/elsewhere' });
  expect(wb.getCell(id, 0, 1)).toMatchObject({ v: 'Puter', f: null, hyperlink: 'https://puter.com' });
});
