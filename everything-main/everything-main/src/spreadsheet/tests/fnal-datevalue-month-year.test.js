import { describe, it, expect } from 'vitest';
import { getLocale, setLocale, parseInput } from '../src/core/format.js';
import { calc } from './helpers/calc.js';

// A month and a year ("Jan 2024", "February 2024", "Feb-2024") typed into a cell, or handed to VALUE, is
// the first of that month; DATEVALUE reads it the same way rather than #VALUE!.

const VALUE = { error: '#VALUE!' };

describe('DATEVALUE of a month and year', () => {
  it.each(['January  2024', 'Jan.   2024', 'Jan\u00a02024', 'Jan\u202f2024'])('accepts date component spacing in %s', text => {
    expect(parseInput(text)).toMatchObject({ v: 45292, fmt: 'custom', code: 'mmm-yy' });
    expect(calc(`DATEVALUE("${text}")`)).toBe(45292);
    expect(calc(`VALUE("${text}")`)).toBe(45292);
  });

  it('is the first of the month, as VALUE and a typed cell read it', () => {
    expect(calc('DATEVALUE("Jan 2024")')).toBe(45292);
    expect(calc('DATEVALUE("February 2024")')).toBe(45323);
    expect(calc('DATEVALUE("Feb-2024")')).toBe(45323);
    expect(calc('DATEVALUE(A1)', { A1: "'Jan 2024" })).toBe(45292);
    expect(calc('DATEVALUE("Jan 2024")=VALUE("Jan 2024")')).toBe(true);
    expect(calc('DATEVALUE("Jan 2024")=A1', { A1: 'Jan 2024' })).toBe(true);
    const previous = getLocale();
    setLocale('de-DE');
    try { expect(calc('DATEVALUE("März 2024")')).toBe(45352); } finally { setLocale(previous); }
  });

  it('still reads dates as before and refuses what is no date', () => {
    expect(calc('DATEVALUE("2024-01-15")')).toBe(45306);
    expect(calc('DATEVALUE("1/15/2024 6:00 am")')).toBe(45306);
    expect(calc('DATEVALUE("25:30")')).toEqual(VALUE);
    expect(calc('DATEVALUE("1 1/2")')).toEqual(VALUE);
    expect(calc('DATEVALUE("Jan")')).toEqual(VALUE);
    expect(calc('DATEVALUE("12%")')).toEqual(VALUE);
    expect(calc('DATEVALUE(45000)')).toEqual(VALUE);
  });
});
