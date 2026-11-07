import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

describe('a style patch given with a typed value', () => {
  it('takes away the keys set to null instead of storing null under them', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'x', { style: { bold: true, fmt: 'text' } });
    wb.setInput(id, 0, 0, 'x', { style: { bold: null } });
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'text' });
    wb.setInput(id, 0, 0, 'y', { style: { fmt: null } });
    expect(wb.getCell(id, 0, 0)).toEqual({ v: 'y', f: null });
    // A literal value's patch is treated the same.
    wb.setInput(id, 1, 0, 5, { literal: true, style: { fmt: 'percent', bold: true } });
    wb.setInput(id, 1, 0, 6, { literal: true, style: { bold: null } });
    expect(wb.getCell(id, 1, 0)).toEqual({ v: 6, f: null, s: { fmt: 'percent' } });
  });
});
