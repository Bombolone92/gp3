import { afterEach, describe, expect, it, vi } from 'vitest';
import { codeColor, codeDateKind, formatWithCode } from '../src/core/numfmt.js';
import { formatValue } from '../src/core/format.js';

// A custom format code was split into sections and tokenized on every call, and again by codeColor for
// every rendered cell, which made a custom format four to ten times the cost of a built-in one. The
// parsed code is now kept by its text, in a bounded cache, and every caller reads the same tokens.
afterEach(() => vi.restoreAllMocks());

/** How many regular expressions were tested while fn ran: tokenizing tests several per character of the code. */
function regexTests(fn) {
  const spy = vi.spyOn(RegExp.prototype, 'test');
  fn();
  const n = spy.mock.calls.length;
  spy.mockRestore();
  return n;
}

describe('the parsed format code cache', () => {
  it('parses a code once, not for every cell it formats', () => {
    const code = '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)';
    formatWithCode(1234.5, code);
    const repeated = regexTests(() => { for (let i = 0; i < 500; i++) formatWithCode(i * 1.37 - 300, code); });
    const distinct = regexTests(() => { for (let i = 0; i < 500; i++) formatWithCode(i * 1.37 - 300, `${code}"${i}"`); });
    expect(repeated * 3).toBeLessThan(distinct);
  });

  it('gives codeColor and codeDateKind the same parsed code', () => {
    const code = '[Blue]#,##0.00;[Red]-#,##0.00;[Green]0';
    codeColor(1, code);
    const repeated = regexTests(() => { for (let i = 0; i < 500; i++) codeColor(i - 250, code); });
    const distinct = regexTests(() => { for (let i = 0; i < 500; i++) codeColor(i - 250, `${code}"${i}"`); });
    expect(repeated * 3).toBeLessThan(distinct);
    codeDateKind(45000, 'yyyy-mm-dd hh:mm');
    const dates = regexTests(() => { for (let i = 0; i < 500; i++) codeDateKind(45000 + i, 'yyyy-mm-dd hh:mm'); });
    const freshDates = regexTests(() => { for (let i = 0; i < 500; i++) codeDateKind(45000 + i, `yyyy-mm-dd hh:mm"${i}"`); });
    expect(dates * 3).toBeLessThan(freshDates);
  });

  it('formats every value of a code as before, the section chosen and the colour read per value', () => {
    const code = '[Blue]#,##0.00;[Red](#,##0.00);"zero";"<"@">"';
    for (let round = 0; round < 3; round++) {
      expect(formatWithCode(1234.5, code)).toBe('1,234.50');
      expect(formatWithCode(-1234.5, code)).toBe('(1,234.50)');
      expect(formatWithCode(0, code)).toBe('zero');
      expect(formatWithCode('abc', code)).toBe('<abc>');
      expect(codeColor(1, code)).toBe('#0000ff');
      expect(codeColor(-1, code)).toBe('#ff0000');
      expect(codeColor(0, code)).toBe(null);
      expect(formatWithCode(150, '[>=100]"big";"small"')).toBe('big');
      expect(formatWithCode(50, '[>=100]"big";"small"')).toBe('small');
      expect(formatWithCode(45000, 'yyyy-mm-dd')).toBe('2023-03-15');
      expect(codeDateKind(45000, 'yyyy-mm-dd')).toBe('date');
      expect(formatWithCode('text', '0.00')).toBe('text');
      expect(formatValue(0.125, { fmt: 'custom', code: '0.0%' })).toBe('12.5%');
    }
  });

  it('prints General among literals for each value in turn, since that part of a section changes with the value', () => {
    for (let round = 0; round < 2; round++) {
      expect(formatWithCode(1234.5, 'General" units"')).toBe('1234.5 units');
      expect(formatWithCode(-0.5, 'General" units"')).toBe('-0.5 units');
      expect(formatWithCode(7, 'General" units"')).toBe('7 units');
      expect(formatWithCode(-3, 'General;-General')).toBe('-3');
    }
  });

  it('still formats correctly once the cache has been filled and cleared', () => {
    const first = '#,##0.0" first"';
    expect(formatWithCode(12, first)).toBe('12.0 first');
    for (let i = 0; i < 700; i++) formatWithCode(i, `0.00" n${i}"`);
    expect(formatWithCode(12, first)).toBe('12.0 first');
    expect(formatWithCode(3, '0.00" n3"')).toBe('3.00 n3');
    expect(formatWithCode(3, '0.00" n699"')).toBe('3.00 n699');
  });
});
