import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { tokenize } from '../src/core/formula/tokenizer.js';
import { hasTableRefs } from '../src/core/tables.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as XLSX from '../src/vendor/xlsx.mjs';

// Excel writes links to other files as [1]Sheet1!A1, numbering the linked
// workbooks. Nothing here can read them, but a file that carries them must
// keep their text rather than have #REF! spliced into the formula: the text
// rides in the sidecar and comes back as the formula, while the file itself
// carries no formula Excel would have to repair for want of the link part.
describe('references into other workbooks', () => {
  it('tokenizes [1]Sheet1!A1 as one reference, not a structured reference plus a local one', () => {
    expect(tokenize('[1]Sheet1!A1').map((t) => t.type)).toEqual(['ref']);
    expect(tokenize('[Book.xlsx]Data!B2:B9')[0]).toMatchObject({ type: 'ref', text: 'B2:B9', sheet: '[Book.xlsx]Data' });
    expect(hasTableRefs('SUM([1]Sheet1!A1:A3)')).toBe(false);
    // Bare structured references inside a table keep working.
    expect(tokenize('[@Amount]*2')[0].type).toBe('tref');
  });

  it('keeps the formula text through a save, out of the file itself, and evaluates it as #REF! meanwhile', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=[1]Sheet1!A1');
    wb.setInput(id, 0, 1, '=SUM([1]Sheet1!A1:A3)+1');
    expect(wb.structuredToA1(id, 0, 0, '[1]Sheet1!A1')).toBe('[1]Sheet1!A1');
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#REF!' });
    const bytes = await (await workbookToXlsx(wb)).arrayBuffer();
    const book = XLSX.read(new Uint8Array(bytes), { type: 'array' });
    const ws = book.Sheets[book.SheetNames[0]];
    expect(ws.A1.f).toBeUndefined(); // no formula for Excel to repair for want of an external-link part
    expect(ws.B1.f).toBeUndefined();
    const back = await workbookFromFile(bytes, 'links.xlsx');
    const bid = back.activeSheetId;
    expect(back.getCell(bid, 0, 0).f).toBe('[1]Sheet1!A1');
    expect(back.getCell(bid, 0, 1).f).toBe('SUM([1]Sheet1!A1:A3)+1');
  });

  it('is left alone when the local sheet with the same name is renamed', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=[1]Sheet1!A1');
    wb.renameSheet(id, 'Summary');
    expect(wb.getCell(id, 0, 0).f).toMatch(/^'?\[1\]Sheet1'?!A1$/);
  });
});
