import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// FVSCHEDULE read text inside its schedule as a number, so a rate typed as text or a stray word was
// compounded in. As documented, any value in the schedule but a number or a blank cell is
// #VALUE!, as NPV and the other cash-flow functions here already decline to read text as a rate.
const VALUE = { error: '#VALUE!' };

it.each([
  ['FVSCHEDULE(1,{"0.09",0.11})', VALUE],
  ['FVSCHEDULE(1,{0.09,"x"})', VALUE],
  ['FVSCHEDULE(1,{0.09,TRUE})', VALUE],
  ['FVSCHEDULE(1,A1:A3)', VALUE, { A1: '0.09', A2: 'x', A3: '0.1' }],
  ['FVSCHEDULE(1,A1:A3)', VALUE, { A1: '0.09', A2: '=""', A3: '0.1' }],
  ['FVSCHEDULE(1,{0.09,#N/A})', { error: '#N/A' }],
])('%s is refused', (formula, expected, cells = {}) => {
  expect(calc(formula, cells)).toEqual(expected);
});

it.each([
  ['FVSCHEDULE(1,A1:A3)', 1.09 * 1.1, { A1: '0.09', A3: '0.1' }], // a blank cell is passed over
  ['FVSCHEDULE(1,{0.09,0.11,0.1})', 1.09 * 1.11 * 1.1],
  ['FVSCHEDULE(100,0.1)', 110],
  ['FVSCHEDULE(1,A1)', 1.1, { A1: '0.1' }],
])('%s compounds the rates', (formula, expected, cells = {}) => {
  expect(calc(formula, cells)).toBeCloseTo(expected, 12);
});
