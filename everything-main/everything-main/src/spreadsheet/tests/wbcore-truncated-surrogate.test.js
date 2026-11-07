import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_TEXT } from '../src/core/cell.js';

describe('text typed past the length a cell holds', () => {
  it('is cut on a character boundary, so an emoji at the limit goes whole rather than leaving half a pair', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const truncated = [];
    wb.addEventListener('change', (e) => { if (e.detail.type === 'truncated') truncated.push(e.detail); });
    wb.setInput(id, 0, 0, 'a'.repeat(MAX_TEXT - 1) + '😀');
    const v = wb.getCell(id, 0, 0).v;
    expect(v).toBe('a'.repeat(MAX_TEXT - 1));
    expect(v.isWellFormed()).toBe(true);
    expect(truncated).toHaveLength(1);
    // A pair ending just inside the limit stays whole; the text after it goes.
    wb.setInput(id, 1, 0, 'a'.repeat(MAX_TEXT - 2) + '😀b');
    expect(wb.getCell(id, 1, 0).v).toBe('a'.repeat(MAX_TEXT - 2) + '😀');
    expect(wb.getCell(id, 1, 0).v).toHaveLength(MAX_TEXT);
    expect(truncated).toHaveLength(2);
  });
});
