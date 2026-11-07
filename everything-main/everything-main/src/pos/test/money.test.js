import { describe, it, expect } from 'vitest';
import {
  formatMoney, parseAmount, parseRate, currencySymbol, discountTypeChoices, CURRENCIES,
} from '../src/lib/money.js';

describe('parseAmount', () => {
  it('parses plain and decimal amounts', () => {
    expect(parseAmount('12')).toBe(12);
    expect(parseAmount('12.4')).toBe(12.4);
    expect(parseAmount(' 3.999 ')).toBe(4); // rounded to cents
  });

  it('accepts a comma decimal separator', () => {
    expect(parseAmount('12,50')).toBe(12.5);
    expect(parseAmount('1,5')).toBe(1.5);
    expect(parseAmount('0,005')).toBe(0.01);   // a zero can't be a grouped thousand
  });

  it('understands grouped thousands where only grouping fits', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('1,000,000')).toBe(1000000);
    expect(parseAmount('1.000.000')).toBe(1000000);
  });

  it('re-asks rather than guess a lone three-digit comma group', () => {
    // '1,000' is a thousand on one keyboard and 1.000 on another; either
    // silent guess books an amount a thousand times off for somebody -
    // this parser counts drawers.
    expect(parseAmount('1,000')).toBeNull();
    expect(parseAmount('12,345')).toBeNull();
  });

  it('rejects negatives, junk, and empty input', () => {
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount('1e309')).toBeNull();
  });

  it('accepts zero', () => {
    expect(parseAmount('0')).toBe(0);
  });

  it('rounds typed half-cents up regardless of float dust', () => {
    // 1.005 × 100 is 100.4999… as a float: a bare Math.round sent these
    // three down while '4.005' went up - same-shaped input, different rule.
    expect(parseAmount('1.005')).toBe(1.01);
    expect(parseAmount('0.145')).toBe(0.15);
    expect(parseAmount('0.285')).toBe(0.29);
    expect(parseAmount('4.005')).toBe(4.01);
  });

  it('rejects magnitudes beyond any real amount', () => {
    // Cents on amounts like 1e21 leave the exact-integer range, and the
    // cart math is only honest while every figure stays inside it.
    expect(parseAmount('1e21')).toBeNull();
    expect(parseAmount('99999999999999999999')).toBeNull();
    expect(parseAmount('999999999.99')).toBe(999999999.99); // the cap itself is fine
  });
});

describe('parseRate', () => {
  it('keeps the third decimal a money parser would round away', () => {
    expect(parseRate('8.875')).toBe(8.875);   // NYC survives the trip
    expect(parseRate('8,875')).toBe(8.875);   // comma-decimal keyboards too
    expect(parseRate('20')).toBe(20);
    expect(parseRate('0')).toBe(0);
    expect(parseRate('100')).toBe(100);
  });

  it('refuses what no till charges', () => {
    expect(parseRate('150')).toBe(null);
    expect(parseRate('-1')).toBe(null);
    expect(parseRate('')).toBe(null);
    expect(parseRate('ten')).toBe(null);
    expect(parseRate(null)).toBe(null);
  });

  it('rounds a typed fourth decimal half-up regardless of float dust', () => {
    expect(parseRate('0.5005')).toBe(0.501);   // 0.5005 × 1000 is 500.4999…
    expect(parseRate('0.5015')).toBe(0.502);
  });
});

describe('formatMoney', () => {
  it('formats every supported currency without throwing', () => {
    for (const c of CURRENCIES) {
      expect(typeof formatMoney(1234.5, c.code)).toBe('string');
    }
  });

  it('contains the numeric value', () => {
    expect(formatMoney(12.4, 'USD')).toMatch(/12/);
  });

  it('survives non-numeric input', () => {
    expect(typeof formatMoney(undefined, 'USD')).toBe('string');
    expect(formatMoney(NaN, 'USD')).toBe(formatMoney(0, 'USD'));
  });

  it('writes a negative with the minus sign the app uses, not the locale hyphen', () => {
    // Every hand-negated figure in the app - a discount row, cash paid out,
    // a stock movement - writes U+2212. A refund handed straight to Intl
    // used to come back with a hyphen, so one refund showed both marks.
    expect(formatMoney(-7.01, 'USD')).toContain('\u2212');
    expect(formatMoney(-7.01, 'USD')).not.toContain('-');
    for (const c of CURRENCIES) {
      expect(formatMoney(-1234.5, c.code)).not.toContain('-');
    }
  });

  it('keeps the digits and the symbol a negative had', () => {
    const negative = formatMoney(-7.01, 'USD');
    expect(negative).toMatch(/7[.,]01/);
    expect(negative).toContain(currencySymbol('USD'));
    // Nothing but the sign is added.
    expect(negative.replace('\u2212', '')).toBe(formatMoney(7.01, 'USD'));
  });

  it('never shows zero with a minus sign', () => {
    // Refund math negates cents, so an all-zero refund arrives here as -0,
    // which Intl would otherwise render "-$0.00".
    expect(formatMoney(-0, 'USD')).toBe(formatMoney(0, 'USD'));
  });

  it('shows zero-decimal currencies exactly, never silently rounded', () => {
    // The app stores hundredths for every currency; a 15%-discounted JPY
    // sale lands on fractional yen. Intl's zero-digit default printed ¥519
    // over a stored 518.93 - receipt, CSV, and drawer all disagreeing.
    expect(formatMoney(518.93, 'JPY')).toMatch(/518[.,]93/);
    expect(formatMoney(519, 'JPY')).toMatch(/519(?![.,]?\d)/);
    expect(formatMoney(0.4, 'KRW')).toMatch(/0[.,]4/);
  });
});

describe('currencySymbol', () => {
  it('gives every supported currency a short, non-empty mark', () => {
    for (const c of CURRENCIES) {
      const symbol = currencySymbol(c.code);
      expect(symbol.length).toBeGreaterThan(0);
      // It labels a segmented button, so it has to stay label-sized.
      expect(symbol.length).toBeLessThanOrEqual(4);
      expect(symbol).not.toMatch(/[\d.,\s]/);
    }
  });

  it('is the mark the formatted amounts already carry', () => {
    expect(formatMoney(5, 'USD')).toContain(currencySymbol('USD'));
    expect(formatMoney(5, 'JPY')).toContain(currencySymbol('JPY'));
  });

  it('names the code rather than invent a symbol it cannot read', () => {
    // Intl refuses the code, so amounts print bare; "$" would name a
    // currency the figures beside it are not in.
    expect(currencySymbol('not-a-currency')).toBe('not-a-currency');
  });
});

describe('discountTypeChoices', () => {
  it('offers percent and fixed, in that order, with names to announce', () => {
    const choices = discountTypeChoices('USD');
    expect(choices.map((c) => c.value)).toEqual(['percent', 'fixed']);
    expect(choices[0].label).toBe('%');
    expect(choices[1].label).toBe(currencySymbol('USD'));
    // A bare "%" or "$" is readable but not announceable.
    for (const c of choices) expect(c.name.length).toBeGreaterThan(1);
  });

  it('follows the store\'s currency', () => {
    expect(discountTypeChoices('EUR')[1].label).toBe(currencySymbol('EUR'));
    expect(discountTypeChoices('EUR')[1].label)
      .not.toBe(discountTypeChoices('JPY')[1].label);
  });
});
