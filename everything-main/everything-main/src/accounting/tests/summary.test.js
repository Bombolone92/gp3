import { describe, it, expect } from 'vitest';
import { makeBooks } from './helpers/books.js';

describe('home summary', () => {
  it('moves an invoice to overdue at midnight without any change to the books', () => {
    const { s, customer, service } = makeBooks({ today: '2026-06-15' });
    let day = '2026-06-15';
    s.clock = () => day;
    s.saveTxn({ type: 'invoice', date: '2026-06-01', dueDate: '2026-06-15', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 1000 }] });
    expect(s.summary().overdueCount).toBe(0);
    day = '2026-06-16'; // the tab stays open past midnight
    expect(s.summary().overdueCount).toBe(1);
  });
});
