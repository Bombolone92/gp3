import { CALENDAR_END, serialToYMD, ymdToSerial } from './format.js';

const units = ['days', 'months', 'years'];
const calendarStart = Math.min(0, ymdToSerial(serialToYMD(0).y, 1, 1));
const validDate = value => Number.isFinite(value) && value >= 0 && value < CALENDAR_END;

/** A date category occupies one whole base unit, unlike a numeric scatter X.
 * All dates in the same day/month/year sit at the same coordinate.
 * The base unit is independent of the major/minor calendar tick intervals.
 */
export function chartDateAxis(values, { min, max, baseUnit = 'days', between = true } = {}) {
  if (!units.includes(baseUnit)) baseUnit = 'days';
  const unitOf = value => {
    // Unit boundaries can precede serial zero or end at 10000-01-01 even
    // though plotted dates and saved bounds stay inside the workbook calendar.
    if (!Number.isFinite(value) || value < calendarStart || value > CALENDAR_END) return NaN;
    if (baseUnit === 'days') return Math.floor(value);
    const { y, m } = serialToYMD(value);
    return baseUnit === 'months' ? y * 12 + m - 1 : y;
  };
  const serialOf = unit => baseUnit === 'days' ? unit : baseUnit === 'months'
    ? ymdToSerial(Math.floor(unit / 12), unit % 12 + 1, 1) : ymdToSerial(unit, 1, 1);
  const data = values.filter(validDate).map(unitOf);
  const fixedMin = validDate(min), fixedMax = validDate(max) && (!fixedMin || unitOf(max) >= unitOf(min));
  let lo = fixedMin ? unitOf(min) : data.length ? data.reduce((a, b) => Math.min(a, b), Infinity) : fixedMax ? unitOf(max) : unitOf(1);
  let hi = fixedMax ? unitOf(max) : data.length ? data.reduce((a, b) => Math.max(a, b), -Infinity) : lo;
  // Invalid bounds cannot invert the calendar. Retain the valid fixed end and
  // provide one base interval; a valid one-category between axis needs no extra.
  if (hi < lo) { if (fixedMax && !fixedMin) lo = hi - 1; else hi = lo + 1; }
  lo = Math.max(unitOf(0), lo);
  hi = Math.min(unitOf(CALENDAR_END - 1), hi);
  if (hi === lo && !between) {
    if (hi < unitOf(CALENDAR_END - 1)) hi++;
    else lo--;
  }
  const inset = between ? .5 : 0, span = Math.max(1, hi - lo + 2 * inset);
  const fraction = (value, edge = 0) => (unitOf(value) - lo + inset + edge) / span;
  const crossing = value => {
    if (value === 'max') return 1;
    if (!Number.isFinite(value)) return 0;
    if (value <= serialOf(lo)) return 0;
    if (value >= serialOf(hi + (between ? 1 : 0))) return 1;
    return Math.min(1, Math.max(0, fraction(value, -inset)));
  };
  const ticks = (step = 1, unit = baseUnit, boundary = false) => {
    unit = units[Math.max(units.indexOf(baseUnit), Math.max(0, units.indexOf(unit)))];
    step = Number.isFinite(step) ? Math.max(1, Math.floor(step)) : 1;
    const start = serialOf(lo), { y, m, d } = serialToYMD(start), result = [];
    const limit = hi + (boundary && between ? 1 : 0);
    // Bound malformed/tiny intervals without looping through every calendar day.
    for (let i = 0; i < 1000; i++) {
      let value;
      if (unit === 'days') value = start + i * step;
      else {
        const month = m + i * step * (unit === 'years' ? 12 : 1);
        const end = serialToYMD(ymdToSerial(y, month + 1, 0)).d;
        value = ymdToSerial(y, month, Math.min(d, end));
      }
      const position = unitOf(value);
      if (!Number.isFinite(position) || position > limit) break;
      if (!result.length || position > unitOf(result.at(-1))) result.push(value);
    }
    return result;
  };
  return { min: serialOf(lo), max: serialOf(hi), baseUnit, span, inset, unitOf, fraction, crossing, ticks };
}
