import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { calc } from './helpers/calc.js';

// LOOKUP searches the lookup vector where it lies, as MATCH and VLOOKUP do, instead of copying the
// whole column into a fresh array on every call: a column of LOOKUPs over a 20,000-row table paid
// two thirds of a millisecond each in copying before a single value was compared. The answers are
// the ones the copying scan gave — the last value of the key's type not above it, blanks, errors
// and values of another type passed over, the search ended by a value above the key.
const NA = { error: '#N/A' };

describe('LOOKUP', () => {
  it('answers as before on sorted data, duplicates included', () => {
    const cells = { A1: '1', A2: '2', A3: '2', A4: '5', A5: '8', B1: 'p', B2: 'q', B3: 'r', B4: 's', B5: 't' };
    expect(calc('LOOKUP(2,A1:A5,B1:B5)', cells)).toBe('r'); // the last of the duplicate keys
    expect(calc('LOOKUP(4,A1:A5,B1:B5)', cells)).toBe('r');
    expect(calc('LOOKUP(99,A1:A5,B1:B5)', cells)).toBe('t');
    expect(calc('LOOKUP(0,A1:A5,B1:B5)', cells)).toEqual(NA);
    expect(calc('LOOKUP(2,A1:B5)', cells)).toBe('r'); // two columns: search the first, answer from the last
    expect(calc('LOOKUP(2,TRANSPOSE(A1:A5),TRANSPOSE(B1:B5))', cells)).toBe('r');
    expect(calc('LOOKUP(2,TRANSPOSE(A1:B5))', cells)).toBe('r'); // a wide range searches its first row
    expect(calc('LOOKUP("",A1:A5,B1:B5)', cells)).toEqual(NA); // an empty key is not a zero
    expect(calc('LOOKUP("b",A1:A5,B1:B5)', cells)).toEqual(NA); // no value of the key's type
    expect(calc('LOOKUP(TRUE,A1:A5,B1:B5)', cells)).toEqual(NA);
  });

  it('answers as before on unsorted data, where the first larger value ends the search', () => {
    const cells = { A1: '5', A2: '1', A3: '8', A4: '2', A5: '2', B1: 'p', B2: 'q', B3: 'r', B4: 's', B5: 't' };
    expect(calc('LOOKUP(2,A1:A5,B1:B5)', cells)).toEqual(NA);
    expect(calc('LOOKUP(5,A1:A5,B1:B5)', cells)).toBe('q');
    expect(calc('LOOKUP(6,A1:A5,B1:B5)', cells)).toBe('q');
    expect(calc('LOOKUP(0,A1:A5,B1:B5)', cells)).toEqual(NA);
  });

  it('answers as before over errors, blanks and values of another type', () => {
    const cells = { A1: '1', A3: '=1/0', A4: '5', A5: 'x', A6: '8', B1: 'p', B2: 'q', B3: 'r', B4: 's', B5: 't', B6: 'u' };
    expect(calc('LOOKUP(6,A1:A6,B1:B6)', cells)).toBe('s');
    expect(calc('LOOKUP(1,A1:A6,B1:B6)', cells)).toBe('p');
    expect(calc('LOOKUP("y",A1:A6,B1:B6)', cells)).toBe('t'); // the text cell, past the numbers
    expect(calc('LOOKUP(9,A1:A6,B1:B6)', cells)).toBe('u');
    expect(calc('LOOKUP(2,1/(A1:A6<>""),A1:A6)', cells)).toBe(8); // the last filled cell, past the #DIV/0! of the blanks
    expect(calc('LOOKUP(2,1/(A1:A6<>""),B1:B6)', cells)).toBe('u');
  });

  it('answers as before on text keys, whatever their case', () => {
    const cells = { A1: 'a', A2: 'b', A3: 'b', A4: 'm', A5: 'z', B1: '1', B2: '2', B3: '3', B4: '4', B5: '5' };
    expect(calc('LOOKUP("b",A1:A5,B1:B5)', cells)).toBe(3);
    expect(calc('LOOKUP("B",A1:A5,B1:B5)', cells)).toBe(3);
    expect(calc('LOOKUP("c",A1:A5,B1:B5)', cells)).toBe(3);
    expect(calc('LOOKUP("A",A1:A5,B1:B5)', cells)).toBe(1);
    expect(calc('LOOKUP(1,A1:A5,B1:B5)', cells)).toEqual(NA);
    expect(calc('LOOKUP("z",A1:A5)', cells)).toBe('z');
  });

  it('costs what the search costs, not the length of the column', { timeout: 60000 }, () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    for (let r = 0; r < 20000; r++) { wb.setInput(id, r, 0, String(r + 1)); wb.setInput(id, r, 1, `v${r + 1}`); }
    const time = (formula) => {
      const t = performance.now();
      for (let k = 0; k < 1000; k++) wb.setInput(id, k, 4, `=${formula}`);
      for (let k = 0; k < 1000; k++) expect(wb.getValue(id, k, 4)).toBe('v2');
      return performance.now() - t;
    };
    // The needle is found in the second row either way, so the two differ only by what the call reads
    // of the rest of the column. Copying it out made the long table 19 to 117 times the short one; the
    // measurements are taken twice each so a busy machine slows both rather than only one.
    const short = Math.max(time('LOOKUP(2,$A$1:$A$100,$B$1:$B$100)'), time('LOOKUP(2,$A$1:$A$100,$B$1:$B$100)'));
    const long = Math.min(time('LOOKUP(2,$A$1:$A$20000,$B$1:$B$20000)'), time('LOOKUP(2,$A$1:$A$20000,$B$1:$B$20000)'));
    expect(long).toBeLessThan(short * 5 + 100);
  });
});
