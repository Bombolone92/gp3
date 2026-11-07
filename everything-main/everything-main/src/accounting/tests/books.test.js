import { describe, it, expect } from 'vitest';
import { makeBooks } from './helpers/books.js';
import { postings, salesTotals, TXN_TYPES } from '../src/lib/txn.js';
import { profitAndLoss, balanceSheet, trialBalance, cashFlow, agingSummary, generalLedger, salesTaxLiability, runReport, REPORTS, byContactSummary as byContact } from '../src/lib/reports.js';

function seed() {
  const b = makeBooks();
  const { s, acct, customer, vendor, service, product, taxId } = b;
  const checking = acct('Checking');
  const card = acct('Credit Card');
  // Owner puts money in.
  s.saveTxn({ type: 'deposit', date: '2026-01-02', accountId: checking, lines: [{ accountId: acct("Owner's Investment"), amount: 1000000, desc: 'Capital' }] });
  // Invoice with a taxable product and a non-taxable service.
  const inv = s.saveTxn({
    type: 'invoice', date: '2026-02-01', dueDate: '2026-03-03', num: '1001', contactId: customer.id, taxRateId: taxId,
    lines: [
      { itemId: service.id, qty: 10, rate: 15000, taxable: false },
      { itemId: product.id, qty: 4, rate: 2500, taxable: true },
    ],
  });
  // Partial payment straight to checking.
  const pay = s.saveTxn({ type: 'payment', date: '2026-02-15', contactId: customer.id, amount: 80000, depositToId: checking, applied: [{ txnId: inv.id, amount: 80000 }] });
  // A bill, then paying it.
  const bill = s.saveTxn({ type: 'bill', date: '2026-02-05', dueDate: '2026-03-07', contactId: vendor.id, lines: [{ accountId: acct('Office Supplies and Software'), amount: 30000 }] });
  s.saveTxn({ type: 'billPayment', date: '2026-02-20', contactId: vendor.id, accountId: checking, amount: 30000, applied: [{ txnId: bill.id, amount: 30000 }] });
  // A card expense with two lines.
  s.saveTxn({ type: 'expense', date: '2026-03-01', accountId: card, contactId: vendor.id, lines: [{ accountId: acct('Meals'), amount: 4500 }, { accountId: acct('Travel'), amount: 22000 }] });
  // Pay part of the card.
  s.saveTxn({ type: 'ccPayment', date: '2026-03-10', ccAccountId: card, bankAccountId: checking, amount: 10000 });
  return { ...b, checking, card, inv, pay, bill };
}

describe('postings', () => {
  it('balance for every transaction type', () => {
    const { s } = seed();
    for (const t of s.txns.values()) {
      for (const basis of ['accrual', 'cash']) {
        const ps = postings(t, basis, s.ctx());
        expect(ps.reduce((a, p) => a + p.amount, 0)).toBe(0);
      }
    }
    expect(s.ledger('accrual').imbalance()).toBe(0);
    expect(s.ledger('cash').imbalance()).toBe(0);
  });

  it('computes sales totals with tax on taxable lines only', () => {
    const { s, inv } = seed();
    const t = salesTotals(inv, s.ctx());
    expect(t.subtotal).toBe(160000);
    expect(t.taxableBase).toBe(10000);
    expect(t.tax).toBe(825);
    expect(t.total).toBe(160825);
  });

  it('spreads a document discount before tax', () => {
    const { s, inv } = seed();
    const t = salesTotals({ ...inv, discountType: 'pct', discountValue: 1000 }, s.ctx());
    expect(t.discount).toBe(16000);
    expect(t.taxableBase).toBe(9000);
    expect(t.tax).toBe(743);
    const ps = postings({ ...inv, discountType: 'pct', discountValue: 1000 }, 'accrual', s.ctx());
    expect(ps.reduce((a, p) => a + p.amount, 0)).toBe(0);
  });

  it('treats non-posting types as non-posting', () => {
    const { s, customer } = seed();
    const est = s.saveTxn({ type: 'estimate', date: '2026-01-05', contactId: customer.id, lines: [{ amount: 5000, desc: 'x' }] });
    expect(TXN_TYPES.estimate.nonPosting).toBe(true);
    expect(postings(est, 'accrual', s.ctx())).toEqual([]);
  });
});

describe('open balances and statuses', () => {
  it('tracks what is left on an invoice', () => {
    const { s, inv, pay } = seed();
    expect(s.openBalance(inv.id)).toBe(80825);
    expect(s.openBalance(pay.id)).toBe(0);
    expect(s.status(inv).code).toBe('overdue');
    expect(s.contactBalances('customer').get(inv.contactId)).toBe(80825);
  });

  it('refuses to apply more than the open balance', () => {
    const { s, inv, customer } = seed();
    expect(() => s.saveTxn({ type: 'payment', date: '2026-03-01', contactId: customer.id, amount: 100000, applied: [{ txnId: inv.id, amount: 90000 }] })).toThrow(/open balance/);
  });

  it('removes applications when the payment is deleted', () => {
    const { s, inv, pay } = seed();
    s.deleteTxn(pay.id);
    expect(s.openBalance(inv.id)).toBe(160825);
  });

  it('voiding zeroes the effect but keeps the record', () => {
    const { s, bill } = seed();
    s.voidTxn(bill.id);
    expect(s.txn(bill.id).voided).toBe(true);
    expect(s.ledger().imbalance()).toBe(0);
  });

  it('respects the closing date', () => {
    const { s, acct, checking } = seed();
    s.saveSettings({ closeDate: '2026-01-31' });
    expect(() => s.saveTxn({ type: 'transfer', date: '2026-01-15', fromId: checking, toId: acct('Savings'), amount: 100 })).toThrow(/closed/);
    expect(() => s.saveTxn({ type: 'transfer', date: '2026-02-15', fromId: checking, toId: acct('Savings'), amount: 100 })).not.toThrow();
  });

  it('numbers documents sequentially', () => {
    const { s } = seed();
    expect(s.nextNumber('invoice')).toBe('1002');
    expect(s.nextNumber('journal')).toBe('1');
  });
});

describe('reports', () => {
  it('profit and loss adds up', () => {
    const { s } = seed();
    const r = profitAndLoss(s, { from: '2026-01-01', to: '2026-12-31' });
    const net = r.rows.find((x) => x.label === 'Net Income').values[0];
    // 150000 services + 10000 sales - 30000 supplies - 4500 meals - 22000 travel
    expect(net).toBe(103500);
    expect(r.net).toBe(103500);
  });

  it('balance sheet balances, on both bases', () => {
    const b = seed();
    const { s } = b;
    for (const basis of ['accrual', 'cash']) {
      const r = balanceSheet(s, { asOf: '2026-12-31', basis });
      expect(r.balanced).toBe(true);
    }
    const r = balanceSheet(s, { asOf: '2026-12-31' });
    // 10000.00 capital + 800.00 received - 300.00 bill - 100.00 card payment
    expect(r.rows.find((x) => x.accountId === b.acct('Checking')).values[0]).toBe(1000000 + 80000 - 30000 - 10000);
    expect(r.rows.find((x) => x.accountId === b.acct('Accounts Receivable')).values[0]).toBe(80825);
  });

  it('cash basis recognizes only what was paid, prorated by line', () => {
    const { s, acct } = seed();
    const r = profitAndLoss(s, { from: '2026-01-01', to: '2026-12-31', basis: 'cash' });
    const services = r.rows.find((x) => x.accountId === acct('Services')).values[0];
    const sales = r.rows.find((x) => x.accountId === acct('Sales')).values[0];
    // 800.00 of a 1608.25 invoice: services 1500/1608.25 of it, widgets 100/1608.25, tax the rest.
    expect(services + sales).toBeLessThan(80000);
    expect(services).toBe(74615);
    expect(sales).toBe(4974);
  });

  it('carries prior-year profit into retained earnings', () => {
    const { s, acct, checking } = seed();
    s.saveTxn({ type: 'deposit', date: '2027-01-05', accountId: checking, lines: [{ accountId: acct('Other Income'), amount: 5000 }] });
    const r = balanceSheet(s, { asOf: '2027-06-30' });
    expect(r.balanced).toBe(true);
    expect(r.rows.find((x) => x.accountId === acct('Retained Earnings')).values[0]).toBe(103500);
    expect(r.rows.find((x) => x.label === 'Net Income').values[0]).toBe(5000);
  });

  it('trial balance debits equal credits', () => {
    const { s } = seed();
    expect(trialBalance(s, { asOf: '2026-12-31' }).balanced).toBe(true);
    expect(trialBalance(s, { asOf: '2027-12-31' }).balanced).toBe(true);
  });

  it('cash flow ties to the change in bank balances', () => {
    const { s } = seed();
    const r = cashFlow(s, { from: '2026-01-01', to: '2026-12-31' });
    expect(r.check.net).toBe(r.check.cashChange);
    expect(r.rows.at(-1).values[0]).toBe(1040000);
  });

  it('ages receivables by due date', () => {
    const { s } = seed();
    const r = agingSummary(s, { asOf: '2026-04-15', side: 'ar' });
    const row = r.rows.find((x) => x.label === 'Acme Corp');
    expect(row.values[2]).toBe(80825); // 43 days past due
    expect(row.values[5]).toBe(80825);
    const before = agingSummary(s, { asOf: '2026-02-10', side: 'ar' });
    expect(before.rows.find((x) => x.label === 'Acme Corp').values[0]).toBe(160825);
  });

  it('general ledger running balances end at the account balance', () => {
    const { s, checking } = seed();
    const r = generalLedger(s, { from: '2026-02-01', to: '2026-12-31', accountIds: [checking] });
    const total = r.rows.find((x) => x.kind === 'subtotal');
    expect(total.values[7]).toBe(1040000);
    const begin = r.rows.find((x) => x.label === 'Beginning Balance');
    expect(begin.values[7]).toBe(1000000);
  });

  it('sales tax liability totals the tax charged', () => {
    const { s } = seed();
    const r = salesTaxLiability(s, { from: '2026-01-01', to: '2026-12-31' });
    expect(r.rows.at(-1).values[3]).toBe(825);
  });

  it('every listed report runs', () => {
    const { s } = seed();
    for (const meta of REPORTS) {
      const r = runReport(s, meta.id, { from: '2026-01-01', to: '2026-12-31', asOf: '2026-12-31' });
      expect(r.rows.length).toBeGreaterThan(0);
      for (const row of r.rows) expect(row.values.length).toBe(r.columns.length - 1);
    }
  });
});

describe('review fixes', () => {
  it('will not lower a paid invoice below what was paid', () => {
    const { s, inv } = seed();
    expect(() => s.saveTxn({ ...inv, lines: [{ amount: 1000 }] })).toThrow(/already applied/);
  });
  it('will not apply more of a credit than it is worth', () => {
    const { s, customer, inv } = seed();
    expect(() => s.saveTxn({ type: 'creditMemo', date: '2026-03-01', contactId: customer.id, lines: [{ amount: 1000 }], applied: [{ txnId: inv.id, amount: 2000 }] })).toThrow(/worth/);
  });
  it('keeps the closing date when deleting a document a closed-period payment depends on', () => {
    const { s, inv } = seed();
    s.saveSettings({ closeDate: '2026-02-20' });
    s.saveSettings({ closeDate: '2026-02-16' });
    expect(() => s.deleteTxn(inv.id)).toThrow(/closed/);
  });
  it('keeps the vendor on billable expense lines', () => {
    const { s, acct, vendor, customer } = seed();
    s.saveTxn({ type: 'expense', date: '2026-05-01', accountId: acct('Checking'), contactId: vendor.id, lines: [{ accountId: acct('Meals'), amount: 5000, customerId: customer.id }] });
    const r = byContact(s, { from: '2026-05-01', to: '2026-05-01', side: 'expenses' });
    expect(r.rows.find((x) => x.label === 'Office Depot').values[0]).toBe(5000);
  });
  it('splits all dates into columns over the books own range', () => {
    const { s } = seed();
    const r = profitAndLoss(s, { from: null, to: null, columns: 'month' });
    expect(r.columns.length).toBeGreaterThan(2);
    expect(r.columns[1].label).toBe('Jan 2026');
  });
});
