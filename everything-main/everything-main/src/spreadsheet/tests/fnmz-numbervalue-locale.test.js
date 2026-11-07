import { describe, it, expect } from 'vitest';
import { getLocale, setLocale } from '../src/core/format.js';
import { calc } from './helpers/calc.js';

// NUMBERVALUE without separators reads the text with the regional format's own decimal and group marks, as
// documented (separators from the current locale are used), so "1,5" is one and a half in German
// rather than fifteen.

const VALUE = { error: '#VALUE!' };

function under(locale, fn) {
  const previous = getLocale();
  setLocale(locale);
  try { return fn(); } finally { setLocale(previous); }
}

describe('NUMBERVALUE with the separators left out', () => {
  it('takes the regional format\'s decimal and group marks', () => {
    under('de-DE', () => {
      expect(calc('NUMBERVALUE("1,5")')).toBe(1.5);
      expect(calc('NUMBERVALUE("1.234,5")')).toBe(1234.5);
      expect(calc('NUMBERVALUE("2,5%")')).toBe(0.025);
      expect(calc('NUMBERVALUE("1 234,5")')).toBe(1234.5);
      expect(calc('NUMBERVALUE("1.5")')).toBe(15); // the point groups thousands in German
      expect(calc('NUMBERVALUE("1,2,3")')).toEqual(VALUE);
      expect(calc('NUMBERVALUE("1,5")=VALUE("1,5")')).toBe(true);
    });
    under('fr-FR', () => {
      expect(calc('NUMBERVALUE("1 234,5")')).toBe(1234.5);
      expect(calc('NUMBERVALUE("1,5")')).toBe(1.5);
    });
    under('en-IN', () => {
      expect(calc('NUMBERVALUE("12,34,567.5")')).toBe(1234567.5);
    });
  });

  it('reads English text as before, and lets explicit separators override the regional format', () => {
    expect(calc('NUMBERVALUE("1,234.5")')).toBe(1234.5);
    expect(calc('NUMBERVALUE("2.5%")')).toBe(0.025);
    expect(calc('NUMBERVALUE("1,5")')).toBe(15);
    expect(calc('NUMBERVALUE("1.234,5",",",".")')).toBe(1234.5);
    under('de-DE', () => {
      expect(calc('NUMBERVALUE("1,234.5",".",",")')).toBe(1234.5);
      expect(calc('NUMBERVALUE("1.5",".")')).toBe(1.5);
    });
  });
});
