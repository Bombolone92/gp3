import { describe, expect, it } from 'vitest';
import { calc } from './helpers/calc.js';

const E = (code) => ({ error: code });

// A cell whose date lies outside the calendar shows the ##### placeholder, but TEXT hands
// its answer on as a value: it is #VALUE! rather than five hash signs of text.
describe('TEXT with a date or time outside the calendar', () => {
  it('is #VALUE! for a serial past 31 December 9999 or before day 0', () => {
    expect(calc('TEXT(2958466,"yyyy")')).toEqual(E('#VALUE!')); // the day after the calendar's last, 2958465
    expect(calc('TEXT(-1,"yyyy")')).toEqual(E('#VALUE!'));
    expect(calc('TEXT(-0.5,"h:mm")')).toEqual(E('#VALUE!'));
    expect(calc('TEXT(1E+300,"yyyy")')).toEqual(E('#VALUE!'));
    expect(calc('TEXT(2958466,"mmmm d")')).toEqual(E('#VALUE!'));
    expect(calc('ISERROR(TEXT(-1,"yyyy"))')).toBe(true);
  });

  it('still formats every day of the calendar and every number', () => {
    expect(calc('TEXT(2958465,"yyyy")')).toBe('9999');
    expect(calc('TEXT(0,"yyyy-mm-dd")')).toBe('1900-01-00'); // day 0 of the calendar
    expect(calc('TEXT(0.5,"h:mm")')).toBe('12:00'); // half a day into day 0
    expect(calc('TEXT(-1,"0.00")')).toBe('-1.00'); // a number format has no calendar
    expect(calc('TEXT(-1,"@")')).toBe('-1');
    // Elapsed hours count past the calendar's end: 3,000,000 days are 72,000,000 hours.
    expect(calc('TEXT(3000000,"[h]")')).toBe('72000000');
  });
});
