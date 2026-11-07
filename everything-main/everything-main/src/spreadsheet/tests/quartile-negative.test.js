import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// QUARTILE's quart is 0 to 4, its fraction dropped: below 0 it is #NUM!, and so is
// -0.5, which dropping the fraction had turned into a 0 that passed as the minimum.
it('QUARTILE is #NUM! for a quart below zero, before its fraction is dropped', () => {
  expect(calc('QUARTILE({1,2,3,4},-0.5)')).toEqual(E('#NUM!'));
  expect(calc('QUARTILE({1,2,3,4},-1)')).toEqual(E('#NUM!'));
  expect(calc('QUARTILE({1,2,3,4},5)')).toEqual(E('#NUM!'));
  expect(calc('QUARTILE.INC({1,2,3,4},-0.5)')).toEqual(E('#NUM!'));
  // 0.5 is quart 0, the minimum; 4.5 is quart 4, the maximum; 2 is the median, 2.5.
  expect(calc('QUARTILE({1,2,3,4},0.5)')).toBe(1);
  expect(calc('QUARTILE({1,2,3,4},4.5)')).toBe(4);
  expect(calc('QUARTILE({1,2,3,4},2)')).toBe(2.5);
});
