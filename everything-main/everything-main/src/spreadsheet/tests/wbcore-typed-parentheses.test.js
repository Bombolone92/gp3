import { describe, expect, it } from 'vitest';
import { Workbook, MAX_FORMULA_LENGTH } from '../src/core/workbook.js';

describe('a typed formula with parentheses left open', () => {
  it('gets the missing closing parentheses and calculates', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1');
    wb.setInput(id, 1, 0, '2');
    wb.setInput(id, 0, 1, '=SUM(A1:A2');
    expect(wb.getCell(id, 0, 1).f).toBe('SUM(A1:A2)');
    expect(wb.getValue(id, 0, 1)).toBe(3);
    wb.setInput(id, 1, 1, '=IF(A1>0,"a(",SUM(A1:A2'); // a parenthesis inside a string is text
    expect(wb.getCell(id, 1, 1).f).toBe('IF(A1>0,"a(",SUM(A1:A2))');
    expect(wb.getValue(id, 1, 1)).toBe('a(');
    wb.setInput(id, 2, 1, '=(A1+A2');
    expect(wb.getCell(id, 2, 1).f).toBe('(A1+A2)');
    expect(wb.getValue(id, 2, 1)).toBe(3);
  });

  it('stays the text typed when closing it would make the formula longer than a formula may be', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const body = '(' + '1+'.repeat((MAX_FORMULA_LENGTH - 2) / 2) + '1'; // as long as a formula may be, one parenthesis short
    expect(body).toHaveLength(MAX_FORMULA_LENGTH);
    wb.setInput(id, 0, 0, `=${body}`);
    expect(wb.getCell(id, 0, 0)).toMatchObject({ v: `=${body}`, f: null });
    // Typed with its parenthesis it is one character too long, and text for the same reason.
    wb.setInput(id, 1, 0, `=${body})`);
    expect(wb.getCell(id, 1, 0)).toMatchObject({ v: `=${body})`, f: null });
    // A term shorter, the closed formula fits and is stored as a formula.
    const shorter = '(' + '1+'.repeat((MAX_FORMULA_LENGTH - 2) / 2 - 1) + '1';
    wb.setInput(id, 2, 0, `=${shorter}`);
    expect(wb.getCell(id, 2, 0)).toMatchObject({ v: null, f: `${shorter})` });
  });

  it('corrects nothing else', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1');
    wb.setInput(id, 1, 0, '2');
    wb.setInput(id, 0, 1, '=SUM(A1:A2))'); // one too many stays an error
    expect(wb.getCell(id, 0, 1).f).toBe('SUM(A1:A2))');
    expect(wb.getValue(id, 0, 1)).toEqual({ error: '#ERROR!' });
    wb.setInput(id, 1, 1, '=SUM(A1:A2'); // a well-formed formula is kept as typed
    wb.setInput(id, 2, 1, '=SUM(A1:A2)');
    expect(wb.getCell(id, 2, 1).f).toBe('SUM(A1:A2)');
    wb.setInput(id, 3, 1, '=SUM(A1:A2 +'); // closing it would not make it readable
    expect(wb.getCell(id, 3, 1).f).toBe('SUM(A1:A2 +');
    // A formula written by a tool (paste, fill) is completed the same way; a whole one is stored as given.
    wb.setCells(id, [{ r: 4, c: 1, cell: { v: null, f: 'SUM(A1:A2' } }, { r: 5, c: 1, cell: { v: null, f: 'SUM( A1:A2 )' } }]);
    expect([4, 5].map((r) => wb.getCell(id, r, 1).f)).toEqual(['SUM(A1:A2)', 'SUM( A1:A2 )']);
  });
});
