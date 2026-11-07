import { afterEach, describe, expect, it } from 'vitest';
import { formatWithCode } from '../src/core/numfmt.js';
import { setLocale, formatValue, dateNames, ymdToSerial } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

afterEach(() => setLocale('en-US'));

const day = ymdToSerial(2023, 3, 15); // a Wednesday

// Month and weekday names in custom format codes were always English, in every regional format and whatever
// the code's [$-407]-style locale tag said, so a German d. mmmm yyyy read 15. March 2023 beside a date preset
// that read 15. März 2023. They now print in the system's language and honour the tag.
describe('month and weekday names in a format code', () => {
  it.each([
    ['de-DE', 'dddd, d. mmmm yyyy', 'Mittwoch, 15. März 2023'],
    ['de-DE', 'd. mmm yyyy', '15. März 2023'], // the short form German writes beside a day; alone it is Mär
    ['de-DE', 'mmm', 'Mär'],
    ['de-DE', 'ddd', 'Mi'],
    ['fr-FR', 'dddd d mmmm yyyy', 'mercredi 15 mars 2023'],
    ['tr-TR', 'd mmmm yyyy', '15 Mart 2023'],
    ['tr-TR', 'ddd', 'Çar'],
    ['ja-JP', 'mmmm', '3月'],
    ['ja-JP', 'dddd', '水曜日'],
    ['en-GB', 'd mmmm yyyy', '15 March 2023'],
    ['en-US', 'dddd, mmmm d, yyyy', 'Wednesday, March 15, 2023'],
  ])('follow the %s regional format: %s reads %s', (locale, code, expected) => {
    setLocale(locale);
    expect(formatWithCode(day, code)).toBe(expected);
    expect(formatValue(day, { fmt: 'custom', code })).toBe(expected);
  });

  it('take the form a language writes beside a day number, and the standalone one for a month alone', () => {
    setLocale('ru-RU');
    expect(formatWithCode(day, 'd mmmm yyyy')).toBe('15 марта 2023');
    expect(formatWithCode(day, 'mmmm')).toBe('март');
    expect(formatWithCode(day, 'mmmm yyyy')).toBe('март 2023');
    setLocale('fi-FI');
    expect(formatWithCode(day, 'd. mmmm yyyy')).toBe('15. maaliskuuta 2023');
    expect(formatWithCode(day, 'mmmm')).toBe('maaliskuu');
    // Where the language writes a bare number beside the day, the short name stands in.
    expect(formatWithCode(day, 'd. mmm yyyy')).toBe('15. maalis 2023');
  });

  it('print the first letter of the month for mmmmm and keep English spellings in every English locale', () => {
    setLocale('de-DE');
    expect(formatWithCode(day, 'mmmmm')).toBe('M');
    setLocale('en-GB');
    // September abbreviates as Sep in British English too, where the locale data says Sept.
    expect(formatWithCode(ymdToSerial(2023, 9, 5), 'mmm')).toBe('Sep');
    expect(dateNames('en-AU').months.short[8]).toBe('Sep');
  });

  it.each([
    ['[$-407]d. mmmm yyyy', '15. März 2023'],
    ['[$-40C]mmmm', 'mars'],
    ['[$-de-DE]mmm', 'Mär'],
    ['[$-41F]dddd', 'Çarşamba'],
    ['[$-C0A]d "de" mmmm', '15 de marzo'],
    ['[$€-407]d. mmm', '€15. März'],
    ['[$-F800]dddd, mmmm d', 'Wednesday, March 15, 2023'], // system long date replaces the visible pattern
    ['[$-1010409]mmmm', 'March'], // a calendar in the high word leaves the language alone
  ])('honour the language of a locale tag: %s reads %s in en-US', (code, expected) => {
    expect(formatWithCode(day, code)).toBe(expected);
  });

  it('let a tag ask for English in another regional format', () => {
    setLocale('de-DE');
    expect(formatWithCode(day, '[$-409]mmmm d, yyyy')).toBe('March 15, 2023');
    expect(formatWithCode(day, '[$-809]ddd d mmm yyyy')).toBe('Wed 15 Mar 2023');
    expect(formatWithCode(day, 'mmmm d, yyyy')).toBe('März 15, 2023');
  });

  it('show a typed month and year, and a cell under a custom date code, in the regional language', () => {
    setLocale('de-DE');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'Feb 2024');
    expect(wb.getDisplay(id, 0, 0)).toBe('Feb-24');
    wb.applyStyle(id, parseRange('A2'), { fmt: 'custom', code: 'dddd, d. mmmm yyyy' });
    wb.setInput(id, 1, 0, '2023-03-15');
    expect(wb.getDisplay(id, 1, 0)).toBe('Mittwoch, 15. März 2023');
    setLocale('tr-TR');
    wb._invalidate();
    expect(wb.getDisplay(id, 0, 0)).toBe('Şub-24');
    expect(wb.getDisplay(id, 1, 0)).toBe('Çarşamba, 15. Mart 2023');
  });

  it('fall back to English for a locale Intl does not know', () => {
    expect(formatWithCode(day, '[$-zz-ZZ]mmmm')).toBe('March');
    expect(dateNames('xx-XX').months.long[2]).toBe('March');
  });
});
