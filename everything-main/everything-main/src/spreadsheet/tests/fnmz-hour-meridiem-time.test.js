import { describe, it, expect } from 'vitest';
import { parseInput, parseTime } from '../src/core/format.js';
import { calc } from './helpers/calc.js';

// An hour with its half of the day and no minutes, "3 pm", is a time wherever text is read as a
// value: TIMEVALUE read it, and now VALUE, a criterion and a typed cell read it the same way, since the
// rule lives in the one time parser they share.

const VALUE = { error: '#VALUE!' };

describe('an hour with AM or PM and no minutes', () => {
  it('is the time in VALUE, TIMEVALUE, a typed cell and a criterion alike', () => {
    for (const text of ['3 pm', '3 PM', '3pm', '3 p', '03 pm']) {
      expect(calc(`VALUE("${text}")`), text).toBe(0.625);
      expect(calc(`TIMEVALUE("${text}")`), text).toBe(0.625);
      expect(calc('A1', { A1: text }), text).toBe(0.625);
    }
    expect(calc('VALUE("12 pm")')).toBe(0.5);
    expect(calc('VALUE("12pm")')).toBe(0.5);
    expect(calc('VALUE("12 am")')).toBe(0);
    expect(calc('VALUE("12 a")')).toBe(0);
    expect(calc('VALUE("1 am")')).toBe(1 / 24);
    expect(parseInput('3 pm')).toMatchObject({ v: 0.625, fmt: 'time' });
    expect(parseTime('3 pm')).toBe(0.625);
    expect(calc('COUNTIF(A1:A2,">"&TIME(14,0,0))', { A1: "'3 pm", A2: "'1 pm" })).toBe(0);
    expect(calc('TIMEVALUE("3 pm")=TIME(15,0,0)')).toBe(true);
  });

  it('leaves the rest as text: an hour outside 1 to 12, a bare letter with no space, other words', () => {
    expect(calc('VALUE("13 pm")')).toEqual(VALUE);
    expect(calc('VALUE("0 am")')).toEqual(VALUE);
    expect(calc('VALUE("3 xm")')).toEqual(VALUE);
    expect(calc('VALUE("3 pm x")')).toEqual(VALUE);
    expect(calc('TIMEVALUE("13 pm")')).toEqual(VALUE);
    expect(calc('DATEVALUE("3 pm")')).toEqual(VALUE);
    expect(calc('A1', { A1: '3A' })).toBe('3A');
    expect(calc('A1', { A1: '3p' })).toBe('3p');
    expect(calc('A1', { A1: '15 pm' })).toBe('15 pm');
    expect(parseTime('3')).toBeNull();
    expect(parseTime('pm')).toBeNull();
  });
});
