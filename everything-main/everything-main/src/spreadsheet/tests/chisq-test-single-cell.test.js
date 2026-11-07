import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// A one-cell table has rows * columns - 1 = 0 degrees of freedom, so no
// chi-square distribution applies: the answer is #N/A.
it('answers #N/A for a single cell', () => {
  expect(calc('CHISQ.TEST({5},{4})')).toEqual({ error: '#N/A' });
  expect(calc('CHITEST({5},{4})')).toEqual({ error: '#N/A' });
});

it('keeps one degree of freedom for a pair, whether in a row or a column', () => {
  // statistic 1/4 + 1/7; p = Q(1/2, statistic/2) = 0.53080137669757828549
  expect(calc('CHISQ.TEST({5,6},{4,7})')).toBeCloseTo(0.53080137669757828549, 14);
  expect(calc('CHISQ.TEST({5;6},{4;7})')).toBeCloseTo(0.53080137669757828549, 14);
  expect(calc('CHISQ.TEST({58,35;11,25;10,23},{45.35,47.65;17.56,18.44;16.09,16.91})')).toBeCloseTo(0.000308, 6);
});
