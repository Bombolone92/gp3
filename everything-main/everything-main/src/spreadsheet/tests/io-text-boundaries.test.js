import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_TEXT } from '../src/core/cell.js';
import { workbookToXlsx, workbookToOds, workbookFromFile } from '../src/core/io.js';

// Text past the file format's limit is cut on save; the cut used to fall between the two
// halves of an emoji sitting on the limit, which came back as a replacement mark.
it.each([
  ['xlsx', workbookToXlsx],
  ['ods', workbookToOds],
])('cuts over-long text on a character boundary when saving as %s', async (extension, save) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 'a'.repeat(MAX_TEXT - 1) + '\u{1F600}', f: null } },
    { r: 1, c: 0, cell: { v: 'a'.repeat(MAX_TEXT - 2) + '\u{1F600}', f: null } },
    { r: 2, c: 0, cell: { v: 'a'.repeat(MAX_TEXT) + 'tail', f: null } },
  ]);
  const back = await workbookFromFile(await save(wb), `long.${extension}`);
  const bid = back.activeSheetId;
  const straddling = back.getValue(bid, 0, 0);
  expect(straddling).toHaveLength(MAX_TEXT - 1);
  expect(straddling).not.toContain('�');
  const fitting = back.getValue(bid, 1, 0);
  expect(fitting).toHaveLength(MAX_TEXT);
  expect(fitting.endsWith('\u{1F600}')).toBe(true);
  expect(back.getValue(bid, 2, 0)).toBe('a'.repeat(MAX_TEXT));
});
