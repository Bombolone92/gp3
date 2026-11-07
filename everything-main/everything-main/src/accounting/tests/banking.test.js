import { describe, it, expect } from 'vitest';
import { makeBooks } from './helpers/books.js';
import { ruleMatches, findRule, findMatches, draftFromLine, settleFromLine, suggestFromHistory } from '../src/lib/banking.js';
import { postings } from '../src/lib/txn.js';

function line(over) {
  return { id: 'L1', accountId: null, date: '2026-06-10', amount: -4900, desc: 'PIXEL CLOUD HOSTING 1234', status: 'review', ...over };
}

describe('bank rules', () => {
  const rule = { name: 'Hosting', direction: 'out', match: 'all', conditions: [{ field: 'desc', op: 'contains', value: 'pixel cloud' }], set: {}, active: true };
  it('matches on description, case-insensitively, and on direction', () => {
    expect(ruleMatches(rule, line())).toBe(true);
    expect(ruleMatches(rule, line({ amount: 4900 }))).toBe(false);
    expect(ruleMatches({ ...rule, active: false }, line())).toBe(false);
  });
  it('supports amount conditions and any/all', () => {
    const r = { ...rule, match: 'any', conditions: [{ field: 'desc', op: 'is', value: 'nope' }, { field: 'amount', op: 'gt', value: 4000 }] };
    expect(ruleMatches(r, line())).toBe(true);
    expect(ruleMatches({ ...r, match: 'all' }, line())).toBe(false);
  });
  it('limits a rule to chosen accounts', () => {
    expect(ruleMatches({ ...rule, accountIds: ['a'] }, line({ accountId: 'b' }))).toBe(false);
    expect(ruleMatches({ ...rule, accountIds: ['a'] }, line({ accountId: 'a' }))).toBe(true);
  });
  it('uses the first rule by priority', () => {
    const a = { ...rule, name: 'A', priority: 2 };
    const b = { ...rule, name: 'B', priority: 1 };
    expect(findRule([a, b], line()).name).toBe('B');
  });
  it('ignores a rule with no usable conditions', () => {
    expect(ruleMatches({ ...rule, conditions: [{ field: 'desc', op: 'contains', value: '' }] }, line())).toBe(false);
  });
});

describe('creating transactions from lines', () => {
  it('money out of a bank is an expense, money in is a deposit, both balanced', () => {
    const { s, acct, vendor } = makeBooks();
    const checking = acct('Checking');
    const out = draftFromLine(s, line({ accountId: checking }), { contactId: vendor.id, categoryId: acct('Utilities') });
    expect(out.type).toBe('expense');
    expect(out.lines[0].amount).toBe(4900);
    const inn = draftFromLine(s, line({ accountId: checking, amount: 125 }), { categoryId: acct('Interest Earned') });
    expect(inn.type).toBe('deposit');
    for (const t of [out, inn]) expect(postings(s.saveTxn(t), 'accrual', s.ctx()).reduce((a, p) => a + p.amount, 0)).toBe(0);
  });
  it('a card payment from checking becomes a credit card payment', () => {
    const { s, acct } = makeBooks();
    const t = draftFromLine(s, line({ accountId: acct('Checking'), amount: -50000 }), { transferAccountId: acct('Credit Card') });
    expect(t).toMatchObject({ type: 'ccPayment', ccAccountId: acct('Credit Card'), bankAccountId: acct('Checking'), amount: 50000 });
  });
  it('an uncategorized line lands in the uncategorized account', () => {
    const { s, acct } = makeBooks();
    const t = draftFromLine(s, line({ accountId: acct('Checking') }), {});
    expect(s.account(t.lines[0].accountId).role).toBe('uncategorizedExpense');
  });
});

describe('matching', () => {
  it('finds an existing transaction with the same amount near the date, and open invoices', () => {
    const { s, acct, customer, vendor, service } = makeBooks();
    const checking = acct('Checking');
    const exp = s.saveTxn({ type: 'expense', date: '2026-06-08', accountId: checking, contactId: vendor.id, lines: [{ accountId: acct('Meals'), amount: 4900 }] });
    s.saveTxn({ type: 'expense', date: '2026-04-01', accountId: checking, lines: [{ accountId: acct('Meals'), amount: 4900 }] });
    const m = findMatches(s, line({ accountId: checking }));
    expect(m.map((x) => x.txn.id)).toEqual([exp.id]);
    const inv = s.saveTxn({ type: 'invoice', date: '2026-06-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 30000 }] });
    const m2 = findMatches(s, line({ accountId: checking, amount: 30000 }));
    expect(m2[0]).toMatchObject({ kind: 'open' });
    const pay = s.saveTxn(settleFromLine(s, line({ accountId: checking, amount: 30000 }), inv));
    expect(s.openBalance(inv.id)).toBe(0);
    expect(pay.depositToId).toBe(checking);
  });
  it('does not offer a transaction already matched to another line', () => {
    const { s, acct } = makeBooks();
    const checking = acct('Checking');
    const exp = s.saveTxn({ type: 'expense', date: '2026-06-10', accountId: checking, lines: [{ accountId: acct('Meals'), amount: 4900 }] });
    s.put('bankLines', { id: 'other', accountId: checking, date: '2026-06-10', amount: -4900, desc: 'x', status: 'added', txnId: exp.id });
    expect(findMatches(s, line({ accountId: checking }))).toEqual([]);
  });
  it('suggests the category used last time for the same payee words', () => {
    const { s, acct } = makeBooks();
    const checking = acct('Checking');
    const t = s.saveTxn({ type: 'expense', date: '2026-05-10', accountId: checking, lines: [{ accountId: acct('Utilities'), amount: 100 }] });
    s.put('bankLines', { accountId: checking, date: '2026-05-10', amount: -100, desc: 'CITY POWER 0510', status: 'added', txnId: t.id });
    expect(suggestFromHistory(s, line({ accountId: checking, desc: 'CITY POWER 0610' })).categoryId).toBe(acct('Utilities'));
  });
});
