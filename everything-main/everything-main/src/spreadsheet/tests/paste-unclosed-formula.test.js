import { describe, expect, it } from 'vitest';
import { Workbook, MAX_FORMULA_LENGTH } from '../src/core/workbook.js';

// A typed formula that stops short of its closing parentheses gets them (setInput). The same text pasted,
// or a formula written through setCells, was stored as it came and showed #ERROR! until the user's next
// F2+Enter completed and ran it, which let =MAP(url,IMPORTDATA sit past the paste's external-content
// check, unscanned because unreadable, and reach out later without the question.
describe('an unclosed formula pasted or written through setCells', () => {
  it('is completed as a typed one is, when that alone makes it readable', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1');
    wb.setInput(id, 1, 0, '2');
    wb.pasteValues(id, [['=SUM(A1:A2'], ['=IF(A1>0,"a(",SUM(A1:A2']], 0, 1);
    expect([0, 1].map((r) => wb.getCell(id, r, 1).f)).toEqual(['SUM(A1:A2)', 'IF(A1>0,"a(",SUM(A1:A2))']);
    expect([0, 1].map((r) => wb.getValue(id, r, 1))).toEqual([3, 'a(']);
    wb.setCells(id, [{ r: 2, c: 1, cell: { v: null, f: '(A1+A2' } }]);
    expect(wb.getCell(id, 2, 1).f).toBe('(A1+A2)');
    expect(wb.getValue(id, 2, 1)).toBe(3);
    // Nothing else is corrected: one parenthesis too many, or text that closing would not make readable, stays as it came.
    wb.pasteValues(id, [['=SUM(A1:A2))'], ['=SUM(A1:A2 +']], 3, 1);
    expect([3, 4].map((r) => wb.getCell(id, r, 1).f)).toEqual(['SUM(A1:A2))', 'SUM(A1:A2 +']);
    expect(wb.getValue(id, 3, 1)).toEqual({ error: '#ERROR!' });
    // A whole formula is stored as given, spacing and all.
    wb.setCells(id, [{ r: 5, c: 1, cell: { v: null, f: 'SUM( A1:A2 )' } }]);
    expect(wb.getCell(id, 5, 1).f).toBe('SUM( A1:A2 )');
  });

  it('stays the text it would have been typed as when closing it would make it longer than a formula may be', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const body = '(' + '1+'.repeat((MAX_FORMULA_LENGTH - 2) / 2) + '1'; // as long as a formula may be, one parenthesis short
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: null, f: body } }]);
    expect(wb.getCell(id, 0, 0)).toMatchObject({ v: `=${body}`, f: null });
    // A whole formula is written as given, however long, as a loaded file's cells are when a sort passes them
    // through the same door; only typed text turns such a formula into text.
    wb.setCells(id, [{ r: 1, c: 0, cell: { v: null, f: `${body})` } }]); // one character too long as it is
    expect(wb.getCell(id, 1, 0)).toMatchObject({ f: `${body})` });
  });

  it('blocks a completed formula that reaches outside the file until the user allows it', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    expect(wb.externalAllowed).toBe(true);
    wb.pasteValues(id, [['=MAP(A1,IMPORTDATA']], 0, 1);
    expect(wb.getCell(id, 0, 1).f).toBe('MAP(A1,IMPORTDATA)');
    expect(wb.externalAllowed).toBe(false);
    expect(wb.getValue(id, 0, 1)).toHaveProperty('error');
    // A formula the user types is the user's own: typing the same text asks nothing.
    const own = new Workbook();
    own.setInput(own.activeSheetId, 0, 1, '=MAP(A1,IMPORTDATA');
    expect(own.getCell(own.activeSheetId, 0, 1).f).toBe('MAP(A1,IMPORTDATA)');
    expect(own.externalAllowed).toBe(true);
    // A formula that arrives whole was readable to the paste's own scan, which decides for it.
    const whole = new Workbook();
    whole.setCells(whole.activeSheetId, [{ r: 0, c: 0, cell: { v: null, f: 'IMPORTDATA("https://x.test")' } }]);
    expect(whole.externalAllowed).toBe(true);
  });
});
