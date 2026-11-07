import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { ymdToSerial } from '../src/core/format.js';

function calc(formula) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, `=${formula}`);
  return wb.getValue(id, 0, 0);
}

const VALUE = { error: '#VALUE!' };
const NUM = { error: '#NUM!' };

describe('DATEVALUE and TIMEVALUE text', () => {
  it('DATEVALUE takes text, not a number', () => {
    expect(calc('DATEVALUE(45000)')).toEqual(VALUE);
    expect(calc('DATEVALUE("2024-01-15")')).toBe(ymdToSerial(2024, 1, 15));
  });

  it('TIMEVALUE wraps hours past 23 around the day', () => {
    expect(calc('TIMEVALUE("25:00")')).toBeCloseTo(1 / 24, 12);
    expect(calc('TIMEVALUE("24:00")')).toBe(0);
    expect(calc('TIMEVALUE("48:30")')).toBeCloseTo(0.5 / 24, 12);
    expect(calc('TIMEVALUE("13:45")')).toBeCloseTo(13.75 / 24, 12);
  });

  it('TIMEVALUE reads an hour with AM or PM and no minutes', () => {
    expect(calc('TIMEVALUE("6 PM")')).toBe(0.75);
    expect(calc('TIMEVALUE("6PM")')).toBe(0.75);
    expect(calc('TIMEVALUE("6 am")')).toBe(0.25);
    expect(calc('TIMEVALUE("12 AM")')).toBe(0);
    expect(calc('TIMEVALUE("13 PM")')).toEqual(VALUE);
    expect(calc('TIMEVALUE("6")')).toEqual(VALUE);
  });
});

describe('WEEKNUM and TIME arguments', () => {
  it('WEEKNUM truncates its return type', () => {
    expect(calc('WEEKNUM(45000,1.5)')).toBe(calc('WEEKNUM(45000,1)'));
    expect(calc('WEEKNUM(45000,2.9)')).toBe(calc('WEEKNUM(45000,2)'));
    expect(calc('WEEKNUM(45000,3)')).toEqual(NUM);
  });

  it('TIME rejects a part above 32767 and still wraps large ones', () => {
    expect(calc('TIME(32768,0,0)')).toEqual(NUM);
    expect(calc('TIME(0,32768,0)')).toEqual(NUM);
    expect(calc('TIME(0,0,32768)')).toEqual(NUM);
    expect(calc('TIME(32767,0,0)')).toBeCloseTo(7 / 24, 12);
    expect(calc('TIME(25,0,0)')).toBeCloseTo(1 / 24, 12);
    expect(calc('TIME(1,-30,0)')).toBeCloseTo(0.5 / 24, 12);
  });
});
