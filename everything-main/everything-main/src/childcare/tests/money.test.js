import { describe, it, expect } from 'vitest';
import { parseMoney, formatMoney, centsToInput } from '../src/core/money.js';

describe('money', () => {
  it('parses what people type into cents', () => {
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('$1,234.50')).toBe(123450);
    expect(parseMoney('0.5')).toBe(50);
    expect(parseMoney('19.999')).toBe(2000);
    expect(parseMoney('-3.25')).toBe(-325);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
  });

  it('round-trips cents through the input format', () => {
    for (const c of [0, 5, 99, 100, 123456, -250]) expect(parseMoney(centsToInput(c))).toBe(c);
  });

  it('formats as currency', () => {
    expect(formatMoney(123450, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatMoney(NaN, 'USD', 'en-US')).toBe('$0.00');
  });
});
