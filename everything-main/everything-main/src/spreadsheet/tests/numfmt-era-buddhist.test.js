import { describe, expect, it } from 'vitest';
import { formatWithCode, codeDateKind } from '../src/core/numfmt.js';
import { ymdToSerial } from '../src/core/format.js';

/**
 * The calendar letters Excel's date codes carry beyond y m d h s, as its documentation gives them:
 *
 * - "Japan era changes and Gannen" (support.microsoft.com) formats Japanese dates with
 *   [<=43585][$-ja-JP]ggge"年"m"月"d"日";[>=43831]ggge"年"m"月"d"日";ggg"元年"m"月"d"日", for Excel 2013 and
 *   earlier with [$-411] in place of [$-ja-JP]: ggg is the era's full name and e the year within the era,
 *   43585 (30 April 2019) being Heisei's last day, so Reiwa begins 1 May 2019; g is the era's initial
 *   (R) and gg its first character (令), as the codes ge and gge show them.
 *   The eras are those of the Japanese calendar: Meiji from 8 September 1868,
 *   Taisho from 30 July 1912, Showa from 25 December 1926, Heisei from 8 January 1989, Reiwa from
 *   1 May 2019.
 * - "Format dates using alternate calendars" (Excel 2003 help) formats 1/1/2000 with d/m/bbbb as the
 *   Thai Buddhist date 1/1/2543: bbbb is the Gregorian year plus 543, and bb its last two digits as
 *   yy is the year's; b1 and b2 at the head of a section pick the Gregorian or Hijri calendar.
 * - [MS-OE376] §3.8.30 gives the en-US grammar with y m d h s only and says the international letters
 *   extend it: outside a Japanese-tagged section there is no era, so g prints nothing and e is the
 *   Gregorian year in four digits, the way ge.m.d reads 2024.1.15 in an English Excel.
 */
const d = (y, m, day) => ymdToSerial(y, m, day);

describe('Japanese era codes', () => {
  it('print the era and the year within it when the section is tagged Japanese', () => {
    expect(formatWithCode(d(2024, 1, 15) + 0.5, '[$-411]ge.m.d')).toBe('R6.1.15');
    expect(formatWithCode(d(2024, 1, 15), '[$-411]gge')).toBe('令6');
    expect(formatWithCode(d(2024, 1, 15), '[$-ja-JP]ggge"年"m"月"d"日"')).toBe('令和6年1月15日');
    expect(formatWithCode(d(2024, 1, 15), '[$-411]ggg"元年"m"月"d"日"')).toBe('令和元年1月15日'); // Gannen style: the literal stands in for e
    expect(formatWithCode(d(2024, 1, 15), '[$-411]ee')).toBe('06');
    expect(formatWithCode(d(2019, 4, 30), '[$-411]ggge')).toBe('平成31');
    expect(formatWithCode(d(2019, 5, 1), '[$-411]ggge')).toBe('令和1');
    expect(formatWithCode(d(1989, 1, 7), '[$-411]ggge')).toBe('昭和64');
    expect(formatWithCode(d(1989, 1, 8), '[$-411]ge')).toBe('H1');
    expect(formatWithCode(d(1926, 12, 25), '[$-411]ge')).toBe('S1');
    expect(formatWithCode(d(1912, 7, 30), '[$-411]ge')).toBe('T1');
    expect(formatWithCode(d(1900, 6, 1), '[$-411]ge')).toBe('M33'); // every day the calendar has falls in an era
    // The MS support format, whole.
    const code = '[<=43585][$-411]ggge"年"m"月"d"日";[>=43831]ggge"年"m"月"d"日";ggg"元年"m"月"d"日"';
    expect(formatWithCode(d(2019, 4, 30), code)).toBe('平成31年4月30日');
    expect(formatWithCode(d(2020, 1, 1), code)).toBe('令和2年1月1日');
  });

  it('print no era, and the Gregorian year for e, in a section without a Japanese tag', () => {
    expect(formatWithCode(d(2024, 1, 15) + 0.5, 'ge.m.d')).toBe('2024.1.15');
    expect(formatWithCode(d(2024, 1, 15) + 0.5, 'ggge"年"m"月"d"日"')).toBe('2024年1月15日');
    expect(formatWithCode(d(2024, 1, 15), 'e')).toBe('2024');
    expect(formatWithCode(d(2024, 1, 15), '[$-409]ge')).toBe('2024');
    expect(formatWithCode(d(2024, 1, 15), '[$€-407]e/mm')).toBe('€2024/01');
  });
});

describe('Buddhist year codes', () => {
  it('print the Gregorian year plus 543', () => {
    expect(formatWithCode(d(2000, 1, 1), 'd/m/bbbb')).toBe('1/1/2543');
    expect(formatWithCode(d(2024, 1, 15) + 0.5, '[$-41E]d mmmm bbbb')).toBe('15 มกราคม 2024'); // A language-only tag uses Gregorian years.
    expect(formatWithCode(d(2024, 1, 15) + 0.5, '[$-7041E]d mmmm bbbb')).toBe('15 มกราคม 2567');
    expect(formatWithCode(d(2024, 1, 15), 'bb')).toBe('67');
    expect(formatWithCode(d(2024, 1, 15), 'bbbb')).toBe('2567');
    // b1 and b2 head a section to pick its calendar; the dates themselves read the same here.
    expect(formatWithCode(d(2024, 1, 15), 'b1yyyy-mm-dd')).toBe('2024-01-15');
    expect(formatWithCode(d(2024, 1, 15), '[$-1010409]B2dd/mm/yyyy')).toBe('15/01/2024');
  });
});

describe('the new letters', () => {
  it('make a date section, and a date kind, as y does', () => {
    expect(codeDateKind(45306, 'e')).toBe('date');
    expect(codeDateKind(45306, 'bbbb')).toBe('date');
    expect(codeDateKind(45306, '[$-411]ggge"年"m"月"d"日"')).toBe('date');
    expect(codeDateKind(45306, '[$-411]ggge"年"m"月"d"日" h:mm')).toBe('datetime');
  });

  it('requires quoted date letters in unit labels and preserves scientific notation', () => {
    expect(formatWithCode(5, '0 "kg"')).toBe('5 kg');
    expect(formatWithCode(5, '0 kg')).toBe('#####');
    expect(formatWithCode(5, 'kg')).toBe('k');
    expect(formatWithCode(5, '0 lb')).toBe('#####');
    expect(formatWithCode(2, 'lb')).toBe('l43');
    expect(formatWithCode(1234.5, '0.00E+00')).toBe('1.23E+03');
    expect(formatWithCode(1234.5, '##0.0E-0')).toBe('1.2E3');
    expect(formatWithCode(3, '0 "days"')).toBe('3 days');
    expect(formatWithCode('x', '@ "each"')).toBe('x each');
  });
});
