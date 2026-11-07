import { expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

it('treats numbers that agree to 15 significant digits as equal', () => {
  expect(calc('0.1+0.2=0.3')).toBe(true);
  expect(calc('1-0.9=0.1')).toBe(true);
  expect(calc('0.1+0.2<>0.3')).toBe(false);
  expect(calc('0.1+0.2>0.3')).toBe(false);
  expect(calc('0.1+0.2>=0.3')).toBe(true);
  expect(calc('0.1+0.2<=0.3')).toBe(true);
  const cents = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`A${i + 1}`, '0.1']));
  expect(calc('SUM(A1:A10)=1', cents)).toBe(true);
  expect(calc('IF(SUM(A1:A10)=1,"ok","mismatch")', cents)).toBe('ok');
});

it('still tells genuinely different numbers apart', () => {
  expect(calc('1=1.0000001')).toBe(false);
  expect(calc('1<1.0000001')).toBe(true);
  expect(calc('1E-300=2E-300')).toBe(false);
  expect(calc('0=EXP(-736)')).toBe(false);
  expect(calc('-0.1-0.2=-0.3')).toBe(true);
  expect(calc('INDEX(SORT({0.3;0.1;0.2}),2)')).toBe(0.2);
});
