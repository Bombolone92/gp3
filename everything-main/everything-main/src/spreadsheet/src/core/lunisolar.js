import { CHINESE_LUNISOLAR_YEARS, JAPANESE_LUNISOLAR_YEARS, LUNISOLAR_FIRST_YEAR } from '../vendor/lunisolar-data.js';
import { dateNames, getLocale } from './format.js';

export const isLunisolarCalendar = calendar => [14, 15, 17, 18, 19].includes(calendar);
const yearsFor = calendar => calendar === 15 || calendar === 17 ? CHINESE_LUNISOLAR_YEARS : JAPANESE_LUNISOLAR_YEARS;
const yearIndex = (year, count) => ((year - LUNISOLAR_FIRST_YEAR) % count + count) % count;
const monthLength = (row, month) => 29 + ((row[3] >> (16 - month)) & 1);
const yearLength = year => (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;

// The five lunisolar format calendars share a cyclic table converter.
// ETO Korean and Rokuyou select the Japanese table; Taiwan/ETO Chinese select
// the Chinese table. Month ordinals include the inserted leap month.
export function lunisolarDate(gregorian, calendar) {
  const years = yearsFor(calendar), index = yearIndex(gregorian.y, years.length);
  let row = years[index], year = gregorian.y, label = year;
  const stamp = Date.UTC(year, gregorian.m - 1, Math.max(1, gregorian.d));
  if (stamp < Date.UTC(year, row[1] - 1, row[2])) {
    row = years[yearIndex(--year, years.length)];
    // At the table wrap the current year label stays, and the count of
    // the preceding year's days uses the last table year's Gregorian length.
    if (index !== 0) label = year;
  }
  let day = Math.round((stamp - Date.UTC(year, row[1] - 1, row[2])) / 86400000), month = 1;
  if (year < gregorian.y && index === 0) day += yearLength(LUNISOLAR_FIRST_YEAR + years.length - 1) - yearLength(year);
  while (month <= 13 && day >= monthLength(row, month)) day -= monthLength(row, month++);
  return { ...gregorian, y: label, m: month, d: day + 1 };
}

export function lunisolarLegacyWeekday(date, calendar) {
  const years = yearsFor(calendar), row = years[yearIndex(date.y, years.length)];
  if (calendar === 19) {
    // Rokuyou repeats six days and uses the nominal lunar month: the leap
    // month repeats its predecessor's number instead of advancing the cycle.
    const month = date.m - (row[0] && date.m > row[0] ? 1 : 0);
    return (month + date.d - 2) % 6;
  }
  // The neutral B2 service converts back from the displayed lunar year.
  // At a table wrap this can differ from the source Gregorian weekday.
  let day = date.d - 1;
  for (let month = 1; month < date.m; month++) day += monthLength(row, month);
  return new Date(Date.UTC(date.y, row[1] - 1, row[2] + day)).getUTCDay();
}

const CJK_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const KOREAN_MONTHS = ['정월', '이월', '삼월', '사월', '오월', '유월', '칠월', '팔월', '구월', '시월', '동짓달', '섣달'];
const nameCache = new Map();
export function lunisolarNames(calendar, locale) {
  const language = locale || getLocale(), key = `${calendar}:${language}:${!!locale}`;
  if (!nameCache.has(key)) {
    if (nameCache.size >= 128) nameCache.clear();
    if (!locale || calendar === 18 || calendar === 19) {
      const base = dateNames(locale ? 'en-US' : language);
      // Neutral resources have no thirteenth entry; fixed resources saturate
      // at month twelve. Do not emulate native out-of-bounds narrow glyphs.
      const months = Object.fromEntries(Object.entries(base.months).map(([width, values]) => [width, [...values, locale ? values[11] : '']]));
      months.narrow = months.long.map(name => Array.from(name)[0] || '');
      nameCache.set(key, { ...base, months });
    } else {
      const johab = /-x-johab$/i.test(language);
      const korean = calendar === 14 && /^ko(?:-|$)/i.test(language) && !johab;
      const traditional = calendar === 15 && /^zh-(?:TW|HK|MO)(?:-|$)/i.test(language);
      const months = [...(korean ? KOREAN_MONTHS : CJK_MONTHS)];
      if (traditional) months[0] = '一月';
      months.push(months[11]);
      const baseDays = dateNames(calendar === 14 ? korean ? 'ko-KR' : 'ja-JP' : traditional ? 'zh-TW' : 'zh-CN').days;
      // Johab's Chinese resource has full Chinese weekdays but English short
      // weekdays. B2's subsequent month lookup selects the default resource.
      const days = johab && calendar !== 14 ? { ...baseDays, short: dateNames('en-US').days.short } : baseDays;
      nameCache.set(key, { months: { long: months, short: months, inDate: months, shortInDate: months }, days });
    }
  }
  return nameCache.get(key);
}
