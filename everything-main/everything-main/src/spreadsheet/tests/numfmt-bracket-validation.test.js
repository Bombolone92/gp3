import { expect, it } from 'vitest';
import { codeColor, codeDateKind, codeIsFraction, codeScalesPercent, formatCodeError, formatWithCode } from '../src/core/numfmt.js';
import { calcValues } from './helpers/calc.js';

const text = (value, code) => calcValues('TEXT(A1,B1)', {A1:value,B1:code});
// A bad bracket invalidates the entire code, including unused sections, text
// and Boolean arguments. Brackets cannot silently turn into literal labels.
it.each([
  '[x]0', '[xy]0', '[xyz]0', '[unknown]0', '[]0', '[ ]0', '[1]0',
  '0[x]', 'General[x]', '0;[x]0', '0;0;0;[x]@', '[s] hh [x]',
  '[NatNum1]0', '[~buddhist]0', '[ENG]0', '[HIJ]0',
  '[Color0]0', '[Color57]0', '[Color+3]0', '[ Color3]0',
  '[DBNum0]0', '[DBNum5]0', '[DBNum 1]0', '[DBNum01]0',
  '[Red][Blue]0', '[Red][Red]0', '[DBNum1]0[DBNum2]',
  '[$-409][$-407]0', '[$a]0[$b]', '[>1][<3]0',
  '0;0;[>2]0', '0;0;0;[>2]@', '[!=2]0', '[>2e]0',
  '0[x', '[Red', '[$-409', '[>2', '[h', '0[[x]]',
])('rejects invalid directive syntax in %s', code => {
  expect(formatCodeError(code)).toBeTruthy();
  for (const value of [2.75, -2.75, 0, 'label', true]) {
    expect(formatWithCode(value, code)).toBe('#####');
    expect(formatWithCode(value, code, { overflow: null })).toBeNull();
    expect(text(value, code)).toEqual({ error: '#VALUE!' });
  }
});

it.each([
  ['[Redx]0', '3'], ['[Color3.9]0', '3'], ['[Color 03]0', '3'],
  ['[Color\t56]0', '3'], ['[DBNum10]0', '3'], ['[DBNum4suffix]0', '3'],
  ['[$]0', '3'], ['[$-xyz]0', '3'], ['[$$-bad]0', '$3'],
  ['"[x]"0', '[x]3'], ['\\[x\\]0', '[x]3'], ['_[x0', ' x3'],
  ['*[x0', 'x3'], ['0]', '3]'], ['[Red]0;[Blue]0', '3'],
])('retains native directive prefixes and bracket literals in %s', (code, expected) => {
  expect(formatCodeError(code)).toBeNull();
  expect(formatWithCode(2.75, code)).toBe(expected);
  expect(text(2.75, code)).toBe(expected);
});

it.each([
  [2.75, '[>2.5junk]0;"other"', '3'], [-2.75, '[>2abc]0;"other"', '-other'],
  [-2.75, '[>abc]0;"other"', 'other'], [-2.75, '[>=0]0;"other"', 'other'],
  [-2.75, '[>0]0', '2.75'], [-2.75, '[>0]0;0.0%', '275.0%'],
  [-2.75, '[<]0;"other"', '3'], [-2.75, '[<=]0;"other"', '-3'],
  [0, '[==2]0;"other"', '0'], [0, '[=>2]0;"other"', '0'],
  [1, '[=1.0000000000000002]"same";"other"', 'same'],
  [1.0000000000000002, '[=1.0000000000000002]"same";"other"', 'other'],
  [1.23456789012345, '[=1.234567890123456]"same";"other"', 'same'],
  [1.23456789012346, '[=1.234567890123456]"same";"other"', 'other'],
  [1234567890123450, '[=1234567890123456]"same";"other"', 'same'],
  [9.99999999999999e307, '[=9.99999999999999e307]"same";"other"', 'same'],
  [0, '[=1e-309]"same";"other"', 'same'],
  [0, '[=2.2250738585072014e-308]"same";"other"', 'same'],
  [2.22507385850721e-308, '[=2.22507385850721e-308]"same";"other"', 'same'],
  [0, '[=0.0e309]"same";"other"', 'same'],
])('uses native condition parsing for %s with %s', (value, code, expected) => {
  expect(formatCodeError(code)).toBeNull();
  expect(formatWithCode(value, code)).toBe(expected);
  expect(text(value, code)).toBe(expected);
});

it.each(['1e308', '100e306', '1e-310', '0.01e-308', '0e309', '0e-309', '0.0e-308', '0.000e312', '1e99999999999999999999'])('rejects an out-of-range normalized condition exponent in %s', number => {
  const code = `[=${number}]0;0`;
  expect(formatCodeError(code)).toBeTruthy();
  expect(text(0, code)).toEqual({ error: '#VALUE!' });
});

it('uses parsed directives for color and does not infer semantics from invalid codes', () => {
  expect(codeColor(1, '[Redx]0')).toBe(codeColor(1, '[Red]0'));
  expect(codeColor(1, '[Color 03]0')).toBe(codeColor(1, '[Red]0'));
  expect(codeColor(1, '[Color3.9]0')).toBe(codeColor(1, '[Red]0'));
  expect(codeColor(-2, '[>abc][Red]0;[Blue]0')).toBe(codeColor(1, '[Blue]0'));
  expect(codeColor(1, '[Red][x]0')).toBeNull();
  expect(codeDateKind(1, '[x]h')).toBeNull();
  expect(codeIsFraction(1, '[x]?/?')).toBe(false);
  expect(codeScalesPercent(1, '[x]0%')).toBe(false);
});
