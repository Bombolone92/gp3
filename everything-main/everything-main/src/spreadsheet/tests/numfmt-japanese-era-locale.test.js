import { afterEach, describe, expect, it } from 'vitest';
import { formatWithCode, codeDateKind } from '../src/core/numfmt.js';
import { setLocale, ymdToSerial, formatValue } from '../src/core/format.js';

afterEach(() => setLocale('en-US'));

// Under the Japanese regional format the era letters of an untagged code printed no era: the usual 和暦 code
// ggge"年"m"月"d"日" gave 2023年3月15日. On a Japanese system g and e resolve to the era without a locale
// tag; the [$-411] tag is what Excel writes into the file so the code survives on other systems.
const REIWA_5 = ymdToSerial(2023, 3, 15);
const CODE = 'ggge"年"m"月"d"日"';

describe('the era letters under the Japanese regional format', () => {
  it('print the era and its year in an untagged code, as a tagged one always did', () => {
    setLocale('ja-JP');
    expect(formatWithCode(REIWA_5, CODE)).toBe('令和5年3月15日');
    expect(formatWithCode(REIWA_5, 'gggee"年"m"月"d"日"')).toBe('令和05年3月15日');
    expect(formatWithCode(REIWA_5, 'ge.m.d')).toBe('R5.3.15');
    expect(formatWithCode(REIWA_5, 'gge"年"')).toBe('令5年');
    expect(formatWithCode(REIWA_5, `[$-411]${CODE}`)).toBe('令和5年3月15日');
    expect(formatWithCode(REIWA_5, `[$-ja-JP]${CODE}`)).toBe('令和5年3月15日');
    // The Gregorian year is still the year of yyyy.
    expect(formatWithCode(REIWA_5, 'yyyy"年"m"月"d"日"')).toBe('2023年3月15日');
    expect(formatWithCode(REIWA_5, 'ggge"年" (yyyy)')).toBe('令和5年 (2023)');
  });

  it('count the years from each era\'s first day', () => {
    setLocale('ja-JP');
    expect(formatWithCode(ymdToSerial(2019, 4, 30), 'ggge"年"')).toBe('平成31年');
    expect(formatWithCode(ymdToSerial(2019, 5, 1), 'ggge"年"')).toBe('令和1年');
    expect(formatWithCode(ymdToSerial(1989, 1, 7), 'ggge"年"')).toBe('昭和64年');
    expect(formatWithCode(ymdToSerial(1989, 1, 8), 'ggge"年"')).toBe('平成1年');
    expect(formatWithCode(ymdToSerial(1926, 12, 25), 'ggge"年"')).toBe('昭和1年');
  });

  it('follow a locale tag naming another language, and print nothing outside Japan without a tag', () => {
    setLocale('ja-JP');
    expect(formatWithCode(REIWA_5, `[$-409]${CODE}`)).toBe('2023年3月15日');
    setLocale('en-US');
    expect(formatWithCode(REIWA_5, CODE)).toBe('2023年3月15日');
    expect(formatWithCode(REIWA_5, `[$-411]${CODE}`)).toBe('令和5年3月15日');
    setLocale('zh-CN');
    expect(formatWithCode(REIWA_5, CODE)).toBe('2023年3月15日');
    setLocale('ko-KR');
    expect(formatWithCode(REIWA_5, CODE)).toBe('2023年3月15日');
  });

  it('are resolved when the value is shown, so the same code follows a regional format switched mid-session', () => {
    expect(formatWithCode(REIWA_5, CODE)).toBe('2023年3月15日');
    setLocale('ja-JP');
    expect(formatWithCode(REIWA_5, CODE)).toBe('令和5年3月15日');
    expect(formatValue(REIWA_5, { fmt: 'custom', code: CODE })).toBe('令和5年3月15日');
    expect(codeDateKind(REIWA_5, CODE)).toBe('date');
    setLocale('en-US');
    expect(formatWithCode(REIWA_5, CODE)).toBe('2023年3月15日');
  });

  it('leave the unit letters of a numeric code alone', () => {
    setLocale('ja-JP');
    expect(formatWithCode(5, '0 "kg"')).toBe('5 kg');
    expect(formatWithCode(5, '0" g"')).toBe('5 g');
    expect(formatWithCode(2.5, '0.0"e"')).toBe('2.5e');
  });
});
