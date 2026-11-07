import { expect, it } from 'vitest';
import { formatWithCode, codeDateKind } from '../src/core/numfmt.js';
import { formatValue } from '../src/core/format.js';

// General as the text section of a code printed the word "General" for a text cell: the keyword was tokenized
// as seven literal letters. General means "show the value the General way", and for text that is the text
// itself, as the single-section General and the @ placeholder already show it.
it.each([
  ['0;-0;0;General', 'abc', 'abc'],
  ['General;General;General;General', 'abc', 'abc'],
  ['0;-0;0;[Red]General', 'abc', 'abc'],
  ['0;-0;0;General" units"', 'abc', 'abc units'],
  ['0;-0;0;"Text: "General', 'abc', 'Text: abc'],
  ['0;-0;0;general', 'say "hi"', 'say "hi"'],
  ['0;-0;0;@', 'abc', 'abc'],
  ['0;-0;0;"General"', 'abc', 'General'], // quoted, the word is text
  ['General', 'abc', 'abc'],
])('shows a text cell under %s as %s', (code, text, expected) => {
  expect(formatWithCode(text, code)).toBe(expected);
  expect(formatValue(text, { fmt: 'custom', code })).toBe(expected);
});

it('keeps the numeric sections and the text section meaning what they did', () => {
  expect(formatWithCode(5, '0;-0;0;General')).toBe('5');
  expect(formatWithCode(-5, 'General;General;General;General')).toBe('5');
  expect(formatWithCode(0, 'General;General;General;General')).toBe('0');
  expect(formatWithCode(1234.5, '0;-0;0;General')).toBe('1235');
  expect(codeDateKind('abc', '0;0;0;General')).toBeNull();
  // The text section is read again for a second text, as the parsed code is cached.
  expect(formatWithCode('xyz', '0;-0;0;General" units"')).toBe('xyz units');
});
