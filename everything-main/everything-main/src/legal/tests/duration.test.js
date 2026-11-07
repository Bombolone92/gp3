import { describe, it, expect } from 'vitest';
import { parseDuration, roundUpMinutes, formatHoursDecimal, formatHM, formatClock, timeValue } from '../src/core/duration.js';

describe('parseDuration', () => {
  it.each([
    ['1.5', 90],
    ['1,5', 90],
    ['.3', 18],
    ['2', 120],
    ['1:30', 90],
    ['0:06', 6],
    ['1:12:40', 73],
    ['1h 12m', 72],
    ['1h12m', 72],
    ['1h12', 72],
    ['2h', 120],
    ['2 hrs', 120],
    ['1 hour', 60],
    ['45m', 45],
    ['45 min', 45],
    ['45 mins', 45],
    ['  3.25 ', 195],
  ])('%s -> %i minutes', (input, minutes) => {
    expect(parseDuration(input)).toBe(minutes);
  });

  it('rejects nonsense and impossible values', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('1:75')).toBeNull();
    expect(parseDuration('99999')).toBeNull();
  });

  it('accepts numbers as hours', () => {
    expect(parseDuration(0.1)).toBe(6);
    expect(parseDuration(-1)).toBeNull();
  });
});

describe('roundUpMinutes', () => {
  it('rounds up to the billing increment', () => {
    expect(roundUpMinutes(1, 6)).toBe(6);
    expect(roundUpMinutes(6, 6)).toBe(6);
    expect(roundUpMinutes(7, 6)).toBe(12);
    expect(roundUpMinutes(16, 15)).toBe(30);
    expect(roundUpMinutes(7, 1)).toBe(7);
  });

  it('keeps zero at zero and ignores bad increments', () => {
    expect(roundUpMinutes(0, 6)).toBe(0);
    expect(roundUpMinutes(5, 0)).toBe(5);
  });
});

describe('formatting', () => {
  it('formats hours, clock time, and h/m', () => {
    expect(formatHoursDecimal(72)).toBe('1.20');
    expect(formatHoursDecimal(0)).toBe('0.00');
    expect(formatHM(72)).toBe('1h 12m');
    expect(formatHM(60)).toBe('1h');
    expect(formatHM(5)).toBe('5m');
    expect(formatClock(3723000)).toBe('01:02:03');
  });

  it('values time as hours times rate, in whole cents', () => {
    expect(timeValue(90, 30000)).toBe(45000);
    expect(timeValue(7, 25000)).toBe(2917);
    expect(timeValue(0, 25000)).toBe(0);
  });
});
