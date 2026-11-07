import { describe, it, expect } from 'vitest';
import {
  reminderStage, daysLate, dayCount, reminderValues, lastReminder, reminderNote, reminders,
  REMINDER_STAGES,
} from '../src/lib/reminders.js';
import { buildMessage, TEMPLATE_KEYS, DEFAULT_TEMPLATES, placeholdersFor } from '../src/lib/message.js';

const TODAY = '2026-08-04';

const invoice = (over = {}) => ({
  kind: 'invoice',
  number: 'INV-0042',
  currency: 'USD',
  issueDate: '2026-06-20',
  dueDate: '2026-07-20',
  items: [{ qty: 1, rate: 1000 }],
  taxRate: 0,
  discountType: 'none',
  discountValue: 0,
  status: 'sent',
  payments: [],
  ...over,
});

describe('reminderStage', () => {
  it('is gentle before and on the due date', () => {
    expect(reminderStage(invoice({ dueDate: '2026-08-20' }), TODAY)).toBe('reminderUpcoming');
    expect(reminderStage(invoice({ dueDate: TODAY }), TODAY)).toBe('reminderUpcoming');
  });

  it('escalates the day after the due date and again at 30 days', () => {
    expect(reminderStage(invoice({ dueDate: '2026-08-03' }), TODAY)).toBe('reminderDue');
    expect(reminderStage(invoice({ dueDate: '2026-07-06' }), TODAY)).toBe('reminderDue');   // 29 days
    expect(reminderStage(invoice({ dueDate: '2026-07-05' }), TODAY)).toBe('reminderLate');  // 30 days
    expect(reminderStage(invoice({ dueDate: '2025-01-01' }), TODAY)).toBe('reminderLate');
  });

  it('treats a missing due date as not yet late', () => {
    expect(reminderStage(invoice({ dueDate: '' }), TODAY)).toBe('reminderUpcoming');
    expect(daysLate(invoice({ dueDate: '' }), TODAY)).toBe(0);
  });

  it('has a template and a label for every stage', () => {
    for (const key of Object.keys(REMINDER_STAGES)) {
      expect(TEMPLATE_KEYS).toContain(key);
      expect(DEFAULT_TEMPLATES[key].subject).toBeTruthy();
      expect(DEFAULT_TEMPLATES[key].body).toBeTruthy();
    }
  });
});

describe('dayCount', () => {
  it('reads as prose in singular and plural', () => {
    expect(dayCount(1)).toBe('1 day');
    expect(dayCount(12)).toBe('12 days');
    expect(dayCount(0)).toBe('0 days');
  });
});

describe('reminderValues', () => {
  it('offers days overdue only when overdue, and time left only before due', () => {
    expect(reminderValues(invoice({ dueDate: '2026-08-03' }), TODAY)).toEqual({ days: '1 day', daysUntil: '' });
    expect(reminderValues(invoice({ dueDate: '2026-08-07' }), TODAY)).toEqual({ days: '', daysUntil: '3 days' });
    expect(reminderValues(invoice({ dueDate: TODAY }), TODAY)).toEqual({ days: '', daysUntil: '' });
  });
});

describe('reminder history', () => {
  const withReminders = (dates) => invoice({
    reminders: dates.map((date, i) => ({ id: `r${i}`, date, stage: 'reminderDue', how: 'mail', at: i })),
  });

  it('reads empty history safely', () => {
    expect(reminders(invoice())).toEqual([]);
    expect(reminders(invoice({ reminders: 'nope' }))).toEqual([]);
    expect(lastReminder(invoice())).toBe(null);
    expect(reminderNote(invoice(), TODAY)).toBe('Not reminded yet');
  });

  it('finds the latest reminder whatever order they are stored in', () => {
    expect(lastReminder(withReminders(['2026-07-01', '2026-08-01', '2026-07-15'])).date).toBe('2026-08-01');
  });

  it('distinguishes a first nudge from a third', () => {
    expect(reminderNote(withReminders([TODAY]), TODAY)).toBe('Reminded today');
    expect(reminderNote(withReminders(['2026-08-03']), TODAY)).toBe('Reminded yesterday');
    expect(reminderNote(withReminders(['2026-07-30']), TODAY)).toBe('Reminded 5 days ago');
    expect(reminderNote(withReminders(['2026-07-01', '2026-07-20', '2026-07-30']), TODAY))
      .toBe('Reminded 3×, last 5 days ago');
  });
});

describe('reminder messages', () => {
  const client = { id: 'c1', name: 'Maya Chen', email: 'maya@northwind.example' };
  const settings = { business: { name: 'Aurora Studio' } };

  it('names how late the invoice is and what is still due', () => {
    const doc = invoice({ dueDate: '2026-07-05', payments: [{ amount: 400 }] });
    const stage = reminderStage(doc, TODAY);
    const { subject, body } = buildMessage(doc, client, settings, {
      templateKey: stage,
      link: 'https://x.puter.site/a.html',
      extra: reminderValues(doc, TODAY),
    });
    expect(stage).toBe('reminderLate');
    expect(subject).toContain('30 days overdue');
    expect(body).toContain('30 days overdue');
    expect(body).toMatch(/600/);            // the balance, not the total
    expect(body).not.toContain('{');
  });

  it('stays friendly before the due date and mentions no lateness', () => {
    const doc = invoice({ dueDate: '2026-08-07' });
    const { subject, body } = buildMessage(doc, client, settings, {
      templateKey: reminderStage(doc, TODAY),
      extra: reminderValues(doc, TODAY),
    });
    expect(subject).toBe('Invoice INV-0042 is due Aug 7, 2026');
    expect(body).toContain('friendly reminder');
    expect(body).not.toMatch(/overdue/);
  });

  it('offers {days} in the late stages and {daysUntil} before due', () => {
    expect(placeholdersFor('reminderLate').map(([k]) => k)).toContain('days');
    expect(placeholdersFor('reminderUpcoming').map(([k]) => k)).toContain('daysUntil');
  });
});
