// Indian national (Saka) calendar. Chaitra starts on March 22, or March 21
// in a Gregorian leap year. It has 30/31 days, followed by five 31-day months
// and six 30-day months. The Saka year is 78 behind its Gregorian start year.
const DAY_MS = 86400000;
const leap = y => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
const yearStart = y => Date.UTC(y, 2, leap(y) ? 21 : 22);

export function sakaDate(gregorian) {
  const instant = Date.UTC(gregorian.y, gregorian.m - 1, Math.max(1, gregorian.d));
  const year = instant < yearStart(gregorian.y) ? gregorian.y - 1 : gregorian.y;
  let day = Math.round((instant - yearStart(year)) / DAY_MS), month = 1;
  const monthLength = m => m === 1 ? (leap(year) ? 31 : 30) : m <= 6 ? 31 : 30;
  while (day >= monthLength(month)) day -= monthLength(month++);
  return { ...gregorian, y: year - 78, m: month, d: day + 1 };
}

// Saka month names come transliterated and in Hindi (the Hindi set is also
// used by Arabic locale tags). Both month widths use the complete month name.
const LATIN_MONTHS = ['Chaitra', 'Vaisakha', 'Jyaistha', 'Asadha', 'Sravana', 'Bhadra', 'Asvina', 'Karthika', 'Agrahayana', 'Pausa', 'Magha', 'Phalguna'];
const HINDI_MONTHS = ['चैत्र', 'वैशाख', 'ज्येष्ट', 'आषाढ़', 'श्रावण', 'भाद्र', 'आश्वीन', 'क़ार्तीक', 'अग्रहायन', 'पौसा', 'माघ', 'फल्गुण'];
const LATIN_DAYS = ['Ravivara', 'Somavara', 'Mangalvara', 'Budhavara', 'Guruvara', 'Sukravara', 'Sanivara'];
const LATIN_SHORT_DAYS = ['Ravi', 'Som', 'Mangal', 'Budh', 'Guru', 'Sukra', 'Sani'];
const HINDI_DAYS = ['रविवार', 'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार'];
const names = (months, short, long) => ({ months: { short: months, long: months, shortInDate: months, inDate: months }, days: { short, long } });
const LATIN_NAMES = names(LATIN_MONTHS, LATIN_SHORT_DAYS, LATIN_DAYS);
const HINDI_NAMES = names(HINDI_MONTHS, HINDI_DAYS, HINDI_DAYS);

export function sakaNames(locale) {
  return /^(?:hi|ar)(?:-|$)/i.test(locale) ? HINDI_NAMES : LATIN_NAMES;
}
