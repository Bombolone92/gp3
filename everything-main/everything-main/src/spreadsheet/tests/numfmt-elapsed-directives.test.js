import { expect, it } from 'vitest';
import { formatCodeError, formatWithCode, isValidFormatCode } from '../src/core/numfmt.js';
import { calc } from './helpers/calc.js';

// TEXT rejects these combinations. A duration has one
// elapsed field; repeated ordinary clock fields are not extra elapsed fields.
it.each([
  '[h] AM/PM', '[m] AM/PM', '[s] AM/PM', '[h]:mm A/P', '[m]:ss a/p',
  '[h]:[m]:[s]', '[h]:[h]', '[mm]:[ss]',
])('rejects incompatible elapsed directives in %s', code => {
  expect(isValidFormatCode(code)).toBe(false);
  expect(formatCodeError(code)).toMatch(/elapsed-time/);
  for (const value of [0, 1.5, 45000.5, 2958466]) {
    expect(formatWithCode(value, code)).toBe('#####');
    expect(calc(`TEXT(${value},"${code}")`)).toEqual({error:'#VALUE!'});
  }
});

it.each([
  ['[h]:mm:ss', '36:00:00'], ['[mm]:ss', '2160:00'], ['[sss]', '129600'],
  ['[h] "AM/PM"', '36 AM/PM'], ['[h] "[m]"', '36 [m]'],
  ['[h] \\[\\m\\]', '36 [m]'], ['[Red][h] "hours"', '36 hours'],
])('accepts the elapsed field and literals in %s', (code, display) => {
  expect(formatCodeError(code)).toBeNull();
  expect(formatWithCode(1.5, code)).toBe(display);
});

it('validates every section, including unused sections and nonnumeric TEXT inputs', () => {
  expect(formatCodeError('[h]:mm;[m]:ss;[s]')).toBeNull();
  for (const code of ['[h]:mm;[h] AM/PM', '0;[h]:[m]', '[h] AM/PM;0', '0;[h] AM/PM;0;@']) {
    expect(isValidFormatCode(code)).toBe(false);
    for (const value of [1.5, -1.5, 0, 'label', true]) {
      expect(formatWithCode(value, code)).toBe('#####');
      const input = typeof value === 'string' ? '"label"' : String(value).toUpperCase();
      expect(calc(`TEXT(${input},"${code}")`)).toEqual({error:'#VALUE!'});
    }
  }
  expect(calc('TEXT(TRUE,"[h]:mm")')).toBe('TRUE');
  expect(calc('TEXT("label","[h]:mm;[m]:ss;[s];@")')).toBe('label');
});
