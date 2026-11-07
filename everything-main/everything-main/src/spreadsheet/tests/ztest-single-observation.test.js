import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

// Z.TEST is 1 - Φ((x̄ - μ) / (σ / √n)). With σ given, one observation is
// enough; only the sample standard deviation needs two.
it('takes a single observation when sigma is given', () => {
  expect(calc('Z.TEST({5},3,2)')).toBeCloseTo(0.158655253931457051, 14); // 1 - Φ(1)
  expect(calc('Z.TEST({5},3)')).toEqual({ error: '#DIV/0!' });
  expect(calc('Z.TEST(A1:A2,3)', {})).toEqual({ error: '#N/A' });
  expect(calc('Z.TEST(A1:A2,3,2)', {})).toEqual({ error: '#N/A' });
  expect(calc('ZTEST({5},3,2)')).toBeCloseTo(0.158655253931457051, 14);
});

it('keeps the upper tail where 1 - Φ(z) rounds to zero', () => {
  // mean 3, s = √2.5, n = 5: z = 13√2, so the tail is erfc(13)/2 = 8.6977865773336226e-76
  const v = calc('Z.TEST({1,2,3,4,5},-10)');
  expect(Math.abs(v / 8.6977865773336226e-76 - 1)).toBeLessThan(1e-12);
  expect(calc('Z.TEST({1,2,3,4,5},100)')).toBe(1);
  expect(calc('Z.TEST({3,6,7,8,6,5,4,2,1,9},4)')).toBeCloseTo(0.090574, 6);
});
