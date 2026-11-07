import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/core/formula/tokenizer.js';
import { Workbook } from '../src/core/workbook.js';

const kinds = (formula) => tokenize(formula).map((t) => (t.type === 'ref' ? `ref:${t.text}` : t.value !== undefined ? `${t.type}:${t.value}` : t.type));

// FY24 spells a cell, so FY24.Total was read as that cell followed by a stray period and every
// formula naming it was #ERROR!, though the name itself was accepted.
describe('a defined name whose first letters and digits spell a cell', () => {
  it('is one name when a period joins it to more', () => {
    expect(kinds('=FY24.Total')).toEqual(['op:=', 'name:FY24.TOTAL']);
    expect(kinds('=Q1.2025*2')).toEqual(['op:=', 'name:Q1.2025', 'op:*', 'number:2']);
    expect(kinds('=A1.5+v1.0')).toEqual(['op:=', 'name:A1.5', 'op:+', 'name:V1.0']);
    expect(kinds('=SUM(FY24.Total,Sheet1!FY24.Total)')).toEqual(['op:=', 'name:SUM', 'lparen', 'name:FY24.TOTAL', 'comma:,', 'name:FY24.TOTAL', 'rparen']);
    expect(kinds('=Q1.Sales[Amount]')).toEqual(['op:=', 'tref']);
  });

  it('leaves references, numbers and a trailing period as they were', () => {
    expect(kinds('=A1:B2')).toEqual(['op:=', 'ref:A1:B2']);
    expect(kinds('=Sheet1!A1')).toEqual(['op:=', 'ref:A1']);
    expect(kinds('=$A$1+1.5+.5')).toEqual(['op:=', 'ref:$A$1', 'op:+', 'number:1.5', 'op:+', 'number:0.5']);
    expect(kinds('=A1#')).toEqual(['op:=', 'ref:A1']);
    expect(kinds('=A:A')).toEqual(['op:=', 'ref:A:A']);
    expect(() => tokenize('=A1.')).toThrow();
    expect(kinds('=A1..B2')).toEqual(['op:=', 'name:A1..B2']);
  });

  it('is found by a formula and left alone when rows are inserted', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 1, '5');
    wb.setInput(id, 0, 2, '7');
    expect(wb.defineName('FY24.Total', 'Sheet1!$B$1')).toBeNull();
    expect(wb.defineName('Q1.2025', 'Sheet1!$C$1')).toBeNull();
    wb.setInput(id, 2, 0, '=FY24.Total');
    wb.setInput(id, 3, 0, '=Q1.2025*2');
    expect(wb.getValue(id, 2, 0)).toBe(5);
    expect(wb.getValue(id, 3, 0)).toBe(14);
    wb.insertRows(id, 1, 30);
    expect(wb.getCell(id, 32, 0).f).toBe('FY24.Total');
    expect(wb.getCell(id, 33, 0).f).toBe('Q1.2025*2');
    expect(wb.getValue(id, 32, 0)).toBe(5);
  });
});
