import { describe, it, expect } from 'vitest';
import { parseMoney, centsToInput, formatMoney, formatMoneyShort, setMoneyDefaults } from '../src/core/money.js';

describe('parseMoney', () => {
  it('reads the usual ways of typing an amount', () => {
    const cases = [
      ['1,234.50', 123450],
      ['$12', 1200],
      ['12.5', 1250],
      ['-3', -300],
      ['-$5.00', -500],
      ['(5.00)', -500],
      ['1,234', 123400],
      ['0.995', 100],
      ['', null],
      ['abc', null],
    ];
    for (const [text, cents] of cases) expect(parseMoney(text), text).toBe(cents);
  });

  it('reads a decimal comma, as phone keypads in many countries type it', () => {
    expect(parseMoney('12,50')).toBe(1250);
    expect(parseMoney('12,5')).toBe(1250);
    expect(parseMoney('1.234,50')).toBe(123450);
    expect(parseMoney('1 234,50 €')).toBe(123450);
  });

  it('reads signs wherever the currency symbol is', () => {
    expect(parseMoney('$-5')).toBe(-500);
    expect(parseMoney('−5')).toBe(-500);
    expect(parseMoney('5 (approx)')).toBe(500);
    expect(parseMoney('$(5.00)')).toBe(-500);
  });

  it('rounds numbers by their decimal value', () => {
    expect(parseMoney(1.005)).toBe(101);
    expect(parseMoney(12)).toBe(1200);
    expect(centsToInput(parseMoney('12,50'))).toBe('12.50');
  });
});

describe('formatMoney', () => {
  it('keeps working when settings hold a currency code that does not exist', () => {
    setMoneyDefaults({ currency: 'XX' });
    expect(formatMoney(12345)).toMatch(/123\.45/);
    expect(() => formatMoney(100, 'BAD')).not.toThrow();
    expect(() => formatMoneyShort(1234500, 'BAD')).not.toThrow();
    setMoneyDefaults({ currency: 'EUR' });
    expect(formatMoney(100, undefined, 'en-US')).toBe('€1.00');
    setMoneyDefaults({ currency: 'USD' });
  });
});
