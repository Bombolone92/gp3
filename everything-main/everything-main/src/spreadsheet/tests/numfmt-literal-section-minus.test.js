import { expect, it } from 'vitest';
import { formatWithCode, codeColor } from '../src/core/numfmt.js';
import { formatValue } from '../src/core/format.js';

// A single-section code made only of literal text dropped the automatic minus for a negative number, so "abc"
// showed abc for -5 where the app's own General"x" showed -5x. The minus is prefixed to a one-section text
// format, which is why the "Yes";"Yes";"Yes" idiom exists to show a word for every sign.
it.each([
  [-5, '"abc"', '-abc'],
  [-5, '"n/a"', '-n/a'],
  [-5, '_("abc"_)', '- abc '],
  [-0.5, '"rate"%', '-rate%'],
  [-5, '[Red]"abc"', '-abc'],
  [-5, '""', '-'],
  [5, '"abc"', 'abc'],
  [0, '"abc"', 'abc'],
  [0.5, '"rate"%', 'rate%'],
  [-5, 'General"x"', '-5x'],
])('shows %s under the literal-only code %s as %s', (value, code, expected) => {
  expect(formatWithCode(value, code)).toBe(expected);
  expect(formatValue(value, { fmt: 'custom', code })).toBe(expected);
});

it('leaves codes with a negative section of their own, and hidden codes, to supply the sign', () => {
  expect(formatWithCode(-5, '"Yes";"No"')).toBe('No');
  expect(formatWithCode(-5, '"Yes";"Yes";"Yes"')).toBe('Yes');
  expect(formatWithCode(-5, '"Yes";-"Yes"')).toBe('-Yes');
  expect(formatWithCode(-5, ';;;')).toBe('');
  expect(formatWithCode(-5, '"hidden";;')).toBe('');
  expect(formatWithCode(-5, '[<0]"neg";"pos"')).toBe('neg'); // a section restricted to negatives supplies its own sign
  expect(formatWithCode(5, '[<0]"neg";"pos"')).toBe('pos');
  expect(codeColor(-5, '[Red]"abc"')).toBe('#ff0000');
});
