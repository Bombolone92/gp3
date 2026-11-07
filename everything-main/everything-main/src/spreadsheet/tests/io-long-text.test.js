import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_TEXT } from '../src/core/cell.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';

describe('text beyond the file format limit', () => {
  // Cells may hold longer text in memory (imported paragraphs, say); the file keeps what fits.
  it('still saves when a formula result or a note is longer than the limit', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'a'.repeat(20000));
    wb.setInput(id, 0, 1, '=A1&A1&"tail"');
    wb.setNote(id, 1, 0, 'n'.repeat(MAX_TEXT + 10));
    const bytes = await (await workbookToXlsx(wb)).arrayBuffer();
    const back = await workbookFromFile(bytes, 'long.xlsx');
    const sheet = back.activeSheetId;
    expect(back.getValue(sheet, 0, 0)).toHaveLength(20000);
    // Joined text past the limit is #VALUE!; the formula itself survives the round trip.
    expect(back.getValue(sheet, 0, 1)).toEqual({ error: '#VALUE!' });
    expect(back.getCell(sheet, 0, 1).f).toBe('A1&A1&"tail"');
    expect(back.getNote(sheet, 1, 0)).toHaveLength(4000); // notes are cut at 4,000 characters when set
  });
});
