import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

function calc(formula, cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 0, 9, `=${formula}`);
  return wb.getValue(id, 0, 9);
}

// TEXT runs text through the format's text section: TEXT("abc","""Name: ""@") is "Name: abc".
describe('TEXT on text values', () => {
  it('prints the text section and its literals around text that is not a number', () => {
    expect(calc('TEXT("abc","""Name: ""@")')).toBe('Name: abc');
    expect(calc('TEXT("abc","@")')).toBe('abc');
    expect(calc('TEXT("abc","0;-0;0;""T:""@")')).toBe('T:abc');
    expect(calc('TEXT(A1,"""Name: ""@")', { A1: 'Bob' })).toBe('Name: Bob');
  });

  it('leaves text alone under a number format', () => {
    expect(calc('TEXT("abc","0")')).toBe('abc');
    expect(calc('TEXT("abc","0.00%")')).toBe('abc');
  });

  it('prints the empty text as empty, not as zero', () => {
    expect(calc('TEXT("","@")')).toBe('');
    expect(calc('TEXT("","0")')).toBe('');
    expect(calc('TEXT("","""Name: ""@")')).toBe('Name: ');
  });

  it('still formats numeric text as a number', () => {
    expect(calc('TEXT("12","0.0")')).toBe('12.0');
    expect(calc('TEXT("1,234.5","#,##0")')).toBe('1,235');
  });
});
