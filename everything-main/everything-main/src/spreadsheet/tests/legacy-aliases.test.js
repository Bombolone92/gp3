import { expect, it } from 'vitest';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import { calc } from './helpers/calc.js';

it('answers the legacy names of the distribution functions', () => {
  expect(calc('FINV(0.05,3,4)')).toBeCloseTo(6.5914, 3);
  expect(calc('FINV(0.05,3,4)')).toBe(calc('F.INV.RT(0.05,3,4)'));
  expect(calc('FTEST({1,2,3,4,5},{2,4,6,9,12})')).toBe(calc('F.TEST({1,2,3,4,5},{2,4,6,9,12})'));
  expect(calc('GAMMAINV(0.5,3,1)')).toBeCloseTo(2.67406, 4);
  expect(calc('BETAINV(0.5,2,3)')).toBeCloseTo(0.385728, 4);
  expect(calc('CRITBINOM(10,0.5,0.5)')).toBe(5);
});

it('leaves no alias unresolved', () => {
  const unresolved = Object.entries(FUNCTIONS).filter(([, def]) => def.alias || typeof def.fn !== 'function').map(([name]) => name);
  expect(unresolved).toEqual([]);
});
