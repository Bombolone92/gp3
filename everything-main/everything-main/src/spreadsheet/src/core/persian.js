import { persianNewYearOnOrBefore } from '../vendor/persian-calendar.js';

const DAY_MS = 86400000;
const UNIX_EPOCH_DAY = 719162;
const yearStarts = new Map();
function yearStart(year) {
  if (!yearStarts.has(year)) {
    if (yearStarts.size >= 128) yearStarts.clear();
    // July is safely after the equinox. Cache by Gregorian year so a column
    // of dates pays for the astronomical calculation once per year.
    yearStarts.set(year, persianNewYearOnOrBefore(Date.UTC(year, 6, 1) / DAY_MS + UNIX_EPOCH_DAY + 1));
  }
  return yearStarts.get(year);
}

export function persianDate(gregorian) {
  const day = Date.UTC(gregorian.y, gregorian.m - 1, Math.max(1, gregorian.d)) / DAY_MS + UNIX_EPOCH_DAY;
  const startYear = day < yearStart(gregorian.y) ? gregorian.y - 1 : gregorian.y;
  const ordinal = day - yearStart(startYear);
  const month = ordinal < 186 ? Math.floor(ordinal / 31) + 1 : Math.floor((ordinal - 186) / 30) + 7;
  const preceding = month <= 6 ? (month - 1) * 31 : 186 + (month - 7) * 30;
  return { ...gregorian, y: startYear - 621, m: month, d: ordinal - preceding + 1 };
}

const LATIN_MONTHS = ['Farvardin', 'Ordibehesht', 'Khordād', 'Tir', 'Mordād', 'Shahrivar', 'Mehr', 'Ᾱban', 'Ᾱzar', 'Day', 'Bahmān', 'Esfand'];
const PERSIAN_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const LATIN_DAYS = ['Yekshanbeh', 'Doshanbeh', 'Seshanbeh', 'Chahārshanbeh', 'Panjshanbeh', "Jom'eh", 'shanbeh'];
const FRENCH_MONTHS = ['Fàrvàrdine', 'ordibéhécht', 'khordad', 'tir', 'mordàd', 'shàhŕivàr', 'méhr', 'aban', 'azàr', 'déy', 'bàhmàn', 'ésfànd'];
const FRENCH_DAYS = ['Yékchanbé', 'Dochànbé', 'Séchànbe', 'Chaharchanbé', 'Pànjchànbé', 'Jomé', 'Chànbe'];
const PERSIAN_DAYS = ['یکشنبه', 'دوشنبه', 'سه شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const names = (months, days) => ({ months: { short: months, long: months, shortInDate: months, inDate: months }, days: { short: days, long: days } });
const LATIN_NAMES = names(LATIN_MONTHS, LATIN_DAYS);
const FRENCH_NAMES = names(FRENCH_MONTHS, FRENCH_DAYS);
const PERSIAN_NAMES = names(PERSIAN_MONTHS, PERSIAN_DAYS);

export function persianNames(locale) {
  if (/^en(?:-|$)/i.test(locale)) return LATIN_NAMES;
  return /^fr(?:-|$)/i.test(locale) ? FRENCH_NAMES : PERSIAN_NAMES;
}
