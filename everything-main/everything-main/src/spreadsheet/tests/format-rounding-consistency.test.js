import { afterEach, describe, it, expect } from 'vitest';
import { formatValue, formatTime, parseInput, formatNumberText, editText, setLocale } from '../src/core/format.js';
import { formatWithCode } from '../src/core/numfmt.js';

afterEach(() => setLocale('en-US'));

describe('the named Scientific format', () => {
  // toExponential rounds the exact binary value; every other format rounds
  // on 15 significant decimal digits, so 1.005 read 1.00E+00 next to 1.01.
  it('rounds like the Number format and the custom codes', () => {
    expect(formatValue(1.005, { fmt: 'scientific', dec: 2 })).toBe('1.01E+00');
    expect(formatValue(9.995, { fmt: 'scientific', dec: 2 })).toBe('1.00E+01');
    expect(formatValue(2.675, { fmt: 'scientific', dec: 2 })).toBe('2.68E+00');
    expect(formatValue(123456, { fmt: 'scientific', dec: 3 })).toBe('1.235E+05');
    expect(formatValue(0.00001234, { fmt: 'scientific', dec: 2 })).toBe('1.23E-05');
    expect(formatValue(-1500, { fmt: 'scientific', dec: 1 })).toBe('-1.5E+03');
    expect(formatValue(0, { fmt: 'scientific', dec: 2 })).toBe('0.00E+00');
  });
});

describe('the named Time format without seconds', () => {
  it('hides seconds after clock rounding, as a custom h:mm code does', () => {
    const t = 0.5006828703703704; // 12:00:59.4
    expect(formatTime(t)).toBe('12:00');
    expect(formatTime(t)).toBe(formatWithCode(t, 'hh:mm'));
    expect(formatTime(0.999)).toBe('23:58');
    expect(formatTime(0.99999)).toBe('23:59'); // hidden seconds do not round to a minute
    expect(formatTime(t, true)).toBe('12:00:59');
  });
});

describe('typed numbers with a trailing decimal mark', () => {
  it('reads "5." and "1,234." as numbers, and a bare mark as text', () => {
    expect(parseInput('5.').v).toBe(5);
    expect(parseInput('1,234.').v).toBe(1234);
    expect(parseInput('-7.').v).toBe(-7);
    expect(parseInput('.').v).toBe('.');
    setLocale('de-DE');
    expect(parseInput('5,').v).toBe(5);
    expect(parseInput(',').v).toBe(',');
  });
});

describe('editing the very largest numbers', () => {
  it('shows a finite exponent form instead of Infinity', () => {
    const huge = 1.7976931348623157e308;
    expect(editText({v:huge})).toBe('1.7976931348623157E+308'); // editing can read the value back exactly
    expect(formatNumberText(huge)).toBe('1.7976931348623E+308'); // native formula text has a finite 20-character field
    expect(parseInput(editText({ v: huge })).v / 1e308).toBeCloseTo(huge / 1e308, 10);
    expect(formatNumberText(1e21)).toBe('1E+21');
    expect(formatNumberText(123.456)).toBe('123.456');
  });
});
