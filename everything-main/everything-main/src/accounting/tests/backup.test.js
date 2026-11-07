import { describe, it, expect } from 'vitest';
import { makeBooks } from './helpers/books.js';
import { exportBackup, restoreBackup, validateBackup, eraseAll } from '../src/lib/backup.js';
import { Store } from '../src/lib/store.js';

describe('backup', () => {
  it('round-trips the books', () => {
    const { s, customer, service } = makeBooks();
    s.saveTxn({ type: 'invoice', date: '2026-06-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 2, rate: 1000 }] });
    const data = JSON.parse(JSON.stringify(exportBackup(s)));
    const t = new Store();
    restoreBackup(t, data);
    expect(t.txns.size).toBe(1);
    expect(t.contacts.size).toBe(s.contacts.size);
    expect(t.ledger().imbalance()).toBe(0);
    expect(t.settings.company.name).toBe('Test Co');
  });
  it('rejects damaged files before writing', () => {
    expect(() => validateBackup({})).toThrow(/not an Accounting backup/);
    expect(() => validateBackup({ format: 'puter-bookkeeping-backup', version: 1, collections: { txns: [{ id: 'a', type: 'nope' }] } })).toThrow(/unknown type/);
    expect(() => validateBackup({ format: 'puter-bookkeeping-backup', version: 1, collections: { txns: [{ type: 'invoice' }] } })).toThrow(/valid id/);
    const { s } = makeBooks();
    const before = s.accounts.size;
    expect(() => restoreBackup(s, { format: 'x' })).toThrow();
    expect(s.accounts.size).toBe(before);
  });
  it('erases everything', () => {
    const { s } = makeBooks();
    eraseAll(s);
    expect(s.accounts.size + s.contacts.size + s.items.size).toBe(0);
  });
});
