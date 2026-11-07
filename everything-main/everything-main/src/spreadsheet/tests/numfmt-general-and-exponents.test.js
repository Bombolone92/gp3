import { describe, it, expect } from 'vitest';
import { formatWithCode, codeColor } from '../src/core/numfmt.js';

describe('scientific codes at a rounding boundary', () => {
  // The carry into the next power of ten used plain rounding while the digits
  // used the 15-significant-digit rule, so 9.995 printed as 10.00E+00.
  it.each([
    [9.995, '0.00E+00', '1.00E+01'],
    [99950, '0.00E+00', '1.00E+05'],
    [0.09995, '0.00E+00', '1.00E-01'],
    [-9.995, '0.00E+00', '-1.00E+01'],
    [9.994, '0.00E+00', '9.99E+00'],
    [1.005, '0.00E+00', '1.01E+00'],
  ])('%s with %s → %s', (value, code, expected) => {
    expect(formatWithCode(value, code)).toBe(expected);
  });
});

describe('long decimal codes', () => {
  it('pads zeros past 15 significant digits instead of printing binary noise', () => {
    expect(formatWithCode(0.3, `0.${'0'.repeat(17)}`)).toBe('0.30000000000000000');
    expect(formatWithCode(0.1, '0.000000000000000000')).toBe('0.100000000000000000');
    expect(formatWithCode(-2.5, '0.0000000000000000')).toBe('-2.5000000000000000');
    expect(formatWithCode(123456789.123456789, '0.0000000000')).toBe('123456789.1234570000');
    expect(formatWithCode(1234.5678, '0.00')).toBe('1234.57');
  });
});

describe('engineering notation', () => {
  // Integer placeholders before the point set the exponent step,
  // as the built-in ##0.0E+0 does; 0 placeholders also pad the mantissa.
  it.each([
    [12345, '##0.0E+0', '12.3E+3'],
    [1, '##0.0E+0', '1.0E+0'],
    [1234, '##0.0E+0', '1.2E+3'],
    [0.001234, '##0.0E+0', '1.2E-3'],
    [999950, '##0.0E+0', '1.0E+6'],
    [123456, '##0.0E+0', '123.5E+3'],
    [12345, '000.0E+0', '012.3E+3'],
    [12345, '0.00E+00', '1.23E+04'],
  ])('%s with %s → %s', (value, code, expected) => {
    expect(formatWithCode(value, code)).toBe(expected);
  });
});

describe('sections made only of directives', () => {
  it('shows the number the General way in the section colour', () => {
    expect(formatWithCode(5, '[Blue]')).toBe('5');
    expect(codeColor(5, '[Blue]')).toBe('#0000ff');
    expect(formatWithCode(-5, '[Blue];[Red]')).toBe('5');
    expect(codeColor(-5, '[Blue];[Red]')).toBe('#ff0000');
    expect(formatWithCode(0, '[Blue];[Red];[Green]')).toBe('0');
    expect(formatWithCode(-5, '0;[Red]')).toBe('5');
    expect(formatWithCode(150, '[>=100][Green];[Red]')).toBe('150');
    expect(formatWithCode(2, '[>=100][Green];[Red]')).toBe('2');
    // A truly empty section still hides the number.
    expect(formatWithCode(0, '0;-0;')).toBe('');
    expect(formatWithCode(-5, '0;')).toBe('');
  });
});

describe('General among literals', () => {
  it('prints the number the General way in place of the keyword', () => {
    expect(formatWithCode(5, 'General" units"')).toBe('5 units');
    expect(formatWithCode(1234.5, '"Total: "General')).toBe('Total: 1234.5');
    expect(formatWithCode(-5, 'General;-General')).toBe('-5');
    expect(formatWithCode(-5, 'General;(General)')).toBe('(5)');
    // A single section takes the automatic minus in front of its literals, as digit placeholders do.
    expect(formatWithCode(-5, 'General" units"')).toBe('-5 units');
    expect(formatWithCode(-5, '"$"General')).toBe('-$5');
    expect(formatWithCode(-5.5, '"Total: "General')).toBe('-Total: 5.5');
    expect(formatWithCode(-5, '[Red]General" units"')).toBe('-5 units');
    expect(formatWithCode(5, '"Total: "General')).toBe('Total: 5');
    expect(formatWithCode(5, '"General"')).toBe('General'); // quoted text stays text
    expect(formatWithCode(7, 'General')).toBe('7');
  });
});
