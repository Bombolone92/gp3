import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// The bisection fallback walks its low end over -1 + 2^-k, so the rates -0.5,
// -0.75, -0.9375 ... are tried exactly. Landing on the root made the balance
// there exactly zero, which the old bracket test (`flo * fhi > 0`) accepted and
// the old halving test (`fm * flo < 0`) could never satisfy, so the low end
// climbed to the high end and IRR answered 10 — a 1000% return on an investment
// that halved. Comparing signs instead keeps the root as the answer.
describe('IRR and XIRR when the rate is exactly one the bracket walk lands on', () => {
  it.each([
    ['IRR({-1000;500})', -0.5],
    ['IRR({-2000;1000})', -0.5],
    ['IRR({-1000;500;0})', -0.5],
    ['IRR({-100;25})', -0.75],
    ['IRR({-100;5;5})', -0.75],
    ['IRR({-100;6.25})', -0.9375],
    ['IRR({-100;0;25})', -0.5],
  ])('%s is %f', (formula, rate) => {
    expect(calc(formula)).toBeCloseTo(rate, 12);
  });

  it('is a rate that balances the flows, not a number with a residual', () => {
    expect(calc('NPV(IRR({-1000;500}),500)-1000')).toBeCloseTo(0, 9);
    expect(calc('NPV(IRR({-100;5;5}),5,5)-100')).toBeCloseTo(0, 9);
  });

  it('answers the same rate whatever the guess', () => {
    expect(calc('IRR({-1000;500},-0.4)')).toBeCloseTo(-0.5, 12);
    expect(calc('IRR({-1000;500},0.9)')).toBeCloseTo(-0.5, 12);
    expect(calc('IRR({-1000;500},-0.5)')).toBeCloseTo(-0.5, 12);
  });

  it('gives XIRR a whole year at the same rate', () => {
    expect(calc('XIRR({-1000;500},{45000;45365})')).toBeCloseTo(-0.5, 9);
    expect(calc('XNPV(XIRR({-1000;500},{45000;45365}),{-1000;500},{45000;45365})')).toBeCloseTo(0, 9);
  });

  // Rates the walk does not land on were always right; they must stay right.
  it('leaves the neighbouring rates and the no-rate case alone', () => {
    expect(calc('IRR({-1000;400})')).toBeCloseTo(-0.6, 9);
    expect(calc('IRR({-1000;600})')).toBeCloseTo(-0.4, 9);
    expect(calc('IRR({-100,10})')).toBeCloseTo(-0.9, 9);
    expect(calc('IRR({-1000,300,400,500})')).toBeCloseTo(0.08896339469, 9);
    expect(calc('IRR({300,400,500})')).toEqual(E('#NUM!'));
  });
});
