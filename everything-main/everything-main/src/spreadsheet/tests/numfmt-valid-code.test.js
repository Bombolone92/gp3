import { describe, expect, it } from 'vitest';
import { formatCodeError, isValidFormatCode, formatWithCode } from '../src/core/numfmt.js';

describe('format code validation', () => {
  it.each([
    '#,##0.00', '0', '0.00E+00', '##0.0E-0', ';;;', ';', '"N/A"', '"hidden";;', '[Red][>100]0;[Blue]0', '[>=1000]#,##0,"K";0',
    '[$-411]ggge"年"m"月"d"日"', '[<=43585][$-ja-JP]ggge"年"m"月"d"日";[>=43831]ggge"年"m"月"d"日";ggg"元年"m"月"d"日"',
    '[h]:mm', '[mm]:ss', 'h:mm AM/PM', 'mmss.0', 'yyyy-mm-dd;@', 'd mmmm bbbb', '# ?/?', '# ??/16', '0 "days"', '@ "units"', '@',
    'General', 'General" units"', '0.0,,"M"', '_($* #,##0_);_($* (#,##0);_($* "-"_);_(@_)', '[DBNum1]0', '[>abc]0', '[$€-407]#,##0.00',
    '0%', '0.0%', '#,##0;[Red](#,##0)', '0\\-0', '\\"0\\"', '[Color12]0', '[Blue]', '[$-1010409]B2dd/mm/yyyy',
  ])('accepts %s', (code) => {
    expect(formatCodeError(code)).toBeNull();
    expect(isValidFormatCode(code)).toBe(true);
  });

  it.each([
    ['"', /quotation mark/i],
    ['0.00"kg', /quotation mark/i],
    ['[', /bracket/i],
    ['[Red', /bracket/i],
    ['0;0;0;0;0', /four sections/i],
    ['[hello]0', /\[hello\]/],
    ['[NatNum1]0', /\[NatNum1\]/],
    ['E+', /exponent/i],
    ['0E+', /exponent/i],
    ['##0.0e-0', /uppercase E/i],
    ['E+00', /exponent/i],
    ['0 days', /quote/i],
    ['0 e', /quote/i],
    // Literal fraction denominators are limited to five digits.
    ['0/99999999999999999999', /denominator/i],
    ['# ?/99999999999999999999', /denominator/i],
    ['0/10000000000000000000000', /denominator/i],
    ['', /enter a format code/i],
    ['   ', /enter a format code/i],
    [null, /enter a format code/i],
    [`0${'"x"'.repeat(100)}`, /255/],
  ])('refuses %s', (code, message) => {
    expect(formatCodeError(code)).toMatch(message);
    expect(isValidFormatCode(code)).toBe(false);
  });

  it('reports malformed literal and numeric formats', () => {
    expect(formatWithCode(5, '"')).toBe('');
    expect(isValidFormatCode('"')).toBe(false);
    // An unclosed directive is invalid in display and the editor alike.
    expect(formatWithCode(5, '[')).toBe('#####');
    expect(isValidFormatCode('[')).toBe(false);
    // A malformed scientific code produces native overflow rather than a blank.
    expect(formatWithCode(5, 'E+')).toBe('#####');
    // An unusable literal denominator overflows for every numeric value.
    for (const code of ['0/99999999999999999999', '# ?/99999999999999999999']) {
      for (const value of [1.5, 0, -2, 12345.678]) expect(formatWithCode(value, code)).toBe('#####');
      expect(isValidFormatCode(code)).toBe(false);
    }
    // The largest five-digit literal is accepted, even when its internal encoding wraps.
    expect(isValidFormatCode('0/99999')).toBe(true);
    expect(formatWithCode(1.5, '# ?/1000000')).toBe('#####');
  });
});
