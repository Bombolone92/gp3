import { expect, it } from 'vitest';
import { calcValues, calc } from './helpers/calc.js';
import { compareValues } from '../src/core/formula/functions.js';
import oracle from './fixtures/reference-text-comparison-unicode.json';

it.each(oracle.cases)('compares native Unicode text: $a / $b', ({ a, b, expected, exact }) => {
  expect(Math.sign(compareValues(a, b))).toBe(expected);
  expect(Math.sign(compareValues(b, a)) || 0).toBe(-expected || 0);
  const cells = { A1: a, B1: b };
  expect(calcValues('A1=B1', cells)).toBe(expected === 0);
  expect(calcValues('A1<B1', cells)).toBe(expected < 0);
  expect(calcValues('A1>B1', cells)).toBe(expected > 0);
  expect(calcValues('EXACT(A1,B1)', cells)).toBe(exact);
});

it('preserves native pairwise prefix behavior without inventing an identity key', () => {
  const a = '\u200b', b = '\ufe0f', c = '\u200b\u2060';
  expect(compareValues(a, b)).toBe(0);
  expect(compareValues(b, c)).toBe(0);
  expect(compareValues(a, c)).toBeLessThan(0);
});

it('keeps accents and iota subscripts distinct while folding letter forms', () => {
  expect(calc('"STRASSE"="Straße"')).toBe(true);
  expect(calc('"é"="e"')).toBe(false);
  expect(calc('"ᾀ"="ἀι"')).toBe(false);
  expect(calc('"ı"="I"')).toBe(false);
  expect(calc('"é"="é"')).toBe(true);
  expect(calc('SUMPRODUCT(--({"ß";"ﬁ";"é"}={"SS";"fi";"e"}))')).toBe(2);
});
