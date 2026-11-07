import { expect, it } from 'vitest';
import { compareSpreadsheetText } from '../src/core/formula/text-comparison.js';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import { calcValues } from './helpers/calc.js';
import oracle from './fixtures/reference-text-prefix-compatibility.json';

it.each(oracle.cases)('preserves native canonical versus compatibility prefixes: $a / $b', ({ a, b, expected, exact, countA, countB }) => {
  expect(Math.sign(compareSpreadsheetText(a, b))).toBe(expected);
  expect(Math.sign(compareSpreadsheetText(b, a)) || 0).toBe(-expected || 0);
  const cells = { A1: a, B1: b };
  expect(calcValues('A1=B1', cells)).toBe(expected === 0);
  expect(calcValues('A1<B1', cells)).toBe(expected < 0);
  expect(calcValues('A1>B1', cells)).toBe(expected > 0);
  expect(calcValues('EXACT(A1,B1)', cells)).toBe(exact);
  const range = { range: true, values: [[a, b]] };
  for (let pass = 0; pass < 3; pass++) {
    expect(FUNCTIONS.COUNTIF.fn([range, a])).toBe(countA);
    expect(FUNCTIONS.COUNTIF.fn([range, b])).toBe(countB);
  }
});

it('does not merge spacing forms in index entries or cached query keys', () => {
  // A spacing compatibility form collates with the ordinary space, but only
  // the latter is a canonical prefix of the final cell. Changing query order
  // must not reuse the other form's matches, nor merge their source groups.
  for (const keys of [['x ', 'x\u00a0'], ['x\u00a0', 'x ']]) {
    const range = { range: true, values: [['x '], ['x\u00a0'], ['x \u200b']] };
    for (let pass = 0; pass < 3; pass++) for (const key of keys) {
      expect(FUNCTIONS.COUNTIF.fn([range, key])).toBe(key === 'x ' ? 2 : 3);
    }
    expect(FUNCTIONS.COUNTIF.fn([range, 'x \u200b'])).toBe(2);
  }
});
