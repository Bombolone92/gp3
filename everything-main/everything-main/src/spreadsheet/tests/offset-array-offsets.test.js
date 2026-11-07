import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { calc } from './helpers/calc.js';

function arr(formula, cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}

// OFFSET answered #VALUE! for an array of row or column offsets. It lifts over them, OFFSET(A1,{1;2},0)
// being {A2;A3}, as INDEX and VLOOKUP already were lifted here over arrays of indexes.
const CELLS = { A1: 'a', A2: 'b', A3: 'c', B1: 'x', B2: 'y', B3: 'z', C1: '1', C2: '2', C3: '3', D1: '1', D2: '2' };

it('lifts over an array of row offsets', () => {
  expect(arr('OFFSET(A1,{1;2},0)', CELLS)).toEqual([['b'], ['c']]);
  expect(arr('OFFSET(A1,{0,1,2},0)', CELLS)).toEqual([['a', 'b', 'c']]);
  expect(arr('OFFSET(A1,D1:D2,0)', CELLS)).toEqual([['b'], ['c']]);
});

it('lifts over an array of column offsets, and over both at once', () => {
  expect(arr('OFFSET(A1,0,{0,1})', CELLS)).toEqual([['a', 'x']]);
  expect(arr('OFFSET(A1,{0;1},{0,1})', CELLS)).toEqual([['a', 'x'], ['b', 'y']]);
  expect(arr('OFFSET(A1,{0;1;2},{0,1})', CELLS)).toEqual([['a', 'x'], ['b', 'y'], ['c', 'z']]);
});

it('feeds the lifted values to other functions', () => {
  expect(calc('SUM(OFFSET(C1,{0;1;2},0))', CELLS)).toBe(6);
  expect(calc('SUMPRODUCT(OFFSET(C1,{0;2},0))', CELLS)).toBe(4);
  expect(calc('TEXTJOIN(",",TRUE,OFFSET(A1,{0;1;2},0))', CELLS)).toBe('a,b,c');
});

it('answers an error for the elements that leave the grid', () => {
  expect(arr('OFFSET(A1,{1;-1},0)', CELLS)).toEqual([['b'], [{ error: '#REF!' }]]);
});

it('keeps a scalar offset a reference', () => {
  expect(calc('ROW(OFFSET(A1,2,0))', CELLS)).toBe(3);
  expect(calc('ROWS(OFFSET(A1,1,0,2,1))', CELLS)).toBe(2);
  expect(calc('OFFSET(A1,D1,0)', CELLS)).toBe('b');
  expect(calc('SUM(OFFSET(C1,0,0,3,1))', CELLS)).toBe(6);
  expect(calc('SUM(A1:OFFSET(C1,2,0))', CELLS)).toBe(6);
});

it('subtotals each OFFSET reference before collapsing its values', () => {
  const cells = { A1: '10', B1: '20', C1: '30', A2: '40', B2: '50' };
  expect(arr('SUBTOTAL(2,OFFSET(A1:C3,{0;1;2},0,1))', cells)).toEqual([[3], [2], [0]]);
  expect(arr('SUBTOTAL(9,OFFSET(A1:C3,{0;1;2},0,1))', cells)).toEqual([[60], [90], [0]]);
  expect(calc('SUM(SUBTOTAL(9,OFFSET(A1:C3,{0;1;2},0,1)))', cells)).toBe(150);
  expect(arr('SUBTOTAL(9,OFFSET(A1,{0;-1},0))', cells)).toEqual([[10], [{ error: '#REF!' }]]);
});

it('discovers a named subtotal vector when a spill child is read before the formula cell', () => {
  const wb = new Workbook(), id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, '10');
  wb.setInput(id, 1, 0, '20');
  wb.defineName('positions', 'ROW(A1:A3)');
  wb.defineName('counts', 'SUBTOTAL(2,OFFSET(A1,positions-1,0))');
  wb.setInput(id, 0, 3, '=counts');
  expect(wb.getValue(id, 1, 3)).toBe(1);
  expect(wb.getValue(id, 2, 3)).toBe(0);
  wb.setInput(id, 2, 0, '30');
  expect(wb.getValue(id, 2, 3)).toBe(1);
});

it('retains hidden-row and nested-subtotal rules for each lifted reference', () => {
  const wb = new Workbook(), id = wb.sheets[0].id;
  for (let r = 0; r < 3; r++) {
    wb.setInput(id, r, 0, String((r + 1) * 10));
    wb.setInput(id, r, 1, r ? '7' : '=SUBTOTAL(9,C1:C2)');
    wb.setInput(id, r, 2, '5');
  }
  wb.setHidden(id, 'row', [1], true);
  wb.setInput(id, 0, 5, '=SUBTOTAL(109,OFFSET(A1:B3,{0;1;2},0,1))');
  expect(wb.rangeValues(id, { r1: 0, c1: 5, r2: 2, c2: 5 })).toEqual([[10], [0], [37]]);
  wb.setInput(id, 0, 5, '=SUBTOTAL(9,OFFSET(A1:B3,{0;1;2},0,1))');
  expect(wb.rangeValues(id, { r1: 0, c1: 5, r2: 2, c2: 5 })).toEqual([[10], [27], [37]]);
});
