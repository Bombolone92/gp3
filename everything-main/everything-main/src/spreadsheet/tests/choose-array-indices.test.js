import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { evaluate } from '../src/core/formula/evaluator.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { FUNCTIONS } from '../src/core/formula/functions.js';

const E = (error) => ({ error });
const calc = (formula) => evaluate(parseFormula(formula), {});

it.each([
  ['CHOOSE({1},10,20)', [[10]]],
  ['CHOOSE({1,2},10,20)', [[10, 20]]],
  ['CHOOSE({2;1;2},10,20)', [[20], [10], [20]]],
  ['CHOOSE({1,2;2,1},10,20)', [[10, 20], [20, 10]]],
  ['CHOOSE({1.9,2.8,0,3},10,20)', [[10, 20, E('#VALUE!'), E('#VALUE!')]]],
  ['CHOOSE({1,#N/A,2},10,20)', [[10, E('#N/A'), 20]]],
  ['CHOOSE({1,2},10,1/0)', [[10, E('#DIV/0!')]]],
  ['CHOOSE({1,2},"Text",TRUE)', [['Text', true]]],
  ['CHOOSE({1,2},,20)', [[0, 20]]], // a choice left empty is 0, as for IF
  ['CHOOSE({1,2},{10;11;12},{20;21;22})', [[10, 20], [11, 21], [12, 22]]],
  ['CHOOSE({1;2},{10,11,12},{20,21,22})', [[10, 11, 12], [20, 21, 22]]],
  ['CHOOSE({1,2},{10;11},{20;21;22})', [[10, 20], [11, 21], [E('#N/A'), 22]]],
  ['CHOOSE({1,2},10,{20;21;22})', [[10, 20], [10, 21], [10, 22]]],
])('evaluates each index in %s', (formula, values) => {
  expect(calc(formula)).toEqual({ range: true, values });
});

it('evaluates each array choice once, including unselected choices', () => {
  const first = vi.fn(() => 10), second = vi.fn(() => 20);
  expect(FUNCTIONS.CHOOSE.fn([() => ({ range: true, values: [[1, 1, 1]] }), first, second]))
    .toEqual({ range: true, values: [[10, 10, 10]] });
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});

it('bounds the allocation when a row of indices expands against column choices', () => {
  const indices = { range: true, values: [Array(1000).fill(1)] };
  const choice = { range: true, values: Array.from({ length: 1000 }, () => [10]) };
  expect(FUNCTIONS.CHOOSE.fn([() => indices, () => choice])).toEqual(E('#NUM!'));
});

it('handles a single-element array without taking the scalar reference path', () => {
  const getValue = vi.fn(() => 42);
  const result = evaluate(parseFormula('CHOOSE({1},B2,C3)'), { currentSheet: 'Sheet1', getValue });
  expect(result).toEqual({ range: true, values: [[42]] });
  expect(getValue).toHaveBeenCalledTimes(2);
});

it('keeps scalar choices lazy and range results addressless for multiple indices', () => {
  expect(calc('CHOOSE(1,10,1/0)')).toBe(10);
  expect(calc('ISREF(CHOOSE({1,2},10,20))')).toBe(false);
  expect(calc('SUM(CHOOSE({1,2},10,20))')).toBe(30);
});

it('spills range choices, recalculates changes, and restores results after undo', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (let r = 0; r < 3; r++) {
    wb.setInput(id, r, 0, String(r + 10));
    wb.setInput(id, r, 1, String(r + 20));
  }
  wb.setInput(id, 0, 5, '=CHOOSE({1,2},A1:A3,B1:B3)');
  expect(wb.getValue(id, 2, 6)).toBe(22);
  expect(wb.getValue(id, 2, 5)).toBe(12);
  wb.setInput(id, 2, 1, '99');
  expect(wb.getValue(id, 2, 6)).toBe(99);
  wb.undo();
  expect(wb.getValue(id, 2, 6)).toBe(22);
  wb.setInput(id, 1, 6, 'occupied');
  expect(wb.getValue(id, 0, 5)).toEqual(E('#SPILL!'));
});

it('accepts a cell range of indices and applies the resulting array in a lookup', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '2'); wb.setInput(id, 0, 1, '1');
  wb.setInput(id, 0, 5, '=CHOOSE(A1:B1,10,20)');
  expect(wb.getValue(id, 0, 6)).toBe(10);
  expect(wb.getValue(id, 0, 5)).toBe(20);
  wb.setInput(id, 0, 5, '=VLOOKUP("b",CHOOSE({1,2},{"a";"b"},{10;20}),2,FALSE)');
  expect(wb.getValue(id, 0, 5)).toBe(20);
});
