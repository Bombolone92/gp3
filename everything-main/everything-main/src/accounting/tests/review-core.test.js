import { describe, it, expect } from 'vitest';
import { lineAmount } from '../src/lib/money.js';

describe('line amounts', () => {
  it('rounds half a cent up despite floating-point error', () => {
    expect(lineAmount(0.285, 100)).toBe(29);
    expect(lineAmount(1.15, 50)).toBe(58);
    expect(lineAmount(0.043, 2500)).toBe(108);
    for (let q = 1; q < 20000; q++) {
      for (const r of [100, 50, 2500, 1999]) {
        expect(lineAmount(q / 1000, r)).toBe(Math.floor((q * r + 500) / 1000));
      }
    }
  });
  it('rounds negative quantities like positive ones', () => {
    expect(lineAmount(-1, 2.5)).toBe(-3);
    expect(lineAmount(-0.285, 100)).toBe(-29);
    expect(Object.is(lineAmount(0, 100), 0)).toBe(true);
  });
});

describe('yearly schedules', () => {
  it('come back to Feb 29 in leap years', async () => {
    const { dueDates, afterCreating } = await import('../src/lib/recurring.js');
    const r = { interval: 'year', every: 1, startDate: '2024-02-29', nextDate: '2024-02-29', count: 0, mode: 'scheduled' };
    expect(dueDates(r, '2029-01-01')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    expect(afterCreating(r, 4).nextDate).toBe('2028-02-29');
  });
});

describe('P&L compared with the previous period', () => {
  it('steps back whole calendar months for months, quarters and years', async () => {
    const { previousPeriod } = await import('../src/lib/reports.js');
    expect(previousPeriod('2026-09-01', '2026-09-30')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod('2026-07-01', '2026-09-30')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(previousPeriod('2026-01-01', '2026-12-31')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(previousPeriod('2026-10-01', '2026-10-12')).toEqual({ from: '2026-09-19', to: '2026-09-30' });
  });
  it('puts the whole previous month in the comparison column', async () => {
    const { makeBooks } = await import('./helpers/books.js');
    const { profitAndLoss } = await import('../src/lib/reports.js');
    const { s, acct } = makeBooks();
    for (const date of ['2026-08-01', '2026-06-30', '2026-03-31']) s.saveTxn({ type: 'deposit', date, accountId: acct('Checking'), lines: [{ accountId: acct('Sales'), amount: 10000 }] });
    const net = (r) => r.rows.find((x) => x.label === 'Net Income').values.slice(0, 2);
    expect(net(profitAndLoss(s, { from: '2026-09-01', to: '2026-09-30', compare: 'prevPeriod' }))).toEqual([0, 10000]);
    expect(net(profitAndLoss(s, { from: '2026-07-01', to: '2026-09-30', compare: 'prevPeriod' }))).toEqual([10000, 10000]);
  });
});

describe('comparisons with the previous year', () => {
  it('keep month ends, including Feb 29', async () => {
    const { makeBooks } = await import('./helpers/books.js');
    const { profitAndLoss, balanceSheet } = await import('../src/lib/reports.js');
    const { s, acct } = makeBooks();
    s.saveTxn({ type: 'deposit', date: '2024-02-29', accountId: acct('Checking'), lines: [{ accountId: acct('Sales'), amount: 10000 }] });
    const pnl = profitAndLoss(s, { from: '2025-02-01', to: '2025-02-28', compare: 'prevYear' });
    expect(pnl.columns[2]).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
    expect(pnl.rows.find((x) => x.label === 'Net Income').values.slice(0, 2)).toEqual([0, 10000]);
    expect(profitAndLoss(s, { from: '2024-02-01', to: '2024-02-29', compare: 'prevYear' }).columns[2]).toMatchObject({ from: '2023-02-01', to: '2023-02-28' });
    expect(profitAndLoss(s, { from: '2026-01-01', to: '2026-06-15', compare: 'prevYear' }).columns[2]).toMatchObject({ from: '2025-01-01', to: '2025-06-15' });
    const bs = balanceSheet(s, { asOf: '2025-02-28', compare: 'prevYear' });
    expect(bs.columns[2].label).toBe('February 29, 2024');
  });
});

describe('balance sheet columns', () => {
  it('by quarter ends on quarter ends', async () => {
    const { makeBooks } = await import('./helpers/books.js');
    const { balanceSheet } = await import('../src/lib/reports.js');
    const { s } = makeBooks();
    const labels = (asOf, columns) => balanceSheet(s, { asOf, columns }).columns.slice(1).map((c) => c.label);
    expect(labels('2026-11-15', 'quarter')).toEqual(['September 30, 2025', 'December 31, 2025', 'March 31, 2026', 'June 30, 2026', 'September 30, 2026', 'November 15, 2026']);
    expect(labels('2026-10-12', 'month')).toEqual(['May 31, 2026', 'June 30, 2026', 'July 31, 2026', 'August 31, 2026', 'September 30, 2026', 'October 12, 2026']);
  });
});

describe('customer and vendor balances', () => {
  it('do not offer a cash/accrual choice they would ignore', async () => {
    const { makeBooks } = await import('./helpers/books.js');
    const { reportControls, runReport } = await import('../src/lib/reports.js');
    const { s } = makeBooks();
    for (const id of ['customerBalance', 'vendorBalance']) {
      expect(reportControls(id).basis).toBe(false);
      expect(runReport(s, id, { asOf: '2026-06-15', basis: 'cash' }).basis).toBeUndefined();
    }
  });
});

describe('applying to a document', () => {
  it('counts several entries for the same document together', async () => {
    const { makeBooks } = await import('./helpers/books.js');
    const { s, customer, service } = makeBooks();
    const inv = s.saveTxn({ type: 'invoice', date: '2026-06-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 15000 }] });
    const cm = s.saveTxn({ type: 'creditMemo', date: '2026-06-02', contactId: customer.id, lines: [{ itemId: service.id, qty: 2, rate: 15000 }] });
    expect(() => s.saveTxn({ ...cm, applied: [{ txnId: inv.id, amount: 10000 }, { txnId: inv.id, amount: 10000 }] })).toThrow(/open balance/);
    expect(s.openBalance(inv.id)).toBe(15000);
    expect(() => s.saveTxn({ type: 'payment', date: '2026-06-03', contactId: customer.id, amount: 20000, applied: [{ txnId: inv.id, amount: 10000 }, { txnId: inv.id, amount: 10000 }] })).toThrow(/open balance/);
    s.saveTxn({ ...cm, applied: [{ txnId: inv.id, amount: 10000 }, { txnId: inv.id, amount: 5000 }] });
    expect(s.openBalance(inv.id)).toBe(0);
  });
});

describe('changing the customer or vendor', () => {
  it('is refused while payments or credits are applied', async () => {
    const { makeBooks } = await import('./helpers/books.js');
    const { s, acct, customer, customer2, service, vendor } = makeBooks();
    const inv = s.saveTxn({ type: 'invoice', date: '2026-06-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 50000 }] });
    const pay = s.saveTxn({ type: 'payment', date: '2026-06-02', contactId: customer.id, amount: 50000, depositToId: acct('Checking'), applied: [{ txnId: inv.id, amount: 50000 }] });
    expect(() => s.saveTxn({ ...s.txn(inv.id), contactId: customer2.id })).toThrow(/Unapply them before changing the customer/);
    expect(() => s.saveTxn({ ...s.txn(pay.id), contactId: customer2.id })).toThrow(/different customer/);
    const inv2 = s.saveTxn({ type: 'invoice', date: '2026-06-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 100 }] });
    expect(() => s.saveTxn({ type: 'payment', date: '2026-06-02', contactId: customer2.id, amount: 100, applied: [{ txnId: inv2.id, amount: 100 }] })).toThrow(/different customer/);
    // Other edits still save, and an unpaid invoice can still change hands.
    s.saveTxn({ ...s.txn(inv.id), memo: 'note' });
    s.saveTxn({ ...s.txn(pay.id), memo: 'note' });
    s.saveTxn({ ...inv2, contactId: customer2.id });
    expect(s.contactBalances('customer').get(customer.id)).toBe(0);
    const bill = s.saveTxn({ type: 'bill', date: '2026-06-01', contactId: vendor.id, lines: [{ accountId: acct('Meals'), amount: 100 }] });
    s.saveTxn({ type: 'billPayment', date: '2026-06-02', contactId: vendor.id, accountId: acct('Checking'), amount: 100, applied: [{ txnId: bill.id, amount: 100 }] });
    const v2 = s.saveContact({ kind: 'vendor', displayName: 'Other Vendor' });
    expect(() => s.saveTxn({ ...s.txn(bill.id), contactId: v2.id })).toThrow(/changing the vendor/);
  });
});

describe('deposited payments', () => {
  function deposited() {
    return import('./helpers/books.js').then(({ makeBooks }) => {
      const b = makeBooks();
      const { s, acct, customer, service } = b;
      const undep = acct('Undeposited Funds');
      const inv = s.saveTxn({ type: 'invoice', date: '2026-06-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 50000 }] });
      const pay = s.saveTxn({ type: 'payment', date: '2026-06-02', contactId: customer.id, amount: 50000, depositToId: undep, applied: [{ txnId: inv.id, amount: 50000 }] });
      const rcpt = s.saveTxn({ type: 'salesReceipt', date: '2026-06-02', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 2000 }] });
      const dep = s.saveTxn({ type: 'deposit', date: '2026-06-03', accountId: acct('Checking'), lines: [{ paymentId: pay.id, amount: 50000 }, { paymentId: rcpt.id, amount: 2000 }] });
      return { ...b, undep, inv, pay, rcpt, dep };
    });
  }
  it('leave the deposit when voided', async () => {
    const { s, acct, undep, pay, dep } = await deposited();
    s.voidTxn(pay.id);
    expect(s.accountBalance(undep)).toBe(0);
    expect(s.accountBalance(acct('Checking'))).toBe(2000);
    expect(s.txn(dep.id).lines.map((l) => l.amount)).toEqual([2000]);
    expect(s.ledger().imbalance()).toBe(0);
  });
  it('keep their amount and account while deposited', async () => {
    const { s, acct, undep, pay, rcpt } = await deposited();
    expect(() => s.saveTxn({ ...s.txn(pay.id), amount: 30000, applied: [{ txnId: s.txn(pay.id).applied[0].txnId, amount: 30000 }] })).toThrow(/in a deposit/);
    expect(() => s.saveTxn({ ...s.txn(pay.id), depositToId: acct('Checking') })).toThrow(/in a deposit/);
    expect(() => s.saveTxn({ ...s.txn(rcpt.id), lines: [{ amount: 3000 }] })).toThrow(/in a deposit/);
    s.saveTxn({ ...s.txn(pay.id), memo: 'ok', paymentMethod: 'Check' });
    expect(s.accountBalance(undep)).toBe(0);
  });
});

describe('deleting an account', () => {
  it('keeps one a recurring template or a bank rule uses, as inactive', async () => {
    const { makeBooks } = await import('./helpers/books.js');
    const { s, acct, vendor } = makeBooks();
    const parking = s.saveAccount({ name: 'Parking', type: 'expense' });
    s.put('recurring', { name: 'Parking', type: 'expense', interval: 'month', every: 1, startDate: '2026-06-01', nextDate: '2026-06-01', count: 0, mode: 'scheduled', active: true,
      template: { accountId: acct('Checking'), contactId: vendor.id, lines: [{ accountId: parking.id, amount: 5000 }] } });
    expect(s.deleteAccount(parking.id)).toBe('inactive');
    const tolls = s.saveAccount({ name: 'Tolls', type: 'expense' });
    s.put('rules', { name: 'Tolls', conditions: [], set: { categoryId: tolls.id } });
    expect(s.deleteAccount(tolls.id)).toBe('inactive');
    const spare = s.saveAccount({ name: 'Spare', type: 'expense' });
    expect(s.deleteAccount(spare.id)).toBe('deleted');
  });
  it('refuses transactions that post to a deleted account', async () => {
    const { makeBooks } = await import('./helpers/books.js');
    const { runRecurring } = await import('../src/lib/recurring-run.js');
    const { balanceSheet } = await import('../src/lib/reports.js');
    const { s, acct, vendor } = makeBooks();
    expect(() => s.saveTxn({ type: 'expense', date: '2026-06-01', accountId: acct('Checking'), lines: [{ accountId: 'gone', amount: 5000 }] })).toThrow(/deleted/);
    // A template whose account was deleted on another device creates nothing.
    s.put('recurring', { name: 'Old', type: 'expense', interval: 'month', every: 1, startDate: '2026-06-01', nextDate: '2026-06-01', count: 0, mode: 'scheduled', active: true,
      template: { accountId: acct('Checking'), contactId: vendor.id, lines: [{ accountId: 'gone', amount: 5000 }] } });
    expect(runRecurring(s)).toBe(0);
    expect(balanceSheet(s, { asOf: '2026-06-30' }).balanced).toBe(true);
  });
});

describe('recurring transactions and the closing date', () => {
  it('step past dates in the closed period', async () => {
    const { makeBooks } = await import('./helpers/books.js');
    const { runRecurring } = await import('../src/lib/recurring-run.js');
    const { s, acct, vendor } = makeBooks({ today: '2026-06-15' });
    s.saveSettings({ closeDate: '2026-05-31' });
    s.put('recurring', { id: 'rent', name: 'Rent', type: 'expense', interval: 'month', every: 1, startDate: '2026-04-01', nextDate: '2026-04-01', count: 0, mode: 'scheduled', active: true,
      template: { accountId: acct('Checking'), contactId: vendor.id, lines: [{ accountId: acct('Rent and Lease'), amount: 100000 }] } });
    expect(runRecurring(s)).toBe(1);
    expect([...s.txns.values()].map((t) => t.date)).toEqual(['2026-06-01']);
    expect(s.recurring.get('rent')).toMatchObject({ nextDate: '2026-07-01', count: 3 });
    expect(runRecurring(s)).toBe(0);
  });
});

describe('credits from a closed period', () => {
  async function books() {
    const { makeBooks } = await import('./helpers/books.js');
    const b = makeBooks();
    const { s, customer, service } = b;
    const old = s.saveTxn({ type: 'invoice', date: '2025-11-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 30000 }] });
    const cm = s.saveTxn({ type: 'creditMemo', date: '2025-12-10', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 10000 }] });
    s.saveSettings({ closeDate: '2025-12-31' });
    const inv = s.saveTxn({ type: 'invoice', date: '2026-06-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 50000 }] });
    return { ...b, old, cm, inv };
  }
  it('can be applied to documents in the open period', async () => {
    const { s, cm, inv } = await books();
    s.saveTxn({ ...cm, applied: [{ txnId: inv.id, amount: 10000 }] });
    expect(s.openBalance(inv.id)).toBe(40000);
    expect(s.openBalance(cm.id)).toBe(0);
    // ...and taken off again, or the invoice voided.
    s.voidTxn(inv.id);
    expect(s.txn(cm.id).applied).toEqual([]);
    expect(s.openBalance(cm.id)).toBe(10000);
  });
  it('cannot otherwise change, or be applied in the closed period', async () => {
    const { s, cm, inv, old } = await books();
    expect(() => s.saveTxn({ ...cm, memo: 'x', applied: [{ txnId: inv.id, amount: 10000 }] })).toThrow(/closed/);
    expect(() => s.saveTxn({ ...cm, applied: [{ txnId: old.id, amount: 10000 }] })).toThrow(/closed/);
    const pay = s.saveTxn({ type: 'payment', date: '2026-06-02', contactId: cm.contactId, amount: 100, applied: [] });
    s.saveSettings({ closeDate: '2026-06-30' });
    expect(() => s.saveTxn({ ...pay, applied: [{ txnId: inv.id, amount: 100 }] })).toThrow(/closed/);
  });
});

describe('aging and balances with journal entries to A/R and A/P', () => {
  it('tie to the ledger', async () => {
    const { makeBooks } = await import('./helpers/books.js');
    const { agingSummary, agingDetail, contactBalanceSummary, openDocsReport } = await import('../src/lib/reports.js');
    const { s, acct, customer, customer2, service, vendor } = makeBooks();
    const ar = acct('Accounts Receivable');
    const ap = acct('Accounts Payable');
    s.saveTxn({ type: 'invoice', date: '2026-01-10', dueDate: '2026-02-09', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 50000 }] });
    // Write the invoice off, and charge another customer a fee, by journal entry.
    s.saveTxn({ type: 'journal', date: '2026-06-01', lines: [{ accountId: acct('Uncategorized Expense'), debit: 50000 }, { accountId: ar, credit: 50000, contactId: customer.id }] });
    s.saveTxn({ type: 'journal', date: '2026-04-01', lines: [{ accountId: ar, debit: 2500, contactId: customer2.id }, { accountId: acct('Other Income'), credit: 2500 }] });
    s.saveTxn({ type: 'journal', date: '2026-06-02', lines: [{ accountId: acct('Meals'), debit: 700 }, { accountId: ap, credit: 700, contactId: vendor.id }] });
    const asOf = '2026-06-15';
    const grand = (r) => r.rows.at(-1).values.at(-1);
    expect(grand(agingSummary(s, { asOf }))).toBe(s.accountBalance(ar, { asOf }));
    expect(grand(agingSummary(s, { asOf }))).toBe(2500);
    expect(grand(contactBalanceSummary(s, { asOf }))).toBe(2500);
    expect(contactBalanceSummary(s, { asOf }).rows.find((r) => r.contactId === customer.id)).toBeUndefined();
    expect(agingSummary(s, { asOf }).rows.find((r) => r.contactId === customer2.id).values).toEqual([null, null, null, 2500, null, 2500]);
    expect(agingDetail(s, { asOf }).rows.some((r) => r.values[1] === 'Journal entry' && r.values[3] === 'Beta LLC')).toBe(true);
    expect(grand(openDocsReport(s, { asOf }))).toBe(52500);
    expect(grand(agingSummary(s, { asOf, side: 'ap' }))).toBe(s.accountBalance(ap, { asOf }));
    expect(grand(contactBalanceSummary(s, { asOf, side: 'ap' }))).toBe(700);
    // Before the write-off the customer still owes the invoice.
    expect(grand(agingSummary(s, { asOf: '2026-05-31' }))).toBe(52500);
  });
});

describe('tax rates and item accounts saved with each transaction', () => {
  async function books() {
    const { makeBooks } = await import('./helpers/books.js');
    return makeBooks({ today: '2026-06-15' });
  }
  const setRate = (s, taxId, rate) => s.put('taxRates', { ...s.taxRates.get(taxId), rate });

  it('editing a tax rate does not change past invoices', async () => {
    const { s, acct, customer, product, taxId } = await books();
    const inv = s.saveTxn({ type: 'invoice', date: '2025-03-01', contactId: customer.id, taxRateId: taxId, lines: [{ itemId: product.id, qty: 40, rate: 2500, taxable: true }] });
    s.saveTxn({ type: 'payment', date: '2025-03-05', contactId: customer.id, amount: 108250, depositToId: acct('Checking'), applied: [{ txnId: inv.id, amount: 108250 }] });
    setRate(s, taxId, 950);
    expect(s.total(s.txn(inv.id))).toBe(108250);
    expect(s.openBalance(inv.id)).toBe(0);
    expect(s.status(s.txn(inv.id)).code).toBe('paid');
    // A new invoice uses the new rate; editing the old one keeps its rate.
    const inv2 = s.saveTxn({ type: 'invoice', date: '2026-06-01', contactId: customer.id, taxRateId: taxId, lines: [{ itemId: product.id, qty: 40, rate: 2500, taxable: true }] });
    expect(s.total(inv2)).toBe(109500);
    s.saveTxn({ ...s.txn(inv.id), memo: 'edited' });
    expect(s.total(s.txn(inv.id))).toBe(108250);
  });

  it('keeps the old rate on documents saved before rates were kept', async () => {
    const { s, customer, product, taxId } = await books();
    // A record from an earlier version: no saved rate.
    s.put('txns', { id: 'legacy', type: 'invoice', date: '2025-03-01', contactId: customer.id, taxRateId: taxId, lines: [{ itemId: product.id, qty: 40, rate: 2500, taxable: true }] });
    s.put('txns', { id: 'est', type: 'estimate', date: '2025-03-01', contactId: customer.id, taxRateId: taxId, lines: [{ itemId: product.id, qty: 40, rate: 2500, taxable: true }] });
    expect(s.total(s.txn('legacy'))).toBe(108250);
    setRate(s, taxId, 950);
    expect(s.total(s.txn('legacy'))).toBe(108250);
    expect(s.txn('legacy').taxRateBp).toBe(825);
    // Estimates post nothing and quote the current rate.
    expect(s.total(s.txn('est'))).toBe(109500);
  });

  it('choosing a rate again in the form uses its current value', async () => {
    const { s, customer, product, taxId } = await books();
    const other = s.put('taxRates', { name: 'City tax', rate: 100, active: true });
    const inv = s.saveTxn({ type: 'invoice', date: '2026-06-01', contactId: customer.id, taxRateId: taxId, lines: [{ itemId: product.id, qty: 40, rate: 2500, taxable: true }] });
    setRate(s, taxId, 950);
    // The sales form clears the saved rate when another rate is chosen.
    s.saveTxn({ ...s.txn(inv.id), taxRateId: other.id, taxRateBp: null });
    expect(s.total(s.txn(inv.id))).toBe(101000);
    s.saveTxn({ ...s.txn(inv.id), taxRateId: taxId, taxRateBp: null });
    expect(s.total(s.txn(inv.id))).toBe(109500);
    s.saveTxn({ ...s.txn(inv.id), taxRateId: null, taxRateBp: null });
    expect(s.txn(inv.id).taxRateBp).toBeUndefined();
    expect(s.total(s.txn(inv.id))).toBe(100000);
  });

  it('copies, recurring occurrences and converted estimates use the current rate', async () => {
    const { s, customer, product, taxId } = await books();
    const { createFromTemplate } = await import('../src/lib/recurring-run.js');
    const inv = s.saveTxn({ type: 'invoice', date: '2026-06-01', contactId: customer.id, taxRateId: taxId, lines: [{ itemId: product.id, qty: 40, rate: 2500, taxable: true }] });
    setRate(s, taxId, 950);
    const copy = s.duplicateTxn(inv.id);
    expect(copy.taxRateBp).toBeUndefined();
    expect(s.salesTotals(copy).total).toBe(109500);
    expect(s.total(s.saveTxn(copy))).toBe(109500);
    // A template made before this change may still carry a saved rate.
    const r = { id: 'tpl', type: 'invoice', template: { ...structuredClone(s.txn(inv.id)), id: undefined } };
    expect(s.total(createFromTemplate(s, r, '2026-07-01'))).toBe(109500);
    const est = s.saveTxn({ type: 'estimate', date: '2026-06-01', contactId: customer.id, taxRateId: taxId, lines: [{ itemId: product.id, qty: 40, rate: 2500, taxable: true }] });
    expect(s.total(s.saveTxn({ type: 'invoice', date: '2026-06-02', contactId: customer.id, taxRateId: est.taxRateId, lines: structuredClone(est.lines), estimateId: est.id }))).toBe(109500);
  });

  it('changing an item\'s accounts does not move past income or expenses', async () => {
    const { s, acct, customer, service, product, vendor } = await books();
    const sum = (name, basis = 'accrual') => -s.ledger(basis).sumAccount(acct(name), '2025-01-01', '2025-12-31') || 0;
    const inv = s.saveTxn({ type: 'invoice', date: '2025-03-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 50000 }] });
    s.put('txns', { id: 'legacy', type: 'invoice', date: '2025-04-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 1000 }] });
    s.saveTxn({ type: 'payment', date: '2025-03-05', contactId: customer.id, amount: 50000, depositToId: acct('Checking'), applied: [{ txnId: inv.id, amount: 50000 }] });
    const bill = s.saveTxn({ type: 'bill', date: '2025-03-01', contactId: vendor.id, lines: [{ itemId: product.id, qty: 2, rate: 1000 }] });
    s.saveItem({ ...s.item(service.id), incomeAccountId: acct('Sales') });
    s.saveItem({ ...s.item(product.id), expenseAccountId: acct('Office Supplies and Software') });
    expect(sum('Services')).toBe(51000);
    expect(sum('Services', 'cash')).toBe(50000);
    expect(sum('Sales')).toBe(0);
    expect(-sum('Cost of Goods Sold') || 0).toBe(2000);
    // New documents use the item as it is now, and so does a line whose item is changed.
    s.saveTxn({ type: 'invoice', date: '2026-06-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 700 }] });
    expect(-s.ledger().sumAccount(acct('Sales'), '2026-01-01', '2026-12-31')).toBe(700);
    s.saveTxn({ ...s.txn(bill.id), lines: [{ ...s.txn(bill.id).lines[0], itemId: service.id }] });
    expect(-sum('Cost of Goods Sold') || 0).toBe(0);
    expect(s.ledger().imbalance()).toBe(0);
  });

  it('shows one sales tax row per rate charged', async () => {
    const { s, customer, product, taxId } = await books();
    const { salesTaxLiability } = await import('../src/lib/reports.js');
    s.saveTxn({ type: 'invoice', date: '2026-01-10', contactId: customer.id, taxRateId: taxId, lines: [{ itemId: product.id, qty: 40, rate: 2500, taxable: true }] });
    setRate(s, taxId, 950);
    s.saveTxn({ type: 'invoice', date: '2026-06-10', contactId: customer.id, taxRateId: taxId, lines: [{ itemId: product.id, qty: 40, rate: 2500, taxable: true }] });
    const rows = salesTaxLiability(s, { from: '2026-01-01', to: '2026-12-31' }).rows;
    expect(rows.map((r) => [r.label, r.values[3]])).toEqual([['Sales tax (8.25%)', 8250], ['Sales tax (9.50%)', 9500], ['Total', 17750]]);
  });
});
