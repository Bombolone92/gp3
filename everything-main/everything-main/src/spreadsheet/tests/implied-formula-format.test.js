import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { formatValue } from '../src/core/format.js';
import { impliedFormulaStyle } from '../src/core/implied-format.js';

function book(cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) {
    const { r, c } = parseCellRef(a1);
    wb.setInput(id, r, c, text);
  }
  const at = (a1) => { const { r, c } = parseCellRef(a1); return wb.getCell(id, r, c); };
  const type = (a1, text) => { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); return at(a1); };
  const shown = (a1) => { const { r, c } = parseCellRef(a1); return formatValue(wb.getValue(id, r, c), at(a1)?.s); };
  return { wb, id, at, type, shown };
}

describe('a typed formula takes the number format it implies', () => {
  it('shows TODAY() as a date, NOW() as a date and time, and TIME() as a time', () => {
    const { type, shown } = book();
    expect(type('A1', '=TODAY()').s).toEqual({ fmt: 'date' });
    expect(shown('A1')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(type('A2', '=NOW()').s).toEqual({ fmt: 'datetime' });
    expect(shown('A2')).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(type('A3', '=TIME(9,30,0)').s).toEqual({ fmt: 'time' });
    expect(shown('A3')).toMatch(/9:30/);
    expect(type('A4', '=DATE(2024,3,10)').s).toEqual({ fmt: 'date' });
    expect(shown('A4')).toBe('2024-03-10');
    expect(type('A5', '=EOMONTH(A4,0)').s).toEqual({ fmt: 'date' });
  });

  it('shows EPOCHTODATE() as a date and time and TO_DATE() as a date, as the other date functions are shown', () => {
    const { type, shown } = book();
    // 1700000000 seconds after 1970-01-01 is 2023-11-14 22:13:20 UTC; serial 45000 is 2023-03-15.
    expect(type('A1', '=EPOCHTODATE(1700000000)').s).toEqual({ fmt: 'datetime' });
    expect(shown('A1')).toBe('2023-11-14 22:13');
    expect(type('A2', '=TO_DATE(45000)').s).toEqual({ fmt: 'date' });
    expect(shown('A2')).toBe('2023-03-15');
  });

  it('keeps the date through arithmetic with plain numbers but not a date minus a date', () => {
    const { type } = book({ A1: '2024-03-10', A2: '2024-03-01' });
    expect(type('B1', '=TODAY()+7').s).toEqual({ fmt: 'date' });
    expect(type('B2', '=-TODAY()').s).toEqual({ fmt: 'date' });
    expect(type('B3', '=A1-A2').s).toBeUndefined();
    expect(type('B4', '=A1*2').s).toBeUndefined();
    expect(type('B5', '=TODAY()-A1').s).toBeUndefined();
  });

  it('carries the format of a referenced cell, including its date style and currency', () => {
    const { wb, id, type } = book({ A1: '2024-03-10', A2: '$1,250.50', A3: '50%' });
    wb.setCells(id, [{ r: 3, c: 0, cell: { v: 45306, s: { fmt: 'date', dateStyle: 'medium', bold: true } } }]);
    expect(type('B1', '=A1+1').s).toEqual({ fmt: 'date' });
    expect(type('B2', '=A2*3').s).toMatchObject({ fmt: 'currency' });
    expect(type('B3', '=A3/2').s).toEqual({ fmt: 'percent', dec: 0 });
    expect(type('B4', '=A4').s).toEqual({ fmt: 'date', dateStyle: 'medium' });
    expect(type('B5', "='Sheet1'!A1").s).toEqual({ fmt: 'date' });
  });

  it('passes the format through SUM, IF, INDEX and friends but not through COUNT', () => {
    const { type } = book({ A1: '$10', A2: '$20', A3: '2024-03-10', A4: '5' });
    expect(type('B1', '=SUM(A1:A2)').s).toMatchObject({ fmt: 'currency' });
    expect(type('B2', '=IF(A4>1, A3, 0)').s).toEqual({ fmt: 'date' });
    expect(type('B3', '=IF(A3>1, 1, 0)').s).toBeUndefined();
    expect(type('B4', '=COUNT(A1:A3)').s).toBeUndefined();
    expect(type('B5', '=INDEX(A1:A2, 2)').s).toMatchObject({ fmt: 'currency' });
    expect(type('B6', '=ROUND(A1*1.1, 2)').s).toMatchObject({ fmt: 'currency' });
    expect(type('B7', '=SUMIF(A4:A4, ">1", A1:A1)').s).toMatchObject({ fmt: 'currency' });
    expect(type('B8', '=50%').s).toEqual({ fmt: 'percent' });
  });

  it('never overrides a format the cell already has, and never copies a text format', () => {
    const { wb, id, type, at } = book({ A1: '2024-03-10' });
    wb.setCells(id, [{ r: 1, c: 0, cell: { v: null, s: { fmt: 'number', dec: 2 } } }]);
    wb.setCells(id, [{ r: 2, c: 0, cell: { v: 'abc', s: { fmt: 'text' } } }]);
    wb.setCells(id, [{ r: 3, c: 0, cell: { v: null, s: { fmt: 'general', bold: true } } }]);
    type('A2', '=TODAY()');
    expect(at('A2').s).toEqual({ fmt: 'number', dec: 2 });
    expect(type('B3', '=A3').s).toBeUndefined();
    type('A4', '=TODAY()');
    expect(at('A4').s).toEqual({ fmt: 'date', bold: true });
    expect(type('B1', '=BADFUNC(').s).toBeUndefined();
    expect(type('B2', 'hello').s).toBeUndefined();
  });

  it('applies to a Ctrl+Enter fill of a formula over a range', () => {
    const { wb, id, at } = book({ A1: '2024-03-10', A2: '2024-03-11' });
    wb.fillInput(id, { r1: 0, c1: 1, r2: 1, c2: 1 }, '=A1+1', { r: 0, c: 1 });
    expect(at('B1').s).toEqual({ fmt: 'date' });
    expect(at('B2').s).toEqual({ fmt: 'date' });
    expect(at('B2').f).toBe('A2+1');
  });

  it('answers null for anything that is not a formula it can read', () => {
    expect(impliedFormulaStyle('SUM(', () => null)).toBeNull();
    expect(impliedFormulaStyle('1+1', () => null)).toBeNull();
    expect(impliedFormulaStyle('A1&"x"', () => ({ fmt: 'date' }))).toBeNull();
    expect(impliedFormulaStyle('A1>B1', () => ({ fmt: 'date' }))).toBeNull();
  });
});
