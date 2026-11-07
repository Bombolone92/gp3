import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { FUNCTIONS } from '../src/core/formula/functions.js';

// A lookup lifts over an array where one value is expected: a column of lookup values
// answers with a column of results, VLOOKUP with {1,2} as its column index with a row of two,
// INDEX with {1;2} as its row with two rows. Before, such a call was #VALUE! (a range where
// a value was wanted) or a misleading #N/A (an array is equal to nothing).
const DATA = {
  A1: 1, A2: 2, A3: 3, B1: 10, B2: 20, B3: 30, C1: 'a', C2: 'b', C3: 'c',
  E1: 'p', E2: 'q', E3: 'r', E4: 's', E5: 't', F1: 1, F2: 2, F3: 3, F4: 4, F5: 5,
  A9: '=SEQUENCE(2)', // A9:A10 = 1, 2
};

function sheet() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(DATA)) {
    const { r, c } = parseCellRef(a1);
    wb.setInput(id, r, c, String(text));
  }
  return { wb, id };
}

const calc = (formula) => {
  const { wb, id } = sheet();
  wb.setInput(id, 99, 25, `=${formula}`);
  return wb.getValue(id, 99, 25);
};
const text = (formula) => calc(`ARRAYTOTEXT(${formula},1)`);
const E = (code) => ({ error: code });

describe('lookups over an array of lookup values', () => {
  it('answer element by element, in the array\'s shape', () => {
    expect(text('XLOOKUP(A1:A2,A1:A3,B1:B3)')).toBe('{10;20}');
    expect(text('XLOOKUP({1,2},A1:A3,B1:B3)')).toBe('{10,20}');
    expect(text('XMATCH({1;2},A9#)')).toBe('{1;2}');
    expect(text('MATCH({1;2},A9#,0)')).toBe('{1;2}');
    expect(text('MATCH({1,2;3,1},A1:A3,0)')).toBe('{1,2;3,1}');
    expect(text('VLOOKUP({1;2},A9:A10,1,0)')).toBe('{1;2}');
    expect(text('HLOOKUP({1,2},{1,2;10,20},2,0)')).toBe('{10,20}');
    // LOOKUP finds 1 and 2 in A9:A10 and answers from A9#*10 = {10;20}.
    expect(text('LOOKUP({1;2},A9#,A9#*10)')).toBe('{10;20}');
  });

  it('give each element its own not-found error', () => {
    // 1 is found in row 1 of A1:B3 (B1 = 10); 9 is nowhere.
    expect(text('VLOOKUP({1;9},A1:B3,2,0)')).toBe('{10;#N/A}');
    expect(text('MATCH({1;"x"},A1:A3,0)')).toBe('{1;#N/A}');
    expect(text('XLOOKUP({1;9},A1:A3,B1:B3,"none")')).toBe('{10;"none"}');
  });
});

describe('lookups over an array of indexes', () => {
  it('VLOOKUP and HLOOKUP answer one cell per index', () => {
    // Row 2 of A1:C3 is (2, 20, "b"): columns 1 and 2 of it.
    expect(text('VLOOKUP(2,A1:C3,{1,2},0)')).toBe('{2,20}');
    // Column 2 of {1,2;10,20;100,200} is (2, 20, 200): rows 2 and 3 of it.
    expect(text('HLOOKUP(2,{1,2;10,20;100,200},{2;3},0)')).toBe('{20;200}');
    // Three lookup values down, two column indexes across: a 3 x 2 grid.
    expect(text('VLOOKUP(A1:A3,A1:C3,{2,3},0)')).toBe('{10,"a";20,"b";30,"c"}');
    // Two arrays down of different lengths pair row by row; the third row has no index: #N/A.
    expect(text('VLOOKUP({1;2;3},A1:C3,{2;3},0)')).toBe('{10;"b";#N/A}');
  });

  it('INDEX picks one cell per row or column number, a column and a row of them making a grid', () => {
    expect(text('INDEX(E1:F5,{1;2},1)')).toBe('{"p";"q"}');
    expect(text('INDEX(E1:F5,2,{1,2})')).toBe('{"q",2}');
    expect(text('INDEX(E1:F5,{1;2},{1,2})')).toBe('{"p",1;"q",2}');
    expect(text('INDEX(E1:E5,{1;3})')).toBe('{"p";"r"}');
    // The row numbers may come from cells: F1:F2 hold 1 and 2.
    expect(text('INDEX(E1:F5,F1:F2,1)')).toBe('{"p";"q"}');
    expect(text('INDEX(E1:F5,{1;9},1)')).toBe('{"p";#REF!}'); // row 9 is past the five rows
  });

  it('keeps single values and one-cell references as they were', () => {
    expect(calc('MATCH(2,A1:A3,0)')).toBe(2);
    expect(calc('MATCH(A2,A1:A3,0)')).toBe(2);
    expect(calc('VLOOKUP(2,A1:C3,2,0)')).toBe(20);
    expect(calc('VLOOKUP(A2,A1:C3,F2,0)')).toBe(20);
    expect(calc('XLOOKUP(2,A1:A3,B1:B3)')).toBe(20);
    expect(calc('INDEX(E1:F5,2,1)')).toBe('q');
    expect(calc('INDEX(E1:F5,F2,1)')).toBe('q');
    expect(calc('MATCH(9,A1:A3,0)')).toEqual(E('#N/A'));
    expect(calc('LOOKUP(2.5,A1:A3,B1:B3)')).toBe(20);
  });

  it('spills from a cell whose lookup was already known to yield an array', () => {
    const { wb, id } = sheet();
    wb.setInput(id, 19, 1, '=XLOOKUP(A1:A2,A1:A3,B1:B3)');
    expect([wb.getValue(id, 19, 1), wb.getValue(id, 20, 1)]).toEqual([10, 20]);
    wb.setInput(id, 19, 3, '=INDEX(E1:F5,{1;2},1)');
    expect([wb.getValue(id, 19, 3), wb.getValue(id, 20, 3)]).toEqual(['p', 'q']);
  });

  it('marks the lifted argument positions on the definitions for the workbook', () => {
    expect(FUNCTIONS.MATCH.liftArgs).toEqual([0]);
    expect(FUNCTIONS.XMATCH.liftArgs).toEqual([0]);
    expect(FUNCTIONS.XLOOKUP.liftArgs).toEqual([0]);
    expect(FUNCTIONS.LOOKUP.liftArgs).toEqual([0]);
    expect(FUNCTIONS.VLOOKUP.liftArgs).toEqual([0, 2]);
    expect(FUNCTIONS.HLOOKUP.liftArgs).toEqual([0, 2]);
    expect(FUNCTIONS.INDEX.liftArgs).toEqual([1, 2]);
  });
});
