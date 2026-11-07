import { describe, it, expect } from 'vitest';
import { receiptMatches, hasCriteria } from '../src/lib/receipt-search.js';

const sale = {
  number: 1042,
  date: '2026-07-18',
  total: 21.55,
  customerName: 'Maya Lindqvist',
  payments: [{ method: 'cash', amount: 10 }, { method: 'card', amount: 11.55 }],
  lines: [
    { name: 'Café crème', qty: 1 },
    { name: 'Blue mug', qty: 1 },
  ],
};

describe('hasCriteria', () => {
  it('is false only when nothing was asked for', () => {
    expect(hasCriteria({})).toBe(false);
    expect(hasCriteria({ text: '  ' })).toBe(false);
    expect(hasCriteria({ text: 'mug' })).toBe(true);
    expect(hasCriteria({ method: 'card' })).toBe(true);
    expect(hasCriteria({ from: '2026-01-01' })).toBe(true);
  });
});

describe('receiptMatches', () => {
  it('matches the receipt number as a substring', () => {
    expect(receiptMatches(sale, { text: '1042' })).toBe(true);
    expect(receiptMatches(sale, { text: '104' })).toBe(true);
    expect(receiptMatches(sale, { text: '999' })).toBe(false);
  });

  it('matches product names, case- and accent-insensitive', () => {
    expect(receiptMatches(sale, { text: 'blue mug' })).toBe(true);
    expect(receiptMatches(sale, { text: 'cafe' })).toBe(true);
    expect(receiptMatches(sale, { text: 'croissant' })).toBe(false);
  });

  it('matches an exact amount, either sign', () => {
    expect(receiptMatches(sale, { text: '21.55' })).toBe(true);
    expect(receiptMatches(sale, { text: '21,55' })).toBe(true);
    expect(receiptMatches(sale, { text: '21.5' })).toBe(false);
    expect(receiptMatches({ ...sale, total: -21.55, lines: [] }, { text: '21.55' })).toBe(true);
  });

  it('matches the customer name', () => {
    expect(receiptMatches(sale, { text: 'lindqvist' })).toBe(true);
  });

  it('filters by payment method, any tender of a split counting', () => {
    expect(receiptMatches(sale, { method: 'card' })).toBe(true);
    expect(receiptMatches(sale, { method: 'cash' })).toBe(true);
    expect(receiptMatches(sale, { method: 'other' })).toBe(false);
    // Filter and text combine.
    expect(receiptMatches(sale, { text: 'mug', method: 'card' })).toBe(true);
    expect(receiptMatches(sale, { text: 'mug', method: 'other' })).toBe(false);
  });

  it('filters by an inclusive date window', () => {
    expect(receiptMatches(sale, { from: '2026-07-18', to: '2026-07-18' })).toBe(true);
    expect(receiptMatches(sale, { from: '2026-07-19' })).toBe(false);
    expect(receiptMatches(sale, { to: '2026-07-17' })).toBe(false);
  });

  it('reads legacy single-payment receipts for the method filter', () => {
    const legacy = { ...sale, payments: undefined, payment: { method: 'card' } };
    expect(receiptMatches(legacy, { method: 'card' })).toBe(true);
    expect(receiptMatches(legacy, { method: 'cash' })).toBe(false);
  });
});
