import { describe, it, expect } from 'vitest';
import { formatWithCode, codeColor } from '../src/core/numfmt.js';
import { formatValue, numFmtToStyle, styleToNumFmt, ymdToSerial } from '../src/core/format.js';

describe('number format codes', () => {
  it('formats numbers with digits, grouping, decimals, and scaling', () => {
    expect(formatWithCode(1234.567, '#,##0.00')).toBe('1,234.57');
    expect(formatWithCode(1234.567, '0')).toBe('1235');
    expect(formatWithCode(0.5, '0.00')).toBe('0.50');
    expect(formatWithCode(0.5, '#.##')).toBe('.5');
    expect(formatWithCode(7, '000')).toBe('007');
    expect(formatWithCode(1234567, '#,##0,"K"')).toBe('1,235K');
    expect(formatWithCode(1234567, '0.0,,"M"')).toBe('1.2M');
    expect(formatWithCode(0.256, '0.0%')).toBe('25.6%');
    expect(formatWithCode(-42, '#,##0')).toBe('-42');
    expect(formatWithCode(12345.678, '0.00E+00')).toBe('1.23E+04');
    expect(formatWithCode(0.00012, '0.0E+00')).toBe('1.2E-04');
    expect(formatWithCode(2.75, '# ?/?')).toBe('2 3/4');
    expect(formatWithCode(0.333, '?/?')).toBe('1/3');
    expect(formatWithCode(5, '0 "units"')).toBe('5 units');
    expect(formatWithCode(5, '\\$0')).toBe('$5');
    expect(formatWithCode(1234, '"$"#,##0_)')).toBe('$1,234 ');
  });

  it('picks sections for positive, negative, zero, and text', () => {
    const code = '#,##0;[Red](#,##0);"-";@ "!"';
    expect(formatWithCode(1500, code)).toBe('1,500');
    expect(formatWithCode(-1500, code)).toBe('(1,500)');
    expect(formatWithCode(0, code)).toBe('-');
    expect(formatWithCode('hi', code)).toBe('hi !');
    expect(formatWithCode('hi', '0.00')).toBe('hi');
    expect(formatWithCode(-5, '0.0;-0.0')).toBe('-5.0');
    expect(formatWithCode(true, '0')).toBe('TRUE');
    expect(formatWithCode(null, '0')).toBe('');
    expect(formatWithCode(3.14159, 'General')).toBe('3.14159');
  });

  it('uses fraction section signs and literals exactly once', () => {
    expect(formatWithCode(-2.75, '# ?/?')).toBe('-2 3/4');
    expect(formatWithCode(-2.75, '# ?/?;(# ?/?)')).toBe('(2 3/4)');
    expect(formatWithCode(-0.5, '?/?;-?/?')).toBe('-1/2');
    expect(formatWithCode(2.75, '# ?/? "kg"')).toBe('2 3/4 kg');
  });

  it('formats dates and times', () => {
    const d = ymdToSerial(2024, 1, 15) + 0.5729; // 13:44:58.56
    expect(formatWithCode(d, 'yyyy-mm-dd')).toBe('2024-01-15');
    expect(formatWithCode(d, 'd mmm yyyy')).toBe('15 Jan 2024');
    expect(formatWithCode(d, 'dddd, mmmm d')).toBe('Monday, January 15');
    expect(formatWithCode(d, 'mm/dd/yy')).toBe('01/15/24');
    expect(formatWithCode(d, 'h:mm')).toBe('13:44');
    expect(formatWithCode(d, 'h:mm:ss')).toBe('13:44:59');
    expect(formatWithCode(d, 'h:mm AM/PM')).toBe('1:44 PM');
    expect(formatWithCode(d, 'hh:mm a/p')).toBe('01:44 p');
    expect(formatWithCode(d, 'hh:mm A/P')).toBe('01:44 P');
    expect(formatWithCode(1.5, '[h]:mm')).toBe('36:00');
    expect(formatWithCode(0.5, '[mm]')).toBe('720');
    expect(formatWithCode(0.99999, 'h:mm')).toBe('23:59'); // hides the rounded seconds
    expect(formatWithCode(d, 'yyyy-mm-dd hh:mm')).toBe('2024-01-15 13:44');
  });

  it('is what the custom style shows and what TEXT() uses', () => {
    expect(formatValue(1234.5, { fmt: 'custom', code: '#,##0.0 "kg"' })).toBe('1,234.5 kg');
    expect(formatValue(1234.5, { fmt: 'custom' })).toBe('1234.5');
    expect(styleToNumFmt({ fmt: 'custom', code: '0.0;(0.0)' })).toBe('0.0;(0.0)');
  });

  it('keeps unusual file codes as custom formats and maps the plain ones', () => {
    expect(numFmtToStyle('#,##0.00')).toEqual({ fmt: 'number', dec: 2, group: true });
    expect(numFmtToStyle('0%')).toEqual({ fmt: 'percent', dec: 0, group: false });
    expect(numFmtToStyle('yyyy-mm-dd')).toEqual({ fmt: 'date' });
    expect(numFmtToStyle('"$"#,##0.00')).toEqual({ fmt: 'currency', dec: 2, cur: 'USD' });
    expect(numFmtToStyle('#,##0;[Red](#,##0)')).toEqual({ fmt: 'custom', code: '#,##0;[Red](#,##0)' });
    expect(numFmtToStyle('0.0 "kg"')).toEqual({ fmt: 'custom', code: '0.0 "kg"' });
    expect(numFmtToStyle('[h]:mm')).toEqual({ fmt: 'custom', code: '[h]:mm' });
  });
});

describe('codeColor', () => {
  it.each([
    ['"[Red]"0', '[Red]5'],
    ['\\["Red]"0', '[Red]5'],
    ['_["Red]"0', ' Red]5'],
    ['*["Red]"0', 'Red]5'],
    ['"[Blue];[Red]"0', '[Blue];[Red]5'],
  ])('does not treat literal brackets in %s as a color', (code, display) => {
    expect(formatWithCode(5, code)).toBe(display);
    expect(codeColor(5, code)).toBeNull();
  });

  it('finds actual color directives after literal text', () => {
    expect(codeColor(5, '"[Blue]"[Red]0')).toBe('#ff0000');
    expect(codeColor(-5, '0;"[Blue]"[Green](0)')).toBe('#00ff00');
    expect(codeColor('hello', '0;0;0;"[Red]"@')).toBeNull();
    expect(codeColor('hello', '0;0;0;"[Red]"[Blue]@')).toBe('#0000ff');
  });

  it('returns the section color a value lands in', () => {
    expect(codeColor(-5, '#,##0;[Red](#,##0)')).toBe('#ff0000');
    expect(codeColor(5, '#,##0;[Red](#,##0)')).toBeNull();
    expect(codeColor(0, '[Blue]0;[Red]-0;[Green]0')).toBe('#00ff00');
    expect(codeColor(-1, '0.00')).toBeNull();
    expect(codeColor(null, '[Red]0')).toBeNull();
  });
});
