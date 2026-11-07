import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/reference-probability-tail-arithmetic.json', import.meta.url), 'utf8'));
it.each(native.cases)('matches native probability arithmetic: $expression', ({ formula, expected }) => {
  const actual = calc(formula);
  expect(typeof actual).toBe('string');
  expect(actual).not.toBe('');
  if (typeof expected === 'string') expect(actual).toBe(expected);
  else if (expected === 0) expect(Number(actual)).toBe(0);
  else expect(Number(actual) / expected).toBeCloseTo(1, 11);
});

it('flushes the F normalization before evaluating a potentially normal tail', () => {
  expect(calc('F.DIST.RT(5e307,1,1)')).toBe(0);
  expect(calc('F.DIST(5e307,1,1,TRUE)')).toBe(1);
  expect(calc('F.DIST.RT(4e307,1,1)') / 1e-154).toBeCloseTo(1 / (Math.PI * Math.sqrt(0.1)), 12);
});

it('retains power-path subnormals but flushes general beta tails before amplification', () => {
  expect(calc('BETA.DIST(1e-154,2,1,TRUE)') / 1e-308).toBeCloseTo(1, 12);
  expect(calc('1e100*BETA.DIST(1e-154,2,0.5,TRUE)')).toBe(0);
  expect(calc('1e100*BETA.DIST(4e-308,1,0.5,TRUE)')).toBe(0);
  expect(calc('BETA.DIST(5e-308,1,0.5,TRUE)') / 1e-308).toBeCloseTo(2.5, 12);
});

it('reports direct F normalization overflow without changing its density error convention', () => {
  for (const f of ['F.DIST.RT(8e307,3,2)', 'FDIST(8e307,3,2)', 'F.DIST(8e307,3,2,TRUE)']) {
    expect(calc(f)).toEqual({ error: '#DIV/0!' });
  }
  expect(calc('F.DIST(8e307,3,2,FALSE)')).toEqual({ error: '#NUM!' });
});

it('applies tail arithmetic before doubling the F-test probability', () => {
  expect(calc('F.TEST({0,1e154},{1,2,3})')).toBe(0);
  expect(calc('FTEST({1,2,3},{0,1e154})')).toBe(0);
  expect(calc('F.TEST(SQRT(8e307)*{0,1},{1,2,3})') / 1e-308).toBeCloseTo(5, 12);
  for (const f of ['F.TEST({0,1.5e154},{0,1})', 'F.TEST({0,1},{0,1.5e154})', 'F.TEST({0,0},{-1e154,1e154})']) {
    expect(calc(f)).toEqual({ error: '#NUM!' });
  }
});
