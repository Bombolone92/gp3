import { describe, it, expect } from 'vitest';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import { calc } from './helpers/calc.js';

// A range's values array is shared by every formula that reads it within one calculation.
// From its second use with a plain text criterion the *IF family indexes it, so each formula
// visits only the rows that match instead of every row; the answers are the ones a scan gives.
const CATS = ['north', 'South', 'east', 'WEST', 'centre'];
const ROWS = 5000;
const shared = () => ({
  A: { range: true, values: Array.from({ length: ROWS }, (_, r) => [r % 7 === 3 ? { error: '#N/A' } : r % 11 === 5 ? r : CATS[r % 5] + (r % 40)]) },
  B: { range: true, values: Array.from({ length: ROWS }, (_, r) => [r % 97]) },
  C: { range: true, values: Array.from({ length: ROWS }, (_, r) => [r % 2 ? 'x' : 'y']) },
});

/** The same call on a shared (indexed from the second use) and on fresh (scanned) values arrays. */
function both(name, args) {
  const s = shared();
  const indexed = [1, 2, 3].map(() => FUNCTIONS[name].fn(args(s)));
  const scanned = FUNCTIONS[name].fn(args(shared()));
  expect(indexed[0]).toEqual(scanned);
  expect(indexed[2]).toEqual(scanned);
  return scanned;
}

describe('indexed text criteria', () => {
  it('give the answers a scan gives, whatever the case, error cells included', () => {
    expect(both('COUNTIF', (s) => [s.A, 'NORTH0'])).toBeGreaterThan(0);
    expect(both('COUNTIF', (s) => [s.A, 'west3'])).toBeGreaterThan(0);
    expect(both('COUNTIF', (s) => [s.A, '#N/A'])).toBe(Math.ceil((ROWS - 3) / 7));
    expect(both('COUNTIF', (s) => [s.A, 'nowhere'])).toBe(0);
    expect(both('COUNTIF', (s) => [s.A, '<>north0'])).toBeLessThan(ROWS);
    expect(both('SUMIF', (s) => [s.A, 'east2', s.B])).toBeGreaterThan(0);
    expect(both('AVERAGEIF', (s) => [s.A, 'south1', s.B])).toBeGreaterThan(0);
    expect(both('SUMIFS', (s) => [s.B, s.A, 'centre4', s.B, '>10'])).toBeGreaterThan(0);
    expect(both('SUMIFS', (s) => [s.B, s.B, '>10', s.A, 'centre4'])).toBeGreaterThan(0);
    expect(both('COUNTIFS', (s) => [s.C, 'Y', s.A, 'north0'])).toBeGreaterThan(0);
    expect(both('COUNTIFS', (s) => [s.A, 'north0', s.C, 'y'])).toBeGreaterThan(0);
    expect(both('COUNTIFS', (s) => [s.A, 'north0', s.C, 'x'])).toBe(0);
    expect(both('MAXIFS', (s) => [s.B, s.A, 'east2'])).toBeGreaterThan(0);
    expect(both('MINIFS', (s) => [s.B, s.A, 'east2'])).toBeGreaterThanOrEqual(0);
    expect(both('AVERAGEIFS', (s) => [s.B, s.A, 'west3'])).toBeGreaterThan(0);
  });

  it('index a range of several columns by its own width', () => {
    const grid = { range: true, values: [['a', 'b', 'c'], ['b', 'a', 'a'], ['c', 'c', 'a']] };
    const nums = { range: true, values: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] };
    for (let i = 0; i < 3; i++) {
      expect(FUNCTIONS.COUNTIF.fn([grid, 'a'])).toBe(4);
      expect(FUNCTIONS.SUMIF.fn([grid, 'A', nums])).toBe(1 + 5 + 6 + 9);
      expect(FUNCTIONS.SUMIFS.fn([nums, grid, 'c', nums, '>3'])).toBe(7 + 8);
      expect(FUNCTIONS.MAXIFS.fn([nums, grid, 'b'])).toBe(4);
    }
  });

  it('still work through the sheet, with blank, numeric and wildcard criteria untouched', () => {
    const cells = { A1: 'x', A2: 'y', A3: 'x', A4: '', B1: 1, B2: 2, B3: 3, B4: 4 };
    expect(calc('COUNTIF(A1:A4,"x")+COUNTIF(A1:A4,"x")+COUNTIF(A1:A4,"X")', cells)).toBe(6);
    expect(calc('SUMIFS(B1:B4,A1:A4,"x")+SUMIFS(B1:B4,A1:A4,"x")', cells)).toBe(8);
    expect(calc('COUNTIF(A1:A10,"")', cells)).toBe(7);
    expect(calc('COUNTIF(A1:A4,"x*")', cells)).toBe(2);
    expect(calc('COUNTIF(B1:B4,3)', cells)).toBe(1);
  });

  it('make many formulas over one range far cheaper than scanning it', () => {
    const s = shared();
    const keys = Array.from({ length: 200 }, (_, i) => CATS[i % 5] + (i % 40));
    const run = (prefix) => {
      const t0 = performance.now();
      let n = 0;
      for (const key of keys) n += FUNCTIONS.COUNTIF.fn([s.A, prefix + key]);
      return { ms: performance.now() - t0, n };
    };
    const scanned = run('<>');
    const indexed = run('');
    expect(indexed.n + scanned.n).toBe(keys.length * ROWS);
    // Observed around 100x; the test asks only for 3x, so load on the machine cannot make it flaky.
    expect(indexed.ms * 3).toBeLessThan(scanned.ms);
  });
});
