import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';

function calc(formula, cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 9, 9, `=${formula}`);
  return wb.getValue(id, 9, 9);
}

// TEXTJOIN takes an array of delimiters and uses them in turn, starting over when they run out.
describe('TEXTJOIN with an array of delimiters', () => {
  it('cycles through the delimiters between the joined texts', () => {
    expect(calc('TEXTJOIN({"-","+"},TRUE,"a","b","c")')).toBe('a-b+c');
    expect(calc('TEXTJOIN({"-","+"},TRUE,"a","b","c","d")')).toBe('a-b+c-d');
    expect(calc('TEXTJOIN({",";";"},FALSE,"x","y","z")')).toBe('x,y;z');
    expect(calc('TEXTJOIN(A1:B1,TRUE,"x","y","z")', { A1: ',', B1: ';' })).toBe('x,y;z');
  });

  it('reads numbers among the delimiters as text', () => {
    expect(calc('TEXTJOIN({"-",1},TRUE,"a","b","c")')).toBe('a-b1c');
  });

  it('still joins with a single delimiter', () => {
    expect(calc('TEXTJOIN(",",TRUE,"a","b")')).toBe('a,b');
    expect(calc('TEXTJOIN(", ",TRUE,"a","","b")')).toBe('a, b');
  });
});
