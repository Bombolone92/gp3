import { describe, it, expect } from 'vitest';
import { makeBooks } from './helpers/books.js';
import { search } from '../src/lib/search.js';
import { validateTxn } from '../src/lib/txn.js';

describe('search', () => {
  it('finds transactions by number, name, and amount, plus contacts and reports', () => {
    const { s, customer, service } = makeBooks();
    s.saveTxn({ type: 'invoice', num: '1042', date: '2026-06-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 12345 }] });
    const byNum = search(s, '1042');
    expect(byNum.find((g) => g.group === 'Transactions').items[0].label).toBe('Invoice 1042');
    const byAmount = search(s, '123.45');
    expect(byAmount.find((g) => g.group === 'Transactions').items.length).toBe(1);
    const byName = search(s, 'acme');
    expect(byName.some((g) => g.group === 'Contacts')).toBe(true);
    expect(search(s, 'balance sheet').find((g) => g.group === 'Reports').items[0].route).toBe('report/bs');
    expect(search(s, 'new invoice').find((g) => g.group === 'Create').items[0].route).toBe('new/invoice');
    expect(search(s, '')).toEqual([]);
  });
});

describe('validation', () => {
  it('asks for what each type needs', () => {
    expect(validateTxn({ type: 'invoice', date: '2026-01-01', lines: [] })).toEqual(expect.arrayContaining(['Choose a customer.', 'Add at least one line.']));
    expect(validateTxn({ type: 'expense', date: '2026-01-01', lines: [{ amount: 100 }] })).toEqual(expect.arrayContaining(['Choose the account this was paid from.', 'Choose a category on every line with an amount.']));
    expect(validateTxn({ type: 'transfer', date: '2026-01-01', fromId: 'a', toId: 'a', amount: 1 })).toContain('Transfer between two different accounts.');
    expect(validateTxn({ type: 'journal', date: '2026-01-01', lines: [{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 90 }] })).toContain('Debits and credits must be equal.');
    expect(validateTxn({ type: 'journal', date: '2026-01-01', lines: [{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 100 }] })).toEqual([]);
    expect(validateTxn({ type: 'payment', date: '2026-01-01', contactId: 'c', amount: 50, applied: [{ txnId: 'x', amount: 60 }] })).toContain('The amounts applied add up to more than the payment.');
  });
});
