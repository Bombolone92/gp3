import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToOds, workbookToXlsx, workbookFromFile } from '../src/core/io.js';

// ODF has no escape for a carriage return; the writer spelled it "_x000d_", which
// no reader decodes, so Windows line breaks came back as literal text.
it('keeps line breaks in cells and notes through an .ods round trip', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'a\r\nb');
  wb.setInput(id, 1, 0, 'c\rd');
  wb.setInput(id, 2, 0, 'e\nf');
  wb.setNote(id, 0, 0, 'n1\r\nn2');
  const ods = await workbookFromFile(await (await workbookToOds(wb)).arrayBuffer(), 'breaks.ods');
  const oid = ods.activeSheetId;
  expect([ods.getValue(oid, 0, 0), ods.getValue(oid, 1, 0), ods.getValue(oid, 2, 0)]).toEqual(['a\nb', 'c\nd', 'e\nf']);
  expect(ods.getNote(oid, 0, 0)).toBe('n1\nn2');
  for (const v of [ods.getValue(oid, 0, 0), ods.getNote(oid, 0, 0)]) expect(v).not.toContain('_x000d_');
  // The .xlsx path keeps the carriage returns as before.
  const xlsx = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'breaks.xlsx');
  expect(xlsx.getValue(xlsx.activeSheetId, 0, 0)).toBe('a\r\nb');
});


it('keeps a note on an otherwise blank cell without creating a string value', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setNote(id, 0, 0, 'Blank cell note');
  wb.setInput(id, 0, 1, '=ISBLANK(A1)');
  for (const [name, write] of [['notes.ods', workbookToOds], ['notes.xlsx', workbookToXlsx]]) {
    const back = await workbookFromFile(await (await write(wb)).arrayBuffer(), name);
    expect(back.getNote(back.activeSheetId, 0, 0)).toBe('Blank cell note');
    expect(back.getValue(back.activeSheetId, 0, 0)).toBe(null);
    expect(back.getValue(back.activeSheetId, 0, 1)).toBe(true);
  }
});
