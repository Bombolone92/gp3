import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { sameBook } from '../src/lib/drafts.js';

it.each([
  {},
  { normalFont: { name: 'Georgia', sz: 15, bold: true, color: '#234567' } },
  { sheet: { colStyles: { 0: { font: 'arial', size: 22, italic: true } }, rowStyles: { 0: { bold: true } } } },
  { sheet: { colStyles: { 0: { font: 'arial', size: 22, italic: true } }, styleResets: [{ range: { r1: 0, c1: 0, r2: 0, c2: 0 }, keys: ['font', 'size', 'italic'] }] } },
])('compares native run font defaults without offering an already-saved rich draft: %j', async ({ sheet, ...context }) => {
  const seed = new Workbook({ ...context, sheets: [{ ...sheet }] });
  // Native custom Normal fonts also carry a column-width cache. Start that
  // context from a loaded workbook so this test isolates character edits.
  const wb = context.normalFont ? await workbookFromFile(await workbookToXlsx(seed), 'seed.xlsx') : seed;
  wb.setCells(wb.activeSheetId, [{ r: 0, c: 0, cell: {
    v: 'Bold plain underlined', s: { color: '#123456' }, richText: [
      { text: 'Bold', s: { bold: true } }, { text: ' plain' }, { text: ' underlined', s: { underline: true } },
    ],
  } }]);
  const back = await workbookFromFile(await workbookToXlsx(wb), 'rich.xlsx');
  expect(sameBook(wb.toJSON(), back.toJSON())).toBe(true);
  expect(sameBook(back.toJSON(), wb.toJSON())).toBe(true);
  const font = back.getCell(back.activeSheetId, 0, 0).richText[0].s;
  font.italic = !font.italic;
  expect(sameBook(wb.toJSON(), back.toJSON())).toBe(false);
  back.getCell(back.activeSheetId, 0, 0).richText[0].s.color = '#abcdef';
  expect(sameBook(wb.toJSON(), back.toJSON())).toBe(false);
});
