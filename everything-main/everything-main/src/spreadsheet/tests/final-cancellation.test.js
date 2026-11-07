import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import { Workbook } from '../src/core/workbook.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { astToText, evaluateParts } from '../src/core/formula/print.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-final-cancellation.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native final-operation cancellation: $expression', ({ expression, expected }) => {
  const actual = calc(expression);
  if (expected === 0) expect(actual).toBe(0);
  else expect(actual / expected).toBeCloseTo(1, 11);
});

it('preserves significant parentheses when printing and reparsing a formula', () => {
  for (const expression of ['(0.1+0.2-0.3)', '(0.1+0.2)-0.3', '1*(0.1+0.2-0.3)',
    'LAMBDA(v,(v+0.2-0.3))(0.1)', '0.1+(0.2-0.3)', '(0.1+0.2-0.3)+0']) {
    const printed = astToText(parseFormula(expression));
    expect(printed).toBe(expression.toUpperCase());
    expect(calc(printed)).toBe(calc(expression));
  }
});

it('corrects each spilled final operation and each LAMBDA invocation independently', () => {
  for (const expression of ['{0.1,0.2}+0.2-0.3', 'LAMBDA(v,v+0.2-0.3)({0.1,0.2})',
    'MAP({0.1,0.2},LAMBDA(v,v+0.2-0.3))']) {
    const wb = new Workbook(), id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=' + expression);
    expect(wb.getValue(id, 0, 0)).toBe(0);
    expect(wb.getValue(id, 0, 1)).toBeCloseTo(0.1, 15);
  }
  expect(calc('({0.1,0.2}+0.2-0.3)')).toBe(2 ** -54);
});

it('shows the corrected final value and uncorrected intermediate values in Evaluate formula', () => {
  const wb = new Workbook();
  const { parts } = evaluateParts('0.1+0.2-0.3', wb.contextFor(wb.activeSheetId, 0, 0));
  expect(parts.at(-1).value).toBe(0);
  expect(parts.find(p => p.text === '0.1+0.2').value).toBe(0.1 + 0.2);
  expect(evaluateParts('(0.1+0.2-0.3)', wb.contextFor(wb.activeSheetId, 0, 0)).parts.at(-1).value).toBe(2 ** -54);
});

it('evaluates a defined formula at its own boundary even inside another function', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.defineName('BareResidual', '0.1+0.2-0.3');
  wb.defineName('GroupedResidual', '(0.1+0.2-0.3)');
  for (const [expression, expected] of [['BareResidual', 0], ['SUM(BareResidual)', 0],
    ['LET(v,BareResidual,v)', 0], ['GroupedResidual', 2 ** -54]]) {
    wb.setInput(id, 0, 0, '=' + expression);
    expect(wb.getValue(id, 0, 0)).toBe(expected);
  }
});
