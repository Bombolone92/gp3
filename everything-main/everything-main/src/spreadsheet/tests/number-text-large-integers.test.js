import { expect, it } from 'vitest';
import { calc, calcValues } from './helpers/calc.js';
import { formatNumberText } from '../src/core/format.js';

// Native text conversion has a 20-character field. Literal precision is
// applied before conversion; stored values retain their own binary precision.
it.each([
  ['1E15&""', '1000000000000000'],
  ['-1E15&""', '-1000000000000000'],
  ['2^53&""', '9007199254740990'],
  ['100000000000000000000&""', '1E+20'],
  ['1234567890123456&""', '1234567890123450'],
  ['1050000000000000&""', '1050000000000000'],
  ['CONCAT(1E15)', '1000000000000000'],
  ['TEXTJOIN(",",TRUE,1E15,2)', '1000000000000000,2'],
  ['999999999999999&""', '999999999999999'],
  ['123456789012345.6&""', '123456789012345'],
  ['999999999999999.9&""', '999999999999999'],
  ['1E21&""', '1E+21'],
  ['1.5E300&""', '1.5E+300'],
  ['0.0000001&""', '0.0000001'],
])('%s reads %s', (formula, expected) => {
  expect(calc(formula)).toBe(expected);
});

it('uses text conversion independently of the cell General display format', () => {
  for (const [n,text,general] of [['1E15','1000000000000000','1E+15'],
    ['1E20','1E+20','1E+20'],['-2.5E17','-250000000000000000','-2.5E+17']]) {
    expect(calc(`${n}&""`)).toBe(text);
    expect(calc(`VALUETOTEXT(${n})`)).toBe(text);
    expect(calc(`TEXT(${n},"General")`)).toBe(general);
  }
  // Stored/computed numbers keep their binary value; only literal conversion truncates.
  for (const [value, expected] of [[1234567890123456,'1234567890123460'],
    [123456789012345.6,'123456789012346'],[999999999999999.9,'1000000000000000']]) {
    expect(calcValues('A1&""', {A1:value})).toBe(expected);
  }
  expect(formatNumberText(1e15)).toBe('1000000000000000');
  expect(formatNumberText(1.7976931348623157e308)).toBe('1.7976931348623E+308'); // three exponent digits leave fourteen significant digits
});
