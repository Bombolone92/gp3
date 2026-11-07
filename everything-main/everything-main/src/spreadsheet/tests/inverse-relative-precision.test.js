import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-inverse-relative-precision.json';

const relative = (actual, expected) => expect(Math.abs(actual / expected - 1)).toBeLessThan(1e-11);

it.each(native.cases)('retains relative precision for tiny quantiles: $expression', ({ expression, expected }) => {
  relative(calc(expression), expected);
});

it('agrees with closed forms and limiting identities below the old absolute interval cutoff', () => {
  const p = 3e-151;
  relative(calc('BETA.INV(3e-151,0.5,1)'), p * p);
  relative(calc('F.INV(3e-151,1,1)'), Math.tan(Math.PI * p / 2) ** 2);
  // At this scale erfinv(p) = sqrt(pi)*p/2 to binary64 precision.
  relative(calc('CHISQ.INV(3e-151,1)'), Math.PI * p * p / 2);
  relative(calc('GAMMA.INV(3e-151,0.5,1)'), Math.PI * p * p / 4);
  relative(calc('BETA.INV(3e-76,0.25,1)'), (3e-76) ** 4);
  relative(calc('BETA.INV(1e-306,1,1)'), 1e-306);
});

it('keeps resolving a changing quantile instead of returning a fixed search plateau', () => {
  for (const fn of ['BETA.INV(P,0.5,2)', 'F.INV(P,1,1)', 'CHISQ.INV(P,1)', 'GAMMA.INV(P,0.5,1)']) {
    const larger = calc(fn.replace('P', '1e-151')), smaller = calc(fn.replace('P', '1e-153'));
    relative(larger / smaller, 10000);
  }
});
