import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it('preserves notes on unformatted spill results when saving and reopening', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=SEQUENCE(3)');
  wb.setNote(id, 1, 0, 'Keep this note on the second result');
  const back = await workbookFromFile(await workbookToXlsx(wb), 'notes.xlsx');
  expect(back.getValue(back.activeSheetId, 1, 0)).toBe(2);
  expect(back.getCell(back.activeSheetId, 1, 0)?.f).toBeUndefined();
  expect(back.getNote(back.activeSheetId, 1, 0)).toBe('Keep this note on the second result');
});
