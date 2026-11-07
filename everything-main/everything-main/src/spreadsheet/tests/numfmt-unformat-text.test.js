import { expect, it } from 'vitest';
import { formatWithCode, unformatTextWithCode } from '../src/core/numfmt.js';

it.each(['@', '0;0;0;"prefix "@', '0;0;0;@" suffix"', '0;0;0;_W@*.',
  '0;0;0;"["@"] "@', '0;0;0;"@"\\@@', '0;0;0;[Blue]General"!"',
  '0.00', '0;0;0;[Red]', '0;0;0;@";"@'])('recovers the unique text from %s', code => {
  for (const value of ['sample', '00123', '=A1', 'a\tb\nc\r\nd', '  spaces  ', '🧵مرحبا', '']) {
    const display = formatWithCode(value, code);
    expect(unformatTextWithCode(display, code), JSON.stringify({value,code})).toBe(value);
  }
});

it.each([
  ['wrong label', '0;0;0;"prefix "@'], ['label wrong', '0;0;0;@" suffix"'],
  ['abac', '0;0;0;@@'], ['abc', '0;0;0;@@'], ['short', '0;0;0;"too long"@'],
  ['anything', '0;0;0;"fixed"'], ['', ';;;'], ['x', '[invalid]@'],
])('does not invent a value for %j with %s', (text, code) => {
  expect(unformatTextWithCode(text, code)).toBeUndefined();
});

it('handles many repeated placeholders without ambiguous matching or recursive searches', () => {
  const code = '0;0;0;' + '@"/"'.repeat(200), value = 'a/b';
  expect(unformatTextWithCode(formatWithCode(value, code), code)).toBe(value);
  expect(unformatTextWithCode(formatWithCode(value, code).slice(1), code)).toBeUndefined();
});
