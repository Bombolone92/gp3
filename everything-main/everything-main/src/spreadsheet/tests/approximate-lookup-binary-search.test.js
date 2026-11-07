import { describe, expect, it } from 'vitest';
import { FUNCTIONS, err } from '../src/core/formula/functions.js';
import { Workbook } from '../src/core/workbook.js';

// The approximate forms — MATCH with 1 or -1, VLOOKUP and HLOOKUP with no fourth argument, LOOKUP —
// say the data is sorted, which is what halving needs, so from a vector's second search they name the
// rows they visit instead of walking to the answer, as XLOOKUP's search_mode 2 already did. A column
// whose values of the needle's type do not run that way is scanned as before, so the answers are the
// scan's throughout: sorted or not, over errors, blanks and values of another type, and the last of a
// run of duplicates.
const range = (values) => ({ range: true, values });
const column = (list) => range(list.map((v) => [v]));

/** The same call on shared arrays (indexed from the second search) and on fresh ones (scanned). */
function both(name, args, make) {
  const shared = make();
  const indexed = [1, 2, 3, 4].map(() => FUNCTIONS[name].fn(args(shared)));
  const scanned = FUNCTIONS[name].fn(args(make()));
  expect(indexed[0]).toEqual(scanned);
  expect(indexed[3]).toEqual(scanned);
  return scanned;
}

const ascending = () => column([1, 2, 2, 5, 8, 8, 13]);
const descending = () => column([13, 8, 5, 2, 2, 1]);
const unsorted = () => column([5, 1, 8, 2, 2]);
const mixed = () => column([1, null, err('#DIV/0!'), 5, 'x', 8, 'z']);
const words = () => column(['ant', 'bee', 'bee', 'cow', 'dog']);
const table = () => range([[1, 'r1'], [2, 'r2'], [2, 'r3'], [5, 'r4'], [8, 'r5'], [8, 'r6'], [13, 'r7']]);

describe('approximate lookups', () => {
  it('answer as a scan does over sorted data with duplicates', () => {
    expect(both('MATCH', (t) => [2, t, 1], ascending)).toBe(3); // the last of the duplicates
    expect(both('MATCH', (t) => [4, t, 1], ascending)).toBe(3);
    expect(both('MATCH', (t) => [8, t, 1], ascending)).toBe(6);
    expect(both('MATCH', (t) => [99, t, 1], ascending)).toBe(7);
    expect(both('MATCH', (t) => [0, t, 1], ascending)).toEqual(err('#N/A'));
    expect(both('MATCH', (t) => [2, t, -1], ascending)).toEqual(err('#N/A')); // ascending data, descending search
    expect(both('VLOOKUP', (t) => [4, t, 2], table)).toBe('r3');
    expect(both('VLOOKUP', (t) => [99, t, 2], table)).toBe('r7');
    expect(both('VLOOKUP', (t) => [0, t, 2], table)).toEqual(err('#N/A'));
    expect(both('LOOKUP', (t) => [4, t], table)).toBe('r3');
  });

  it('answer as a scan does over descending data', () => {
    expect(both('MATCH', (t) => [2, t, -1], descending)).toBe(5);
    expect(both('MATCH', (t) => [4, t, -1], descending)).toBe(3);
    expect(both('MATCH', (t) => [8, t, -1], descending)).toBe(2);
    expect(both('MATCH', (t) => [0, t, -1], descending)).toBe(6);
    expect(both('MATCH', (t) => [99, t, -1], descending)).toEqual(err('#N/A'));
    expect(both('MATCH', (t) => [2, t, 1], descending)).toEqual(err('#N/A')); // the first value already sits above 2
  });

  it('answer as a scan does over unsorted data, where the first larger value ends the search', () => {
    expect(both('MATCH', (t) => [2, t, 1], unsorted)).toEqual(err('#N/A'));
    expect(both('MATCH', (t) => [5, t, 1], unsorted)).toBe(2);
    expect(both('MATCH', (t) => [6, t, 1], unsorted)).toBe(2);
    expect(both('MATCH', (t) => [9, t, 1], unsorted)).toBe(5);
    expect(both('MATCH', (t) => [2, t, -1], unsorted)).toBe(1);
    expect(both('MATCH', (t) => [9, t, -1], unsorted)).toEqual(err('#N/A'));
  });

  it('pass over errors, blanks and values of another type, as a scan does', () => {
    expect(both('MATCH', (t) => [6, t, 1], mixed)).toBe(4);
    expect(both('MATCH', (t) => [1, t, 1], mixed)).toBe(1);
    expect(both('MATCH', (t) => [9, t, 1], mixed)).toBe(6);
    expect(both('MATCH', (t) => ['y', t, 1], mixed)).toBe(5); // the text cells keep their own order
    expect(both('MATCH', (t) => ['a', t, 1], mixed)).toEqual(err('#N/A'));
    expect(both('MATCH', (t) => [null, t, 1], mixed)).toEqual(err('#N/A')); // an empty key is not a zero
  });

  it('answer as a scan does over text and booleans', () => {
    expect(both('MATCH', (t) => ['bee', t, 1], words)).toBe(3);
    expect(both('MATCH', (t) => ['BEE', t, 1], words)).toBe(3);
    expect(both('MATCH', (t) => ['cat', t, 1], words)).toBe(3);
    expect(both('MATCH', (t) => ['aa', t, 1], words)).toEqual(err('#N/A'));
    expect(both('MATCH', (t) => [2, t, 1], words)).toEqual(err('#N/A'));
    expect(both('MATCH', (t) => [true, t, 1], () => column([false, false, true]))).toBe(3);
    expect(both('MATCH', (t) => [false, t, 1], () => column([false, false, true]))).toBe(2);
  });

  it('choose numeric neighbors using stored precision', () => {
    const near = () => column([1, 1 + 2e-16, 2, 1e15 + 2, 1e16]);
    expect(both('MATCH', (t) => [1, t, 1], near)).toBe(1); // the next stored value is greater, even though = considers it equal
    expect(both('MATCH', (t) => [1e15 + 3, t, 1], near)).toBe(4);
    expect(both('MATCH', (t) => [0.1 + 0.2, t, 1], () => column([0.3, 1]))).toBe(1);
  });

  it('visit the rows the search names instead of every row, once the vector is indexed', () => {
    const rows = 4000;
    const reads = { n: 0 };
    const values = Array.from({ length: rows }, (_, i) => {
      const row = [];
      Object.defineProperty(row, 0, { get() { reads.n++; return i * 3; }, enumerable: true });
      return row;
    });
    const vector = range(values);
    FUNCTIONS.MATCH.fn([1, vector, 1]); // the first search of a vector is scanned
    reads.n = 0;
    for (let k = 0; k < 200; k++) expect(FUNCTIONS.MATCH.fn([k * 57, vector, 1])).toBe(Math.floor((k * 57) / 3) + 1);
    // One pass builds the index; each search after it costs about a dozen reads, not four thousand.
    expect(reads.n).toBeLessThan(rows * 2);
  });

  it('follow an edit and its undo through the sheet, since the index lives with the values it describes', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    for (let r = 0; r < 60; r++) { wb.setInput(id, r, 0, String(r * 2)); wb.setInput(id, r, 1, `v${r}`); }
    for (let r = 0; r < 5; r++) wb.setInput(id, r, 3, `=VLOOKUP(${21 + r * 2},A:B,2)&MATCH(${21 + r * 2},A:A,1)`);
    const read = () => Array.from({ length: 5 }, (_, r) => wb.getValue(id, r, 3));
    expect(read()).toEqual(['v1011', 'v1112', 'v1213', 'v1314', 'v1415']);
    wb.setInput(id, 11, 0, '21'); // row 12 now holds 21, which 21 and 23 both answer with
    expect(read()).toEqual(['v1112', 'v1112', 'v1213', 'v1314', 'v1415']);
    wb.setInput(id, 11, 0, '30'); // out of order: the search falls back to the scan, which stops there
    expect(read()).toEqual(['v1011', 'v1011', 'v1011', 'v1011', 'v1011']);
    wb.undo();
    expect(read()).toEqual(['v1112', 'v1112', 'v1213', 'v1314', 'v1415']);
    wb.undo();
    expect(read()).toEqual(['v1011', 'v1112', 'v1213', 'v1314', 'v1415']);
  });
});
