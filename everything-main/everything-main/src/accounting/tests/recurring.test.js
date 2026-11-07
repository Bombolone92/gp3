import { describe, it, expect } from 'vitest';
import { dueDates, afterCreating, isFinished, describeSchedule } from '../src/lib/recurring.js';
import { runRecurring } from '../src/lib/recurring-run.js';
import { makeBooks } from './helpers/books.js';

describe('recurring schedules', () => {
  it('lists due dates, keeping the anchor day through short months', () => {
    const r = { interval: 'month', every: 1, startDate: '2026-01-31', nextDate: '2026-01-31', mode: 'scheduled', count: 0 };
    expect(dueDates(r, '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
  it('stops at the end date and the count', () => {
    expect(dueDates({ interval: 'week', every: 2, nextDate: '2026-01-01', endDate: '2026-02-01', mode: 'scheduled' }, '2026-12-31')).toEqual(['2026-01-01', '2026-01-15', '2026-01-29']);
    expect(dueDates({ interval: 'day', every: 1, nextDate: '2026-01-01', maxCount: 3, count: 1, mode: 'scheduled' }, '2026-12-31')).toEqual(['2026-01-01', '2026-01-02']);
  });
  it('caps catch-up after a long pause', () => {
    expect(dueDates({ interval: 'day', every: 1, nextDate: '2020-01-01', mode: 'scheduled' }, '2026-01-01').length).toBe(24);
  });
  it('advances after creating', () => {
    const r = afterCreating({ interval: 'month', every: 1, startDate: '2026-01-15', nextDate: '2026-01-15', count: 0 }, 2);
    expect(r.nextDate).toBe('2026-03-15');
    expect(r.count).toBe(2);
    expect(isFinished({ ...r, maxCount: 2 })).toBe(true);
    expect(describeSchedule({ interval: 'month', every: 3 })).toBe('Every 3 months');
  });
  it('creates invoices from a template with numbers and due dates', () => {
    const { s, customer, service } = makeBooks({ today: '2026-03-10' });
    s.put('recurring', { name: 'Retainer', type: 'invoice', interval: 'month', every: 1, startDate: '2026-01-01', nextDate: '2026-01-01', mode: 'scheduled', active: true, count: 0,
      template: { type: 'invoice', contactId: customer.id, terms: 'net15', lines: [{ itemId: service.id, qty: 1, rate: 50000 }] } });
    expect(runRecurring(s)).toBe(3);
    const invoices = s.txnList((t) => t.type === 'invoice');
    expect(invoices.map((t) => t.date).sort()).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(invoices.find((t) => t.date === '2026-02-01').dueDate).toBe('2026-02-16');
    expect(new Set(invoices.map((t) => t.num)).size).toBe(3);
    expect(runRecurring(s)).toBe(0);
    const r = [...s.recurring.values()][0];
    expect(r.nextDate).toBe('2026-04-01');
  });
  it('leaves reminders for a person to review', () => {
    const { s, customer } = makeBooks({ today: '2026-03-10' });
    s.put('recurring', { name: 'R', type: 'invoice', interval: 'month', every: 1, nextDate: '2026-03-01', mode: 'reminder', active: true, template: { type: 'invoice', contactId: customer.id, lines: [{ amount: 100 }] } });
    expect(runRecurring(s)).toBe(0);
  });
});

describe('recurring on several devices', () => {
  it('a second device with a stale schedule writes the same records, not duplicates', () => {
    const { s, customer } = makeBooks({ today: '2026-03-10' });
    const rule = s.put('recurring', { name: 'R', type: 'invoice', interval: 'month', every: 1, nextDate: '2026-03-01', mode: 'scheduled', active: true, count: 0, template: { type: 'invoice', contactId: customer.id, lines: [{ amount: 100 }] } });
    expect(runRecurring(s)).toBe(1);
    s.put('recurring', rule); // the other device still has the old nextDate
    runRecurring(s);
    expect(s.txnList((t) => t.type === 'invoice').length).toBe(1);
  });
});
