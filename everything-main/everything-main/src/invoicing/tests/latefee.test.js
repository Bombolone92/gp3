import { describe, it, expect } from 'vitest';
import {
  lateFeePolicy, lateFeeText, lateFeeAmount, lateFeeItemName, balanceWithLateFee,
} from '../src/lib/latefee.js';

const settings = { lateFee: { type: 'percent', value: 2 } };

const invoice = (over = {}) => ({
  kind: 'invoice',
  status: 'sent',
  currency: 'USD',
  items: [{ qty: 1, rate: 1000 }],
  payments: [],
  ...over,
});

describe('lateFeePolicy', () => {
  it('resolves the global policy and normalizes junk to none', () => {
    expect(lateFeePolicy(settings)).toEqual({ type: 'percent', value: 2 });
    expect(lateFeePolicy({ lateFee: { type: 'none', value: 0 } })).toBeNull();
    expect(lateFeePolicy({ lateFee: { type: 'percent', value: 0 } })).toBeNull();
    expect(lateFeePolicy({})).toBeNull();
  });

  it("prefers the client's own policy, including an explicit none", () => {
    expect(lateFeePolicy(settings, { lateFee: { type: 'fixed', value: 25 } }))
      .toEqual({ type: 'fixed', value: 25 });
    // "Never charge this client" beats the global policy.
    expect(lateFeePolicy(settings, { lateFee: { type: 'none', value: 0 } })).toBeNull();
    // No override at all inherits.
    expect(lateFeePolicy(settings, { lateFee: '' })).toEqual({ type: 'percent', value: 2 });
    expect(lateFeePolicy(settings, {})).toEqual({ type: 'percent', value: 2 });
  });
});

describe('lateFeeText', () => {
  it('discloses a percent or a fixed amount per month', () => {
    expect(lateFeeText({ type: 'percent', value: 2 }, 'USD'))
      .toBe('A late fee of 2% per month applies after the due date.');
    // The exact symbol is the locale's business; the sentence is ours.
    expect(lateFeeText({ type: 'fixed', value: 25 }, 'USD'))
      .toMatch(/^A late fee of \S*25\.00 per month applies after the due date\.$/);
    expect(lateFeeText(null, 'USD')).toBe('');
  });
});

describe('lateFeeAmount', () => {
  it('charges a percentage of the open balance', () => {
    const doc = invoice({ payments: [{ amount: 400 }] });
    expect(lateFeeAmount({ type: 'percent', value: 2 }, doc)).toBe(12); // 2% of 600
  });

  it('charges the flat amount whatever the balance', () => {
    expect(lateFeeAmount({ type: 'fixed', value: 25 }, invoice())).toBe(25);
  });

  it('charges the percentage on the late part of a payment plan when told the date', () => {
    const plan = invoice({
      items: [{ qty: 1, rate: 3000 }],
      schedule: [
        { id: 'a', dueDate: '2026-07-01', type: 'percent', value: 50 },
        { id: 'b', dueDate: '2026-09-01', type: 'percent', value: 50 },
      ],
    });
    // 2% of the $1,500 that is late as of Aug 4, not of the $3,000 owed.
    expect(lateFeeAmount({ type: 'percent', value: 2 }, plan, '2026-08-04')).toBe(30);
    // Without a date, the whole open balance, exactly as before.
    expect(lateFeeAmount({ type: 'percent', value: 2 }, plan)).toBe(60);
    expect(lateFeeAmount({ type: 'fixed', value: 25 }, plan, '2026-08-04')).toBe(25);
    // Nothing late yet, nothing to charge.
    expect(lateFeeAmount({ type: 'percent', value: 2 }, plan, '2026-06-01')).toBe(0);
    expect(lateFeeAmount({ type: 'fixed', value: 25 }, plan, '2026-06-01')).toBe(0);
  });

  it('charges nothing on a settled invoice or without a policy', () => {
    expect(lateFeeAmount({ type: 'percent', value: 2 }, invoice({ payments: [{ amount: 1000 }] }))).toBe(0);
    expect(lateFeeAmount(null, invoice())).toBe(0);
  });
});

describe('balanceWithLateFee', () => {
  it('is plain balance + fee when nothing prorates', () => {
    const doc = invoice({ payments: [{ amount: 400 }] });
    expect(balanceWithLateFee(doc, 25)).toBe(625);
  });

  it('accounts for a whole-document percent discount prorating over the fee', () => {
    // Balance 900 (10% off 1000); the $25 fee line is discounted with every
    // other line, so the true delta is $22.50 — the confirm dialog used to
    // promise $925 while the invoice went on to say $922.50.
    const doc = invoice({ discountType: 'percent', discountValue: 10 });
    expect(balanceWithLateFee(doc, 25)).toBe(922.5);
  });

  it('leaves the fee line out of the document taxes', () => {
    const doc = invoice({ taxes: [{ label: 'VAT', rate: 20 }] });
    // 1000 + 20% VAT = 1200; the fee itself must land tax-exempt.
    expect(balanceWithLateFee(doc, 25)).toBe(1225);
  });
});

describe('lateFeeItemName', () => {
  it('labels the line clearly', () => {
    expect(lateFeeItemName({ type: 'percent', value: 2 })).toBe('Late fee (2%)');
    expect(lateFeeItemName({ type: 'fixed', value: 25 })).toBe('Late fee');
  });
});
