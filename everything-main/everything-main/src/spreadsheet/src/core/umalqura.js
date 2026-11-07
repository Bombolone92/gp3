import { UMALQURA_FIRST_YEAR, UMALQURA_MONTH_FLAGS } from '../vendor/umalqura-data.js';
import { hijriDate } from './hijri.js';

const DAY_MS = 86400000;
const EPOCH = Date.UTC(1900, 3, 30);
const monthLength = (flags, month) => 29 + ((flags >> (month - 1)) & 1);
const yearStarts = [0];
for (const flags of UMALQURA_MONTH_FLAGS) {
  let length = 0;
  for (let month = 1; month <= 12; month++) length += monthLength(flags, month);
  yearStarts.push(yearStarts.at(-1) + length);
}

export function umalquraDate(gregorian) {
  const day = Math.round((Date.UTC(gregorian.y, gregorian.m - 1, Math.max(1, gregorian.d)) - EPOCH) / DAY_MS);
  if (day < 0 || day >= yearStarts.at(-1)) return hijriDate(gregorian);
  let low = 0, high = yearStarts.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (day < yearStarts[middle]) high = middle;
    else low = middle;
  }
  let remaining = day - yearStarts[low], month = 1;
  const flags = UMALQURA_MONTH_FLAGS[low];
  while (remaining >= monthLength(flags, month)) remaining -= monthLength(flags, month++);
  return { ...gregorian, y: UMALQURA_FIRST_YEAR + low, m: month, d: remaining + 1 };
}
