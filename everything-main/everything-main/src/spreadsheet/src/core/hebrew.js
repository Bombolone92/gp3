import { HEBREW_FIRST_GREGORIAN_YEAR, HEBREW_YEAR_DATA } from '../vendor/hebrew-data.js';
import { dateNames, getLocale } from './format.js';

const TABLE_YEARS = HEBREW_YEAR_DATA.length / 2;
const TABLE_END = HEBREW_FIRST_GREGORIAN_YEAR + TABLE_YEARS;
// Localized month names and the neutral B2 weekday names end at Hebrew
// year 8263, for compatibility with workbooks from Excel. Numeric fields
// and B2's Arabic month table continue.
export const HEBREW_NAME_YEAR_END = 8263;
const yearIndex = year => (year - HEBREW_FIRST_GREGORIAN_YEAR) % TABLE_YEARS;
const monthLengths = type => {
  const months = [30, type % 3 === 0 ? 30 : 29, type % 3 === 1 ? 29 : 30, 29, 30, 29, 30, 29, 30, 29, 30, 29];
  if (type > 3) months.splice(5, 0, 30);
  return months;
};
const lengths = Array.from({ length: 6 }, (_, i) => monthLengths(i + 1));

function januaryDate(year) {
  const index = yearIndex(year);
  let day = HEBREW_YEAR_DATA[index * 2], month = 4;
  if (day === 0) { month = 5; day = 1; }
  else if (day === 30) month = 3;
  else if (day === 31 || day === 32) { month = 5; day -= 29; }
  else if (day === 33) { month = 3; day = 29; }
  return { day, month, type: HEBREW_YEAR_DATA[index * 2 + 1] };
}

export function hebrewLegacyWeekday(hebrew) {
  // This name service converts the Hebrew date back through January's anchor.
  // Beyond the table, that inverse can differ from the original Gregorian
  // date where repeated table years have a different leap-day arrangement.
  let year = hebrew.y - 3760;
  const anchor = januaryDate(year);
  const ordinal = (type, month, day) => lengths[type - 1].slice(0, month - 1).reduce((sum, n) => sum + n, day);
  const current = ordinal(anchor.type, hebrew.m, hebrew.d);
  let offset = current - ordinal(anchor.type, anchor.month, anchor.day);
  if (offset < 0) {
    const previous = januaryDate(--year);
    offset = lengths[previous.type - 1].reduce((sum, n) => sum + n, current)
      - ordinal(previous.type, previous.month, previous.day);
  }
  const centuryDays = year => Math.floor(year / 100) - Math.floor(year / 400);
  const extraDays = Math.max(0, centuryDays(year - 1) - centuryDays(TABLE_END - 1));
  return ((new Date(Date.UTC(year, 0, 1)).getUTCDay() + extraDays + offset) % 7 + 7) % 7;
}

// Keep the table lookup, including its repeating far-future data and
// Julian leap-day counting after the table ends. A proleptic Intl Hebrew
// calendar diverges at the last table year's autumn and is not interchangeable.
export function hebrewDate(gregorian) {
  const index = yearIndex(gregorian.y);
  let { day, month, type } = januaryDate(gregorian.y);
  let year = gregorian.y + 3760;
  day += Math.round((Date.UTC(gregorian.y, gregorian.m - 1, Math.max(1, gregorian.d)) - Date.UTC(gregorian.y, 0, 1)) / 86400000);
  if (gregorian.y >= TABLE_END && gregorian.y % 100 === 0 && gregorian.y % 400 !== 0 && gregorian.m > 2) day++;
  while (day > lengths[type - 1][month - 1]) {
    day -= lengths[type - 1][month - 1];
    if (++month > lengths[type - 1].length) {
      month = 1; year++;
      type = HEBREW_YEAR_DATA[((index + 1) % TABLE_YEARS) * 2 + 1];
    }
  }
  return { ...gregorian, y: year, m: month, d: day, leap: type > 3 };
}

const LATIN_MONTHS = ['Tishrei', 'Cheshvan', 'Kislev', 'Tevet', 'Shvat', 'AdarI', 'AdarII', 'Nisan', 'Iyar', 'Sivan', 'Tamuz', 'Av', 'Elul'];
const HEBREW_MONTHS = ['תשרי', 'חשון', 'כסלו', 'טבת', 'שבט', 'אדר א', 'אדר ב', 'ניסן', 'אייר', 'סיון', 'תמוז', 'אב', 'אלול'];
// The legacy Arabic resource has twelve entries and saturates at Av.
const LEGACY_MONTHS = ['تشري', 'مرحشوان', 'كيسلو', 'طيفت', 'شباط', 'آذار الأول', 'آذار', 'نيسان', 'أيار', 'سيفان', 'تموز', 'آب', 'آب'];
const HEBREW_DAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'יום שבת'];
const ARABIC_SHORT_DAYS = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const nameCache = new Map();

export function hebrewNames(locale, leap = true, legacy = false) {
  const language = locale || getLocale(), key = `${language}:${!!locale}:${leap}:${legacy}`;
  if (!nameCache.has(key)) {
    if (nameCache.size >= 128) nameCache.clear();
    const base = dateNames(language), arabic = /^ar(?:-|$)/i.test(language), hebrew = /^he(?:-|$)/i.test(language);
    if (!locale) {
      // A neutral tag indexes ordinary month names, so month 13 has no name.
      // Keep it empty at every width; native narrow output reads past the
      // resource and can emit an unrelated quote character.
      const months = Object.fromEntries(Object.entries(base.months).map(([width, values]) => [width, [...values, '']]));
      months.narrow = months.long.map(name => Array.from(name)[0] || '');
      nameCache.set(key, { ...base, months });
    } else {
      const months = [...(legacy ? LEGACY_MONTHS : arabic || hebrew ? HEBREW_MONTHS : LATIN_MONTHS)];
      if (!legacy && !leap) months.splice(5, 2, arabic || hebrew ? 'אדר' : 'Adar');
      const days = arabic ? { short: ARABIC_SHORT_DAYS, long: [...HEBREW_DAYS.slice(0, 6), 'السبت'] }
        : hebrew ? { ...base.days, long: HEBREW_DAYS } : base.days;
      nameCache.set(key, { months: { long: months, short: months, inDate: months, shortInDate: months,
        narrow: legacy ? months.map(name => Array.from(name)[0]) : months }, days });
    }
  }
  return nameCache.get(key);
}
