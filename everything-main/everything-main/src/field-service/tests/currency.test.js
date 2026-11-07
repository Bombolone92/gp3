import { describe, it, expect, afterEach } from 'vitest';
import { setMoneyDefaults, parseMoney, formatMoney, centsToInput } from '../src/core/money.js';
import { computeTotals } from '../src/core/totals.js';
import { invoiceStatus } from '../src/core/status.js';

afterEach(() => setMoneyDefaults({ currency: 'USD' }));

describe('currencies without cents', () => {
  it('rounds totals to whole yen, so the amount shown can be paid in full', () => {
    setMoneyDefaults({ currency: 'JPY' });
    const inv = { id: 'i', items: [{ qty: 1, unitPrice: parseMoney('1234') }], taxRate: 10, sentAt: '2026-10-01', dueDate: '2026-10-30' };
    const { total, tax } = computeTotals(inv);
    expect(tax % 100).toBe(0);
    expect(total % 100).toBe(0);
    expect(formatMoney(total, 'JPY', 'en-US')).toBe('¥1,357');
    expect(invoiceStatus(inv, '2026-10-12', [{ invoiceId: 'i', amount: parseMoney('1357') }])).toBe('paid');
  });

  it('edits whole yen without decimals', () => {
    setMoneyDefaults({ currency: 'JPY' });
    expect(centsToInput(parseMoney('1234'))).toBe('1234');
    expect(centsToInput(-50000)).toBe('-500');
    expect(parseMoney(centsToInput(123400))).toBe(123400);
  });

  it('keeps cents for other currencies', () => {
    setMoneyDefaults({ currency: 'EUR' });
    expect(computeTotals({ items: [{ qty: 1, unitPrice: 1234 }], taxRate: 10 }).tax).toBe(123);
    expect(parseMoney('12,34')).toBe(1234);
    expect(centsToInput(1200)).toBe('12.00');
  });
});
