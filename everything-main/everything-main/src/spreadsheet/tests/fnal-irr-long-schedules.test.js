import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// A loan of 100000 repaid in n level payments of PMT(r,n,-100000) has, by the
// definition of PMT, a net present value of zero at rate r, so IRR over the
// schedule -100000, PMT, PMT, ... must return r. With the default guess of 0.1,
// Newton's first step on a long schedule lands below -1 and the bisection
// fallback started at a rate whose discount factors overflow, giving #NUM!.
describe('IRR over long level-payment schedules', () => {
  it.each([60, 120, 180, 360])('recovers the monthly rate from %i payments with the default guess', (n) => {
    expect(calc(`IRR(HSTACK(-100000,SEQUENCE(1,${n},PMT(0.005,${n},-100000),0)))`)).toBeCloseTo(0.005, 10);
  });

  it('recovers a rate of 0.5% from a 30-year mortgage payment written to the cent', () => {
    // PMT(0.005,360,-100000) is 599.5505..., so 599.55 gives a rate a hair under 0.5%.
    expect(calc('IRR(HSTACK(-100000,SEQUENCE(1,360,599.55,0)))')).toBeCloseTo(0.005, 6);
    expect(calc('IRR(HSTACK(-100000,SEQUENCE(1,360,599.55,0)),0.01)')).toBeCloseTo(0.005, 6);
  });

  it('finds a strongly negative rate, and still reports #NUM! when no rate balances the flows', () => {
    // 10 / (1 + r) = 100 exactly when r = -0.9.
    expect(calc('IRR({-100,10})')).toBeCloseTo(-0.9, 10);
    expect(calc('IRR({-1000,300,400,500})')).toBeCloseTo(0.08896, 4);
    expect(calc('IRR({300,400,500})')).toEqual(E('#NUM!'));
  });
});
