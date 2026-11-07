import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';

describe('TIMEVALUE of a date and time', () => {
  it('gives exactly the time of day, equal to TIME of the same hour', () => {
    // 46023.541666666664 - 46023 keeps only about 11 digits of the fraction; TIME(13,0,0) is 13/24.
    expect(calc('TIMEVALUE("2026-01-01 13:00")=TIME(13,0,0)')).toBe(true);
    expect(calc('TIMEVALUE("2026-01-01 13:00")*24')).toBe(13);
    expect(calc('TIMEVALUE("2026-01-01 13:00")')).toBe(13 / 24);
    expect(calc('TIMEVALUE("1/15/2024 6:00 am")')).toBe(0.25);
    expect(calc('TIMEVALUE("2024-01-15 23:59:59")')).toBe((23 * 3600 + 59 * 60 + 59) / 86400);
    expect(calc('TIMEVALUE("2024-01-15 0:00")')).toBe(0);
    expect(calc('TIMEVALUE(A1)', { A1: "'2026-01-01 13:00" })).toBe(13 / 24);
  });
});

describe('TIMEVALUE of a number', () => {
  it('is #VALUE!, as its argument is a text string (the rule DATEVALUE follows here too)', () => {
    expect(calc('TIMEVALUE(0.75)')).toEqual({ error: '#VALUE!' });
    expect(calc('TIMEVALUE(45000.5)')).toEqual({ error: '#VALUE!' });
    expect(calc('TIMEVALUE(A1)', { A1: '13:45' })).toEqual({ error: '#VALUE!' }); // a typed time is a number in its cell
    expect(calc('TIMEVALUE(A1)', { A1: "'13:45" })).toBe(13.75 / 24);
    expect(calc('TIMEVALUE(TEXT(0.75,"h:mm"))')).toBe(0.75);
    expect(calc('DATEVALUE(45000)')).toEqual({ error: '#VALUE!' });
  });
});
