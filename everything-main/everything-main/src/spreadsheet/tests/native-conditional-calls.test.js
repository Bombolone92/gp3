import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { evaluate } from '../src/core/formula/evaluator.js';
import { parseFormula } from '../src/core/formula/parser.js';

const calc = (formula, ctx = {}) => evaluate(parseFormula(formula), ctx);
const choices = [
  ['IF', 'TRUE,10,20', 10], ['IFS', 'FALSE,10,TRUE,20', 20],
  ['IFERROR', '1/0,20', 20], ['IFNA', 'NA(),20', 20],
  ['SWITCH', '2,1,10,2,20', 20], ['CHOOSE', '2,10,20', 20],
];

it.each(choices)('calls stored %s functions through local bindings, expressions, and parameters', (name, args, expected) => {
  expect(calc(`LET(fn,${name},fn(${args}))`)).toBe(expected);
  expect(calc(`(${name})(${args})`)).toBe(expected);
  expect(calc(`LAMBDA(fn,fn(${args}))(${name})`)).toBe(expected);
});

it.each(choices)('calls a defined name containing %s', (name, args, expected) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.defineName('Conditional', `=${name}`);
  wb.setInput(id, 0, 0, `=Conditional(${args})`);
  expect(wb.getValue(id, 0, 0)).toBe(expected);
});

it.each([
  ['IF', 'TRUE,10,B2'], ['IFS', 'TRUE,10,TRUE,B2'],
  ['IFERROR', '10,B2'], ['IFNA', '10,B2'],
  ['SWITCH', '1,1,10,2,B2'], ['CHOOSE', '1,10,B2'],
])('leaves skipped arguments unread when %s is stored', (name, args) => {
  const getValue = vi.fn(() => { throw new Error('Skipped cell was read'); });
  expect(calc(`LET(fn,${name},fn(${args}))`, { currentSheet: 'Sheet1', getValue })).toBe(10);
  expect(getValue).not.toHaveBeenCalled();
});

it.each([
  ['IF', '{TRUE,FALSE},10,20', [[10, 20]]],
  ['IFERROR', '{1,#DIV/0!},20', [[1, 20]]],
  ['IFNA', '{#N/A,#DIV/0!},20', [[20, { error: '#DIV/0!' }]]],
  ['CHOOSE', '{1,2},10,20', [[10, 20]]],
])('retains array results when calling stored %s', (name, args, values) => {
  expect(calc(`LET(fn,${name},fn(${args}))`)).toEqual({ range: true, values });
});

it.each([
  ['IF', '{TRUE,FALSE},{10,11},{20,21}', [[10, 21]]],
  ['IFS', '{TRUE,FALSE},{10,11},{TRUE,TRUE},{20,21}', [[10, 21]]],
  ['IFERROR', '{1,#DIV/0!},{20,21}', [[1, 21]]],
  ['IFNA', '{#N/A,2},{20,21}', [[20, 2]]],
  ['SWITCH', '{1,2},{1,1},{10,11},{2,2},{20,21}', [[10, 21]]],
  ['CHOOSE', '{1,2},{10,11},{20,21}', [[10, 21]]],
])('passes %s directly as a MAP callback', (name, args, values) => {
  expect(calc(`MAP(${args},${name})`)).toEqual({ range: true, values });
});

it.each([
  ['IF', '{TRUE,FALSE}', [[20, false]]],
  ['IFERROR', '{1,#DIV/0!}', [[1, 20]]],
  ['IFNA', '{#N/A,#DIV/0!}', [[20, { error: '#DIV/0!' }]]],
])('retains array handling when REDUCE invokes %s', (name, initial, values) => {
  expect(calc(`REDUCE(${initial},{20},${name})`)).toEqual({ range: true, values });
});

it('preserves omissions, error selection, and successful array fallback laziness', () => {
  expect(calc('LET(fn,IF,fn(FALSE))')).toBe(false);
  expect(calc('LET(fn,IF,fn(TRUE,,20))')).toBeNull();
  expect(calc('LET(fn,CHOOSE,fn(1,,20))')).toBeNull();
  expect(calc('LET(fn,IFNA,fn(1/0,20))')).toEqual({ error: '#DIV/0!' });
  const getValue = vi.fn(() => { throw new Error('Unused fallback read'); });
  expect(calc('LET(fn,IFERROR,fn({1,2},B2))', { getValue })).toEqual({ range: true, values: [[1, 2]] });
  expect(getValue).not.toHaveBeenCalled();
});

it('preserves selected addresses through nested calls and cross-sheet edits', () => {
  const wb = new Workbook(), id = wb.activeSheetId, other = wb.addSheet('Source').id;
  wb.setInput(other, 2, 2, '7');
  wb.setInput(id, 0, 0, '=LET(fn,IF,OFFSET(fn(TRUE,Source!B2,D4),1,1))');
  expect(wb.getValue(id, 0, 0)).toBe(7);
  wb.setInput(other, 2, 2, '11');
  expect(wb.getValue(id, 0, 0)).toBe(11);
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe(7);
});
