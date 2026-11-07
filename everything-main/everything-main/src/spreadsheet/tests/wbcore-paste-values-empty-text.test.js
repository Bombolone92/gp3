import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

describe('pasting values', () => {
  it('leaves a cell blank for an empty text, as typing nothing into it does', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 1, 1, 'gone');
    wb.setInput(id, 5, 0, '=COUNTA(A1:B2)');
    wb.setInput(id, 5, 1, '=ISBLANK(B1)');
    expect(wb.pasteLiteralValues(id, [['a', ''], ['', null]], 0, 0)).toBe(2); // A1 written, B2 cleared
    expect(wb.getCell(id, 0, 1)).toBeUndefined();
    expect(wb.getCell(id, 1, 0)).toBeUndefined();
    expect(wb.getCell(id, 1, 1)).toBeUndefined();
    expect(wb.getValue(id, 5, 0)).toBe(1);
    expect(wb.getValue(id, 5, 1)).toBe(true);
    expect(wb.usedRange(id)).toMatchObject({ r1: 0, c1: 0 });
    // The formatting of a cell an empty text lands on stays, as with any pasted value.
    wb.applyStyle(id, { r1: 3, c1: 3, r2: 3, c2: 3 }, { bold: true });
    wb.setInput(id, 3, 3, 'text');
    wb.pasteLiteralValues(id, [['']], 3, 3);
    expect(wb.getCell(id, 3, 3)).toEqual({ v: null, f: null, s: { bold: true } });
  });
});
