import { expect, it } from 'vitest';
import { parseDax, evaluateDax, DaxError } from '../src/core/dax.js';
const evaluate = (expression, values = [2, null, 0, 4]) => evaluateDax(expression, { table: 'Sales', column: (table, name) => {
  expect(table.toLowerCase()).toBe('sales'); expect(name).toBe('Amount'); return values;
}, rowCount: () => values.length });
it.each([['SUM', 6], ['AVERAGE', 2], ['MIN', 0], ['MAX', 4], ['COUNT', 3], ['COUNTA', 3]])('evaluates %s with blank and zero values', (name, value) => {
  expect(evaluate(`${name}(Sales[Amount])`)).toBe(value);
  expect(evaluate(`${name}([Amount])`, [])).toBeNull();
  expect(evaluate(`${name}([Amount])`, [null])).toBeNull();
});
it('preserves quoted names and comments without treating them as worksheet references', () => {
  expect(parseDax(" /* [ignored] */ sum('O''Brien; sales'[A]]B]) // end")).toEqual({ kind: 'call', name: 'SUM', args: [{ kind: 'reference', table: "O'Brien; sales", name: 'A]B' }] });
  expect(evaluateDax('SUM(销售[收入])', { column: (t, c) => { expect([t, c]).toEqual(['销售', '收入']); return [3]; } })).toBe(3);
});
it('distinguishes blank, zero, text and logical column values', () => {
  expect(evaluate('COUNT([Amount])', ['', 'x', 0, null])).toBe(3);
  expect(evaluate('COUNTA([Amount])', [false, true, '', null])).toBe(3);
  expect(() => evaluate('COUNT([Amount])', [true])).toThrow(DaxError);
  expect(evaluate('AVERAGE([Amount])', [false, null, 0, 2])).toBe(1);
  expect(evaluate('AVERAGE([Amount])', ['text', 2])).toBeNull();
  expect(() => evaluate('SUM([Amount])', ['2'])).toThrow(/number/);
  expect(evaluateDax('BLANK()')).toBeNull();
});
it('evaluates nested DIVIDE and enforces its constant alternate result', () => {
  expect(evaluate('DIVIDE(SUM([Amount]),COUNT([Amount]))')).toBe(2);
  expect(evaluateDax('DIVIDE(3,0)')).toBeNull();
  expect(evaluateDax('DIVIDE(3,BLANK(),-7)')).toBe(-7);
  expect(evaluateDax('DIVIDE(BLANK(),2)')).toBeNull();
  expect(() => evaluate('DIVIDE(1,0,SUM([Amount]))')).toThrow(/constant/);
  expect(evaluateDax('DIVIDE(5e1, +2)')).toBe(25);
});
it('counts rows through the supplied context and resolves scalar measure references separately', () => {
  expect(evaluate('COUNTROWS(Sales)')).toBe(4);
  expect(evaluate('COUNTROWS()', [])).toBeNull();
  expect(evaluateDax('DIVIDE([Gross],2)', { table: 'Sales', measure: (t, n) => { expect([t, n]).toEqual(['Sales', 'Gross']); return 18; } })).toBe(9);
});
it.each(['', 'SUM(', 'SUM(Sales[Amount]) trailing', "SUM('open[Amount])", 'SUM([open)', '/* open', '1+2', 'SUM(1)', 'SUM()', 'BLANK(1)', 'COUNTROWS(SUM([Amount]))', 'CALCULATE(1)', '1e999'])('rejects invalid or unsupported expressions: %s', expression => {
  expect(() => evaluate(expression)).toThrow(DaxError);
});
it('bounds nesting, work and non-finite results', () => {
  expect(() => parseDax('('.repeat(70) + '1' + ')'.repeat(70))).toThrow(/nesting/);
  expect(() => evaluateDax('SUM(T[C])', { column: () => [1, 2, 3] }, { maxValues: 2 })).toThrow(/limit/);
  expect(() => evaluate('SUM([Amount])', [Infinity])).toThrow(/finite/);
  expect(() => evaluate('SUM([Amount])', [1e308, 1e308])).toThrow(/finite/);
});
it('sums whole-number model columns exactly and rejects signed 64-bit overflow', () => {
  const run = (values, expression = 'SUM(T[C])') => evaluateDax(expression, { column: () => values, columnType: () => 'integer' });
  expect(run([2 ** 53, 1, -(2 ** 53)])).toBe(1);
  expect(run([2 ** 53, 1])).toBe(9007199254740993n);
  expect(run([2 ** 53, 1], '-SUM(T[C])')).toBe(-9007199254740993n);
  expect(run([2, 3], 'AVERAGE(T[C])')).toBe(2.5);
  expect(() => run([2 ** 62, 2 ** 62])).toThrow(/overflow/);
  expect(() => run([1.5])).toThrow(/fractional/);
  expect(() => parseDax('9007199254740993')).toThrow(/inexact/);
});

it.each([
  ['SUM', 9007199254740995n], ['MIN', 0], ['MAX', 9007199254740993n],
  ['COUNT', 3], ['COUNTA', 3], ['AVERAGE', Number(9007199254740995n) / 3],
])('accepts exact persisted integer inputs for %s', (aggregate, expected) => {
  expect(evaluateDax(`${aggregate}(T[C])`, { column: () => [9007199254740993n, null, 0n, 2n], columnType: () => 'integer' })).toBe(expected);
});
it('preserves exact integer cancellation and signed-long endpoints from native storage', () => {
  const run = (values, expression = 'SUM(T[C])') => evaluateDax(expression, { column: () => values, columnType: () => 'integer' });
  expect(run([9007199254740993n, 1, -9007199254740993n])).toBe(1);
  expect(run([-9223372036854775808n])).toBe(-9223372036854775808n);
  expect(run([9223372036854775807n])).toBe(9223372036854775807n);
  expect(() => run([9223372036854775807n, 1n])).toThrow(/overflow/);
  expect(run([null, null])).toBeNull();
});
it.each(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA'])('rejects out-of-range stored integers in %s', name => {
  for (const value of [9223372036854775808n, -9223372036854775809n]) {
    expect(() => evaluateDax(`${name}(T[C])`, { column: () => [value], columnType: () => 'integer' })).toThrow(/overflow/);
  }
});
it('does not coerce exact integers into a differently typed column', () => {
  expect(() => evaluateDax('SUM(T[C])', { column: () => [3n], columnType: () => 'number' })).toThrow(/number/);
  expect(() => evaluateDax('COUNT(T[C])', { column: () => [3n] })).toThrow(/column value/);
});
it('keeps stored integer evaluation bounded and converts only decimal aggregate results', () => {
  const context = { column: () => [9007199254740993n, null, 2n], columnType: () => 'integer' };
  expect(() => evaluateDax('SUM(T[C])', context, { maxValues: 2 })).toThrow(/limit/);
  expect(evaluateDax('DIVIDE(SUM(T[C]),2)', context)).toBe(Number(9007199254740995n) / 2);
});
