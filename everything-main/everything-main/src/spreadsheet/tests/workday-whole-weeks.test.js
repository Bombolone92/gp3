import { describe, expect, it } from 'vitest';
import { FUNCTIONS } from '../src/core/formula/functions.js';
import { ymdToSerial } from '../src/core/format.js';

// The business-day functions count whole weeks at once and pass each holiday once, rather than
// visiting every calendar day of the span: a span across the whole calendar answers in a moment.
const { NETWORKDAYS, WORKDAY } = FUNCTIONS;
const NETWORKDAYS_INTL = FUNCTIONS['NETWORKDAYS.INTL'];
const WORKDAY_INTL = FUNCTIONS['WORKDAY.INTL'];
const range = (...serials) => ({ range: true, values: serials.map((s) => [s]) });

const friday = ymdToSerial(2026, 9, 11);
const monday = friday + 3;

describe('holidays and weekends in WORKDAY', () => {
  it('takes one more working day for each holiday the span reaches, in date order', () => {
    // After Friday: Mon (holiday), Tue #1, Wed #2, Thu #3, Fri #4, Sat, Sun, Mon #5, Tue #6 = Friday + 11.
    expect(WORKDAY.fn([friday, 6, range(monday)])).toBe(friday + 11);
    // The whole next week off: #1 is the Monday after it, #5 the Friday after it, Friday + 14.
    expect(WORKDAY.fn([friday, 5, range(monday, monday + 1, monday + 2, monday + 3, monday + 4)])).toBe(friday + 14);
    // A holiday on the day a first count lands, and on the day after it: Wednesday.
    expect(WORKDAY.fn([friday, 1, range(monday, monday + 1)])).toBe(monday + 2);
    // A holiday on the day reached only because of an earlier holiday counts too: Thursday.
    expect(WORKDAY.fn([friday, 2, range(monday, monday + 2)])).toBe(monday + 3);
  });

  it('ignores holidays on weekends, on the start day, and past the span', () => {
    expect(WORKDAY.fn([friday, 1, range(friday + 1, friday + 2)])).toBe(monday); // Saturday and Sunday
    expect(WORKDAY.fn([friday, 1, range(friday)])).toBe(monday);
    expect(WORKDAY.fn([friday, 1, range(monday + 1)])).toBe(monday);
    expect(WORKDAY.fn([friday, 1, range(monday, monday)])).toBe(monday + 1); // one holiday, listed twice
  });

  it('counts backwards the same way', () => {
    expect(WORKDAY.fn([monday, -1, range(friday)])).toBe(friday - 1); // Thursday
    // Back from Monday: Fri (holiday), Thu #1, Wed #2, Tue #3, Mon #4, Fri #5 = Monday - 10.
    expect(WORKDAY.fn([monday, -5, range(friday)])).toBe(monday - 10);
    expect(WORKDAY.fn([monday, -1, range(monday)])).toBe(friday); // the start day is not passed
  });

  it('reads the weekend of WORKDAY.INTL', () => {
    expect(WORKDAY_INTL.fn([friday, 1, 11])).toBe(friday + 1); // only Sunday off: Saturday is next
    expect(WORKDAY_INTL.fn([friday, 2, 11])).toBe(monday); // Saturday #1, Sunday off, Monday #2
    // Only Sunday is a working day: the second Sunday after Friday.
    expect(WORKDAY_INTL.fn([friday, 2, '1111110'])).toBe(friday + 9);
    expect(WORKDAY_INTL.fn([friday, 2, '1111110', range(friday + 2)])).toBe(friday + 16);
    expect(WORKDAY_INTL.fn([friday, 3, '0000000', range(friday + 1)])).toBe(friday + 4); // no weekend, one holiday
  });
});

describe('holidays and weekends in NETWORKDAYS', () => {
  it('leaves out each holiday on a working day of the span once', () => {
    // Friday to Friday + 14: Fri, Mon–Fri, Mon–Fri = 11 working days; two Monday holidays and a Saturday one.
    expect(NETWORKDAYS.fn([friday, friday + 14])).toBe(11);
    expect(NETWORKDAYS.fn([friday, friday + 14, range(monday, monday + 7, friday + 1)])).toBe(9);
    expect(NETWORKDAYS.fn([friday, monday, range(monday, monday)])).toBe(1); // listed twice, left out once
    expect(NETWORKDAYS.fn([friday, monday, range(monday + 0.5)])).toBe(1); // a holiday's time of day is ignored
    expect(NETWORKDAYS.fn([friday, monday, range(monday + 1)])).toBe(2); // past the span
    expect(NETWORKDAYS.fn([monday, friday, range(monday)])).toBe(-1);
  });

  it('reads the weekend of NETWORKDAYS.INTL', () => {
    expect(NETWORKDAYS_INTL.fn([friday, monday, 7])).toBe(2); // Friday and Saturday off: Sunday and Monday
    // Only Sunday is a working day: Friday + 2 and Friday + 9 in Friday..Friday + 14.
    expect(NETWORKDAYS_INTL.fn([friday, friday + 14, '1111110'])).toBe(2);
    expect(NETWORKDAYS_INTL.fn([friday, friday + 14, '1111110', range(friday + 2)])).toBe(1);
    expect(NETWORKDAYS_INTL.fn([friday, friday + 14, '1111111'])).toBe(0);
  });
});

describe('spans across the whole calendar', () => {
  it('answer by whole weeks', () => {
    // Day 0 is a Saturday and 2958465 a Friday: 2958466 days are exactly 422638 weeks of five working days.
    expect(NETWORKDAYS.fn([0, 2958465])).toBe(2113190);
    expect(NETWORKDAYS_INTL.fn([0, 2958465, '0000011'])).toBe(2113190);
    expect(NETWORKDAYS_INTL.fn([0, 2958465, 1])).toBe(2113190);
    expect(NETWORKDAYS_INTL.fn([0, 2958465, '1111110'])).toBe(422638); // one Sunday a week
    expect(NETWORKDAYS.fn([2958465, 0])).toBe(-2113190);
    // From Sunday, day 1: working day 5k is the Friday of week k, 7k - 1; 2,000,000 is 400,000 weeks.
    expect(WORKDAY.fn([1, 2000000])).toBe(2799999);
    expect(WORKDAY_INTL.fn([1, 2000000, 1])).toBe(2799999);
    // Back from Friday 2958465: working day 5k is the Friday k weeks before, 2958465 - 7k.
    expect(WORKDAY.fn([2958465, -2000000])).toBe(158465);
    // 25,000 working days from day 1 reach 7 * 5000 - 1 = 34999; the Mondays of those 5000 weeks, 2 to 34995,
    // off adds 5000 working days, and the 1000 weeks they take have no holidays: 30,000 working days, 41999.
    const mondays = { range: true, values: Array.from({ length: 5000 }, (_, i) => [2 + 7 * i]) };
    expect(WORKDAY.fn([1, 25000, mondays])).toBe(41999);
  });

  it('take a moment, not a second each', () => {
    const t0 = performance.now();
    NETWORKDAYS.fn([0, 2958465]);
    NETWORKDAYS_INTL.fn([0, 2958465, '0000011']);
    WORKDAY.fn([1, 2000000]);
    WORKDAY_INTL.fn([1, 2000000, 1]);
    WORKDAY.fn([2958465, -2000000]);
    expect(performance.now() - t0).toBeLessThan(1000); // about two and a half seconds day by day
  });
});
