import { describe, it, expect } from 'vitest';
import { parseMoney, parseDecimal, formatMoney, formatMoneyShort, centsToInput } from '../src/core/money.js';

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

  it('understands a decimal comma', () => {
    expect(parseMoney('12,50')).toBe(1250);
    expect(parseMoney('12,5')).toBe(1250);
    expect(parseMoney('1.234,56 €')).toBe(123456);
    expect(parseMoney('1 234,56')).toBe(123456);
    expect(parseMoney('1,234')).toBe(123400);
    expect(parseMoney('1,234,567.8')).toBe(123456780);
    expect(parseMoney('1.234.567')).toBe(123456700);
    expect(parseMoney(0.285)).toBe(29);
  });

  it('parses quantities and rates with either decimal mark', () => {
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal('8,25')).toBe(8.25);
    expect(parseDecimal('1,000')).toBe(1000);
    expect(parseDecimal('1,234.5')).toBe(1234.5);
    expect(parseDecimal('2')).toBe(2);
    expect(parseDecimal('-1.5')).toBe(-1.5);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('x')).toBeNull();
  });

  it('round-trips cents through the input format', () => {
    for (const c of [0, 5, 99, 100, 123456, -250]) expect(parseMoney(centsToInput(c))).toBe(c);
  });

  it('formats as currency', () => {
    expect(formatMoney(123450, 'USD', 'en-US')).toBe('$1,234.50');
    expect(formatMoney(NaN, 'USD', 'en-US')).toBe('$0.00');
  });

  it('formats compact amounts without a trailing .0', () => {
    expect([99, 5000, 1234500, 100000000].map((c) => formatMoneyShort(c, 'USD', 'en-US'))).toEqual(['$1', '$50', '$12.3K', '$1M']);
  });
});
