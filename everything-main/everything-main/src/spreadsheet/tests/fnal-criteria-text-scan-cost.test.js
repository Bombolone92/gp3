import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { getLocale, setLocale } from '../src/core/format.js';
import { calc } from './helpers/calc.js';

// Numeric equality reads a number stored as text as the number it spells, which means parsing text.
// A column of text is parsed by every SUMIF and COUNTIF over it on every calculation, so the parse is
// skipped for text without a digit and remembered by text for the rest: the scan costs about what a
// numeric column's does, rather than seventy times as much.

describe('criteria over a text column', () => {
  it('cost about what a numeric column costs', { timeout: 60000 }, () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const n = 20000;
    for (let r = 0; r < n; r++) {
      wb.setInput(id, r, 0, `Order ${r + 1}`); // a digit in every cell, so only the memo saves the parse
      wb.setInput(id, r, 1, String(r + 1));
    }
    const scan = (col, out) => {
      const t = performance.now();
      for (let i = 0; i < 100; i++) wb.setInput(id, i, out, `=COUNTIF(${col}$1:${col}$${n},${i + 1})`);
      for (let i = 0; i < 100; i++) wb.getValue(id, i, out);
      return performance.now() - t;
    };
    scan('B', 2); // warm both paths once
    scan('A', 3);
    const numeric = scan('B', 4);
    const text = scan('A', 5);
    expect(wb.getValue(id, 0, 4)).toBe(1);
    expect(wb.getValue(id, 0, 5)).toBe(0);
    // Parsing 20,000 texts per formula made the text column 75 times the numeric one; a memo lookup keeps it within a few times.
    expect(text, `text column ${text.toFixed(0)} ms, numeric column ${numeric.toFixed(0)} ms`).toBeLessThan(numeric * 8 + 60);
  });

  it('still read numbers stored as text, per regional format', () => {
    const cells = { A1: "'5", A2: "'1e3", A3: 'Order 5', A4: "'$7", A5: 'apple', A6: "'1,5", B1: 1, B2: 2, B3: 3, B4: 4, B5: 5, B6: 6 };
    expect(calc('COUNTIF(A1:A6,">4")', cells)).toBe(0);
    expect(calc('COUNTIF(A1:A6,5)', cells)).toBe(1);
    expect(calc('SUMIF(A1:A6,">6",B1:B6)', cells)).toBe(0);
    expect(calc('COUNTIF(A1:A6,"<>5")', cells)).toBe(6);
    const previous = getLocale();
    setLocale('de-DE');
    try {
      // "1,5" is one and a half in German and no number in English: the memo answers for the regional format in force.
      expect(calc('COUNTIF(A1:A6,1.5)', cells)).toBe(1);
      expect(calc('COUNTIF(A1:A6,"<2")', cells)).toBe(0);
    } finally { setLocale(previous); }
    expect(calc('COUNTIF(A1:A6,1.5)', cells)).toBe(0);
  });
});
