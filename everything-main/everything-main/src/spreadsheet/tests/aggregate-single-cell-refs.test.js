import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Aggregates ignore text and booleans inside any reference, one cell or a range;
// only literal arguments are coerced. A single-cell reference used to arrive
// as a bare value and be coerced like a literal, so =SUM(A1) over text gave
// #VALUE! while =SUM(A1:A1) gave 0.
describe('aggregates over single-cell references', () => {
  const book = () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'abc');   // A1 text
    wb.setInput(id, 1, 0, '1');     // A2 number
    wb.setInput(id, 2, 0, "'50");   // A3 text that looks numeric
    wb.setInput(id, 3, 0, 'TRUE');  // A4 boolean
    wb.setInput(id, 4, 0, '3');     // A5 number
    const at = (r, c, formula) => { wb.setInput(id, r, c, formula); return wb.getValue(id, r, c); };
    return { wb, id, at };
  };

  it.each([
    ['=SUM(A1)', 0],
    ['=SUM(A1:A1)', 0],
    ['=AVERAGE(A2,A1)', 1],
    ['=MAX(A2,A3)', 1],
    ['=MIN(A5,A3)', 3],
    ['=COUNT(A4)', 0],
    ['=COUNT(A1,A2,A3,A4,A5)', 2],
    ['=PRODUCT(A2,A3,A5)', 3],
    ['=MEDIAN(A2,A1,A5)', 2],
    ['=STDEV.P(A2,A5,A1)', 1],
    ['=SUMSQ(A2,A5,A4)', 10],
  ])('%s skips text and booleans in referenced cells', (formula, expected) => {
    const { at } = book();
    expect(at(0, 2, formula)).toBe(expected);
  });

  it('still coerces literal arguments', () => {
    const { at } = book();
    expect(at(0, 2, '=SUM("3",TRUE)')).toBe(4);
    expect(at(1, 2, '=COUNT(TRUE,"7")')).toBe(2);
    expect(at(2, 2, '=MIN(A2,"0.5")')).toBe(0.5);
    expect(at(3, 2, '=AVERAGE(A1)')).toEqual({ error: '#DIV/0!' });
  });

  it('counts referenced text as zero in the A variants', () => {
    const { at } = book();
    expect(at(0, 2, '=AVERAGEA(A1,A2)')).toBe(0.5);
    expect(at(1, 2, '=MINA(A2,A3)')).toBe(0);
    expect(at(2, 2, '=MAXA(A4,A1)')).toBe(1);
  });

  it('propagates an error held in a referenced cell', () => {
    const { wb, id, at } = book();
    wb.setInput(id, 5, 0, '=1/0');
    expect(at(0, 2, '=SUM(A6)')).toEqual({ error: '#DIV/0!' });
    expect(at(1, 2, '=MAX(A2,A6)')).toEqual({ error: '#DIV/0!' });
  });
});
