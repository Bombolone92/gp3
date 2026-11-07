import { describe, it, expect } from 'vitest';
import { getLocale, setLocale, parseInput, parseTime } from '../src/core/format.js';
import { calc } from './helpers/calc.js';

// Under a regional format whose decimal mark is a comma, numbers turned into text and read back agree
// with the cell: FIXED and DOLLAR print 1.234,5 as TEXT and the cell do, a time with fractional seconds
// reads back with the comma TEXT printed, and text with a point before exactly three digits ("1.234") is
// the thousand a typed cell reads it as, in VALUE and in a criterion alike.

const VALUE = { error: '#VALUE!' };

function under(locale, fn) {
  const previous = getLocale();
  setLocale(locale);
  try { return fn(); } finally { setLocale(previous); }
}

describe('FIXED and DOLLAR', () => {
  it('print in the regional format, so VALUE reads them back', () => {
    under('de-DE', () => {
      expect(calc('FIXED(1234.5,1)')).toBe('1.234,5');
      expect(calc('FIXED(1234.5,1,TRUE)')).toBe('1234,5');
      expect(calc('FIXED(1234.5,1)=TEXT(1234.5,"#,##0.0")')).toBe(true);
      expect(calc('DOLLAR(1234.5)')).toBe('1.234,50\u00a0€');
      expect(calc('DOLLAR(-1234.5)')).toBe('(1.234,50\u00a0€)');
      expect(calc('VALUE(FIXED(1234.5,1))')).toBe(1234.5);
      expect(calc('VALUE(DOLLAR(1234.5))')).toBe(1234.5);
      expect(calc('VALUE(DOLLAR(-1234.5))')).toBe(-1234.5);
      expect(calc('FIXED(2.5,0)')).toBe('3');
      expect(calc('FIXED(-0.001,2)')).toBe('0,00');
      expect(calc('FIXED(1E+22,2)')).toBe('10.000.000.000.000.000.000.000,00');
    });
    under('fr-FR', () => {
      expect(calc('FIXED(1234.5,1)')).toMatch(/^1[   ]234,5$/); // grouped by the space French writes
      expect(calc('FIXED(1234.5,1)=TEXT(1234.5,"#,##0.0")')).toBe(true);
      expect(calc('VALUE(FIXED(1234.5,1))')).toBe(1234.5);
    });
    expect(calc('FIXED(1234.5,1)')).toBe('1,234.5');
    expect(calc('DOLLAR(1234.5)')).toBe('$1,234.50');
    expect(calc('DOLLAR(-1234.567,0)')).toBe('($1,235)');
  });
});

describe('a time with fractional seconds after the regional decimal mark', () => {
  it('reads back what TEXT printed, in TIMEVALUE, VALUE and a typed cell', () => {
    const half = 0.5 + 0.5 / 86400;
    under('de-DE', () => {
      expect(calc('TEXT(0.5+0.5/86400,"h:mm:ss.0")')).toBe('12:00:00,5');
      expect(calc('TIMEVALUE("12:00:00,5")')).toBeCloseTo(half, 12);
      expect(calc('VALUE("12:00:00,5")')).toBeCloseTo(half, 12);
      expect(calc('TIMEVALUE(TEXT(0.5+0.5/86400,"h:mm:ss.0"))')).toBeCloseTo(half, 12);
      expect(calc('A1', { A1: '12:00:00,5' })).toBeCloseTo(half, 12);
      expect(parseInput('12:00:00,5').fmt).toBe('time');
      expect(parseTime('1:30:00,25')).toBeCloseTo((5400 + 0.25) / 86400, 12);
      expect(calc('TIMEVALUE("12:00:00.5")')).toBeCloseTo(half, 12); // the point is read everywhere
    });
    expect(calc('TIMEVALUE("12:00:00,5")')).toEqual(VALUE); // no fraction in English, where the comma is no decimal mark
    expect(calc('A1', { A1: '12:00:00,5' })).toBe('12:00:00,5');
    expect(calc('TIMEVALUE("12:00:00.5")')).toBeCloseTo(half, 12);
  });
});

describe('text with a point before exactly three digits', () => {
  it('is the thousand a typed cell reads under a comma-decimal format, in VALUE and in a criterion', () => {
    const cells = { A1: 1, A2: 2, A3: 3000 };
    under('de-DE', () => {
      expect(calc('VALUE("1.234")')).toBe(1234);
      expect(calc('VALUE("12.345")')).toBe(12345);
      expect(calc('VALUE("1.234")=A1', { A1: '1.234' })).toBe(true);
      expect(calc('VALUE("1.2345")')).toBe(1.2345);
      expect(calc('VALUE("1.5")')).toBe(1.5);
      expect(calc('VALUE("0.5")')).toBe(0.5);
      expect(calc('VALUE(".234")')).toBe(0.234);
      expect(calc('VALUE("1.234%")')).toBe(12.34);
      expect(calc('COUNTIF(A1:A3,">1.500")', cells)).toBe(1);
      expect(calc('COUNTIF(A1:A3,">1.5")', cells)).toBe(2);
      expect(calc('COUNTIF(A1:A3,A4)', { ...cells, A4: "'2.000" })).toBe(0);
      expect(calc('COUNTIF(A1:A4,3000)', { ...cells, A4: "'3.000" })).toBe(2);
      expect(calc('1.234*2')).toBe(2.468); // a formula literal keeps its period
    });
    expect(calc('VALUE("1.234")')).toBe(1.234);
    expect(calc('COUNTIF(A1:A3,">1.500")', cells)).toBe(2);
    expect(calc('COUNTIF(A1:A4,3)', { ...cells, A4: "'3.000" })).toBe(1);
  });
});
