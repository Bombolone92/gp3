import { expect, it } from 'vitest';
import { codeLocale, localeTag, formatWithCode } from '../src/core/numfmt.js';
import { dateNames } from '../src/core/format.js';
import { calc } from './helpers/calc.js';
import native from './fixtures/reference-arabic-calendar-names.json';

it('formats regional Arabic dates, month widths, calendar sections and meridiems', () => {
  for (const [value, code, expected] of native.cases) {
    expect(formatWithCode(value, code), `${value}: ${code}`).toBe(expected?.error ? '#####' : expected);
    expect(calc(`TEXT(${value},"${code.replaceAll('"', '""')}")`), `${value}: ${code}`).toEqual(expected);
  }
});

it('retains the Arabic LCID region independently of calendar and numeral flags', () => {
  const regions = ['SA','IQ','EG','LY','DZ','MA','TN','OM','YE','SY','JO','LB','KW','AE','BH','QA'];
  for (const [i, region] of regions.entries()) {
    const lcid = ((i + 1) * 0x400 + 1).toString(16).padStart(4, '0');
    for (const flags of ['', '1', '3', '206']) expect(codeLocale(`[$-${flags}${lcid}]mmmm`)).toBe(`ar-${region}`);
    expect(codeLocale(localeTag(`ar-${region}`))).toBe(`ar-${region}`);
  }
});

it('selects legacy and calendar names without mutating shared Intl resources', () => {
  const before = JSON.stringify(dateNames('ar-JO'));
  expect(formatWithCode(45306, '[$-ar-JO]mmm ddd')).toBe('كانون\u00a0الثاني الإثنين');
  expect(formatWithCode(45306, '[$-32c01]mmm ddd')).toBe('كانون ٢ اثنين');
  expect(JSON.stringify(dateNames('ar-JO'))).toBe(before);
  expect(formatWithCode(45306, '[$-20401]mmmm ddd')).toBe('January Mon');
});
