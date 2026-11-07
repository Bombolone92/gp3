import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// The Bessel functions came from rational approximations good to some seven digits, so
// BESSELJ(0,0) was 1.0000000028 and every value carried 1E-8 to 5E-7 of error. They now
// come from the power series, Miller's normalised recurrence, an integral and the asymptotic
// expansions, each to rounding. The references here are the power series summed in the test
// where they converge without losing digits (x up to about 5), tabulated values, and the
// Wronskian identities J₁Y₀ - J₀Y₁ = 2/(πx) and I₀K₁ + I₁K₀ = 1/x everywhere else.
const EULER = 0.5772156649015329;
const E = (code) => ({ error: code });
const relative = (formula, expected, bound = 1e-12) => {
  const v = calc(formula);
  expect(typeof v).toBe('number');
  expect(Math.abs(v / expected - 1)).toBeLessThan(bound);
};

// J_n(x) = Σ (-1)^k (x/2)^(2k+n) / (k! (n+k)!) and I_n(x) the same with every sign positive.
function series(n, x, sign) {
  const h = x / 2;
  let term = 1;
  for (let j = 1; j <= n; j++) term *= h / j;
  let sum = term;
  for (let k = 1; k < 500 && term !== 0; k++) {
    term *= (sign * h * h) / (k * (n + k));
    sum += term;
  }
  return sum;
}
// Y₀, Y₁ (Abramowitz & Stegun 9.1.13, 9.1.11) and K₀, K₁ (9.6.13, 9.6.11), with ψ(k+1) = H_k - γ.
function logSeries(x, sign) {
  const h = x / 2;
  const L = Math.log(h) + EULER;
  let f0 = 0; // Σ (±h²)^k / (k!)²: J₀ or I₀
  let f1 = 0; // Σ (±h²)^k / (k! (k+1)!): J₁ / h or I₁ / h
  let g0 = 0; // Σ H_k (±h²)^k / (k!)²
  let g1 = 0; // Σ (H_k + H_k+1) (±h²)^k / (k! (k+1)!)
  let t0 = 1;
  let t1 = 1;
  let H = 0;
  for (let k = 0; k < 60; k++) {
    if (k) { t0 *= (sign * h * h) / (k * k); t1 *= (sign * h * h) / (k * (k + 1)); H += 1 / k; }
    f0 += t0; f1 += t1; g0 += H * t0; g1 += (2 * H + 1 / (k + 1)) * t1;
  }
  if (sign < 0) return { y0: (2 / Math.PI) * (L * f0 - g0), y1: -2 / (Math.PI * x) + (2 / Math.PI) * L * h * f1 - (h / Math.PI) * g1 };
  return { k0: -L * f0 + g0, k1: 1 / x + L * h * f1 - (h / 2) * g1 };
}

describe('BESSELJ', () => {
  it('is exactly 1 at the origin for order 0, and 0 for the other orders', () => {
    expect(calc('BESSELJ(0,0)')).toBe(1);
    expect(calc('BESSELJ(0,0)=1')).toBe(true);
    expect(calc('BESSELJ(0,1)')).toBe(0);
    expect(calc('BESSELJ(0,7)')).toBe(0);
  });

  it('matches its power series', () => {
    relative('BESSELJ(1.9,2)', series(2, 1.9, -1));
    relative('BESSELJ(1,0)', series(0, 1, -1));
    relative('BESSELJ(1,1)', series(1, 1, -1));
    relative('BESSELJ(5,0)', series(0, 5, -1));
    relative('BESSELJ(5,3)', series(3, 5, -1));
    relative('BESSELJ(2.5,7)', series(7, 2.5, -1));
    relative('BESSELJ(0.001,2)', series(2, 0.001, -1));
    relative('BESSELJ(10,20)', series(20, 10, -1));
    relative('BESSELJ(-5,1)', -series(1, 5, -1)); // odd orders are odd functions
    relative('BESSELJ(-5,2)', series(2, 5, -1));
  });

  it('matches tabulated values and the documented example', () => {
    relative('BESSELJ(1,0)', 0.7651976865579666, 1e-13);
    relative('BESSELJ(1,1)', 0.44005058574493355, 1e-13);
    relative('BESSELJ(10,0)', -0.2459357644513483, 1e-13);
    relative('BESSELJ(100,0)', 0.019985850304223122, 1e-13);
    expect(calc('BESSELJ(1.9,2)')).toBeCloseTo(0.329926, 6);
  });

  it('keeps the recurrence J(n-1) + J(n+1) = (2n/x) J(n) across its methods', () => {
    for (const [n, x] of [[3, 2.5], [10, 10], [50, 30], [400, 500], [7, 1e5], [100, 1e5], [2000, 12000]]) {
      relative(`BESSELJ(${x},${n - 1})+BESSELJ(${x},${n + 1})`, ((2 * n) / x) * calc(`BESSELJ(${x},${n})`));
    }
  });
});

describe('BESSELY', () => {
  it('matches its power series', () => {
    relative('BESSELY(1,0)', logSeries(1, -1).y0);
    relative('BESSELY(1,1)', logSeries(1, -1).y1);
    relative('BESSELY(0.1,0)', logSeries(0.1, -1).y0);
    relative('BESSELY(0.1,1)', logSeries(0.1, -1).y1);
    relative('BESSELY(3,0)', logSeries(3, -1).y0);
    relative('BESSELY(3,1)', logSeries(3, -1).y1);
    relative('BESSELY(0.00001,0)', logSeries(0.00001, -1).y0);
    relative('BESSELY(0.00001,1)', logSeries(0.00001, -1).y1);
    relative('BESSELY(2,2)', (2 / 2) * logSeries(2, -1).y1 - logSeries(2, -1).y0); // Y₂ = (2/x) Y₁ - Y₀
  });

  it('matches tabulated values and the documented example', () => {
    relative('BESSELY(1,0)', 0.08825696421567696, 1e-13);
    relative('BESSELY(1,1)', -0.7812128213002887, 1e-13);
    relative('BESSELY(10,0)', 0.05567116728359939, 1e-13);
    expect(calc('BESSELY(2.5,1)')).toBeCloseTo(0.145918, 6);
  });

  it('satisfies J₁Y₀ - J₀Y₁ = 2/(πx) at every size of argument', () => {
    for (const x of [0.5, 3, 7.9, 8.1, 25, 100, 999, 10000, 10001, 12345.6, 100000, 1e7]) {
      relative(`BESSELJ(${x},1)*BESSELY(${x},0)-BESSELJ(${x},0)*BESSELY(${x},1)`, 2 / (Math.PI * x));
    }
  });
});

describe('BESSELI', () => {
  it('is exactly 1 at the origin for order 0, and 0 for the other orders', () => {
    expect(calc('BESSELI(0,0)')).toBe(1);
    expect(calc('BESSELI(0,3)')).toBe(0);
  });

  it('matches its power series', () => {
    relative('BESSELI(100,0)', series(0, 100, 1));
    relative('BESSELI(1,0)', series(0, 1, 1));
    relative('BESSELI(1,1)', series(1, 1, 1));
    relative('BESSELI(2,3)', series(3, 2, 1));
    relative('BESSELI(10,0)', series(0, 10, 1));
    relative('BESSELI(50,5)', series(5, 50, 1));
    relative('BESSELI(700,0)', series(0, 700, 1));
    relative('BESSELI(-3,1)', -series(1, 3, 1));
    relative('BESSELI(-3,2)', series(2, 3, 1));
  });

  it('matches tabulated values and the documented example', () => {
    relative('BESSELI(1,0)', 1.2660658777520084, 1e-13);
    relative('BESSELI(1,1)', 0.5651591039924851, 1e-13);
    relative('BESSELI(10,0)', 2815.716628466254, 1e-13);
    expect(calc('BESSELI(1.5,1)')).toBeCloseTo(0.981666, 6);
    expect(calc('BESSELI(2,3)')).toBeCloseTo(0.21274, 5);
  });

  it('reaches the edge of the doubles and reports #NUM! past it', () => {
    relative('BESSELI(1000,2000)', Math.exp(Math.sqrt(1000 ** 2 + 2000 ** 2) - 2000 * Math.asinh(2)) / Math.sqrt(2 * Math.PI * Math.sqrt(1000 ** 2 + 2000 ** 2)), 1e-3); // Debye's leading term, at e^-650
    // I₀(710) ≈ 3.3E+306 is still a double: e^x / √(2πx) times the asymptotic series 1 + 1/8x + 9/2!(8x)² + 225/3!(8x)³ + …
    const x = 710;
    let asymptotic = 0;
    for (let k = 0, term = 1; k < 6; k++) { asymptotic += term; term *= ((2 * k + 1) ** 2) / (8 * (k + 1) * x); }
    relative('BESSELI(710,0)', Math.exp(x - 0.5 * Math.log(2 * Math.PI * x)) * asymptotic, 1e-12);
    expect(calc('BESSELI(720,0)')).toEqual(E('#NUM!'));
    expect(calc('BESSELI(1000000,300)')).toEqual(E('#NUM!'));
  });
});

describe('BESSELK', () => {
  it('matches its power series', () => {
    relative('BESSELK(1,0)', logSeries(1, 1).k0);
    relative('BESSELK(1,1)', logSeries(1, 1).k1);
    relative('BESSELK(2,0)', logSeries(2, 1).k0);
    relative('BESSELK(2,1)', logSeries(2, 1).k1);
    relative('BESSELK(0.01,0)', logSeries(0.01, 1).k0);
    relative('BESSELK(0.01,1)', logSeries(0.01, 1).k1);
    relative('BESSELK(0.00000001,0)', logSeries(1e-8, 1).k0);
    relative('BESSELK(1,2)', logSeries(1, 1).k0 + 2 * logSeries(1, 1).k1); // K₂ = K₀ + (2/x) K₁
  });

  it('matches tabulated values and the documented example', () => {
    relative('BESSELK(1,0)', 0.42102443824070834, 1e-13);
    relative('BESSELK(1,1)', 0.6019072301972346, 1e-13);
    relative('BESSELK(10,0)', 1.778006231616765e-5, 1e-13);
    relative('BESSELK(10,1)', 1.8648773453825585e-5, 1e-13);
    expect(calc('BESSELK(1.5,1)')).toBeCloseTo(0.277388, 6);
  });

  it('satisfies I₀K₁ + I₁K₀ = 1/x at every size of argument', () => {
    for (const x of [0.001, 0.5, 2, 5, 15, 19.99, 20, 25, 100, 500]) {
      relative(`BESSELI(${x},0)*BESSELK(${x},1)+BESSELI(${x},1)*BESSELK(${x},0)`, 1 / x);
    }
  });
});

describe('Bessel functions at extreme orders and arguments', () => {
  it('answer in milliseconds, with #NUM! where the value leaves the doubles', () => {
    const t0 = performance.now();
    expect(calc('BESSELJ(1000000,1000000)')).toBeCloseTo(0.004473073183378, 12);
    expect(calc('BESSELJ(1000000,999999)')).toBeCloseTo(0.00451415730840337, 12);
    expect(calc('BESSELY(1000000,1000000)')).toBeCloseTo(-0.0077475900215254, 12);
    expect(calc('BESSELJ(1,1000000)')).toBe(0);
    expect(calc('BESSELK(1,1000000)')).toEqual(E('#NUM!'));
    expect(calc('BESSELY(0.1,1000000)')).toEqual(E('#NUM!'));
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
