import { describe, it, expect } from 'vitest';
import { parseDate, parseInput, ymdToSerial, getLocale, setLocale } from '../src/core/format.js';
import { calc } from './helpers/calc.js';

describe('ordinary spaces between date components', () => {
  it('reads month-first and day-first dates with repeated spaces', () => {
    for (const text of ['August  19,   2024', '19   August  2024', 'Aug   19  2024']) {
      expect(parseDate(text)?.serial).toBe(ymdToSerial(2024, 8, 19));
      expect(parseInput(text).v).toBe(ymdToSerial(2024, 8, 19));
      expect(calc(`VALUE("${text}")`)).toBe(ymdToSerial(2024, 8, 19));
      expect(calc(`DATEVALUE("${text}")`)).toBe(ymdToSerial(2024, 8, 19));
    }
  });

  it('uses the supplied current year when none is written', () => {
    expect(parseDate('November   7', new Date(2032, 5, 10))?.serial).toBe(ymdToSerial(2032, 11, 7));
    expect(calc('MONTH(VALUE(TEXT(DATE(2024,8,1),"mmm ")&" 19"))')).toBe(8);
  });

  it('retains localized month recognition', () => {
    const previous = getLocale();
    setLocale('de-DE');
    try {
      expect(parseDate('19.   März   2024')?.serial).toBe(ymdToSerial(2024, 3, 19));
      expect(calc('VALUE("19.   März   2024")')).toBe(ymdToSerial(2024, 3, 19));
    } finally { setLocale(previous); }
  });

  it('does not join split numbers or accept impossible dates', () => {
    for (const text of ['August 1 9 2024', 'August 19 20 24', 'February  30  2024', 'August\t19 2024']) {
      expect(parseDate(text)).toBeNull();
      expect(calc(`VALUE("${text}")`)).toEqual({ error: '#VALUE!' });
    }
    expect(parseInput("'August  19 2024").v).toBe('August  19 2024');
  });
});
