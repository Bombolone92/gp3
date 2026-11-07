import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installMockPuter, installMockStorage } from './helpers/mock-puter.js';
import { Store, paymentMethodInfo } from '../src/lib/store.js';
import { fullRefundPicks } from '../src/lib/refunds.js';
import { receiptDoc } from '../src/lib/receipt-doc.js';
import { receiptsCsv } from '../src/lib/csv.js';
import { daySummary } from '../src/lib/drawer.js';

let mock;
let storage;
let store;

beforeEach(async () => {
  mock = installMockPuter();
  storage = installMockStorage();
  store = new Store();
  await store.init();
});

afterEach(() => {
  mock.uninstall();
  storage.uninstall();
});

const line = (over = {}) => ({
  productId: null, name: 'Mug', unitPrice: 16, qty: 1,
  taxRate: 0, taxName: '', discount: null, ...over,
});

async function sell({ customerId = null, payments } = {}) {
  return store.completeSale({
    lines: [line()],
    customerId,
    payments: payments || [{ method: 'card', amount: 16 }],
  });
}

describe('the credit ledger', () => {
  it('derives a balance by adding its entries up', async () => {
    const c = await store.addCustomer({ name: 'Maya' });
    expect(store.creditBalance(c.id)).toBe(0);
    await store.adjustCredit({ customerId: c.id, amount: 8, note: 'Goodwill' });
    await store.adjustCredit({ customerId: c.id, amount: 2.5 });
    expect(store.creditBalance(c.id)).toBe(10.5);
    await store.adjustCredit({ customerId: c.id, amount: -3 });
    expect(store.creditBalance(c.id)).toBe(7.5);
    // Append-only: a correction is another row, never an edit.
    expect(store.creditEntries(c.id)).toHaveLength(3);
  });

  it('refuses a manual deduction bigger than the balance', async () => {
    const c = await store.addCustomer({ name: 'Tom' });
    await store.adjustCredit({ customerId: c.id, amount: 5 });
    await expect(store.adjustCredit({ customerId: c.id, amount: -6 }))
      .rejects.toThrow(/more than the balance/);
    expect(store.creditBalance(c.id)).toBe(5);
  });

  it('rolls a movement back if the write fails', async () => {
    const c = await store.addCustomer({ name: 'Tom' });
    mock.failNextKvSet();
    await expect(store.adjustCredit({ customerId: c.id, amount: 5 })).rejects.toThrow();
    expect(store.creditBalance(c.id)).toBe(0);
    expect(store.credit).toHaveLength(0);
  });

  it('keeps balances in the currency they were made in', async () => {
    const c = await store.addCustomer({ name: 'Elena' });
    await store.adjustCredit({ customerId: c.id, amount: 10 });
    await store.updateSettings({ currency: 'EUR' });
    await store.adjustCredit({ customerId: c.id, amount: 4 });
    expect(store.creditBalance(c.id)).toBe(4);
    expect(store.creditByCurrency(c.id)).toEqual([
      { currency: 'USD', amount: 10 },
      { currency: 'EUR', amount: 4 },
    ]);
  });

  it('sums what the shop owes without letting an overdraw cancel it out', async () => {
    const a = await store.addCustomer({ name: 'A' });
    const b = await store.addCustomer({ name: 'B' });
    await store.adjustCredit({ customerId: a.id, amount: 20 });
    // B ends up negative through a spend the ledger recorded after a
    // correction; A's 20 must still read as 20 owed, not 15.
    store.credit = [...store.credit, {
      id: 'x', at: Date.now(), customerId: b.id, type: 'spent', amount: -5,
      currency: 'USD', receiptId: null, receiptNumber: null, note: '',
    }];
    expect(store.outstandingCredit()).toBe(20);
    expect(store.creditHolders().map((r) => r.balance)).toEqual([20, -5]);
  });

  it('refuses to delete a customer holding a balance', async () => {
    const c = await store.addCustomer({ name: 'Maya' });
    await store.adjustCredit({ customerId: c.id, amount: 12 });
    await expect(store.deleteCustomer(c.id)).rejects.toThrow(/still holds store credit/);
    expect(store.customer(c.id)).not.toBeNull();
    // Written off through the ledger, the delete goes through.
    await store.adjustCredit({ customerId: c.id, amount: -12, note: 'Written off' });
    await store.deleteCustomer(c.id);
    expect(store.customer(c.id)).toBeNull();
  });

  it('refuses over a balance held in a currency the shop no longer sells in', async () => {
    const c = await store.addCustomer({ name: 'Elena' });
    await store.adjustCredit({ customerId: c.id, amount: 10 });
    await store.updateSettings({ currency: 'EUR' });
    // Nothing in euros, but the ten dollars are still owed.
    expect(store.creditBalance(c.id)).toBe(0);
    await expect(store.deleteCustomer(c.id)).rejects.toThrow(/still holds store credit/);
  });

  it('never reports a liability with nobody to owe it to', async () => {
    const c = await store.addCustomer({ name: 'Tom' });
    await store.adjustCredit({ customerId: c.id, amount: 8 });
    expect(store.outstandingCredit()).toBe(8);
    // A ledger entry whose customer is gone (a legacy delete, a hand-edited
    // backup): Reports would have said "$8.00 owed to 0 customers".
    store.customers = [];
    expect(store.creditHolders()).toHaveLength(0);
    expect(store.outstandingCredit()).toBe(0);
  });
});

describe('refunding to store credit', () => {
  it('issues credit, prints the balance, and never opens the drawer', async () => {
    const c = await store.addCustomer({ name: 'Maya' });
    const sale = await sell({ customerId: c.id });
    const refund = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: fullRefundPicks(sale), method: 'credit',
    });

    expect(store.creditBalance(c.id)).toBe(16);
    expect(refund.creditIssued).toBe(16);
    expect(refund.creditBalance).toBe(16);
    expect(refund.payments[0].method).toBe('credit');
    // Not cash: the drawer must not go short by money that never left it.
    const summary = daySummary({ date: sale.date, day: { float: 0, movements: [] }, sales: [sale, refund] });
    expect(summary.cashRefunds).toBe(0);
    expect(summary.byMethod.find((m) => m.method === 'credit').amount).toBe(-16);

    // The slip the customer walks out with says both figures, and says the
    // credit *rose* rather than printing the sale's own negative twice.
    const doc = receiptDoc(refund, store.settings);
    const issued = doc.payments.find((p) => p.label === 'Store credit issued');
    // Positive: the balance rose. (Node's ICU may write the code, not '$'.)
    expect(issued.value).toContain('16.00');
    expect(issued.value).not.toContain('−');
    expect(doc.payments.filter((p) => p.label.startsWith('Store credit'))).toHaveLength(2);
    expect(doc.payments.find((p) => p.label === 'Store credit balance').value).toContain('16');
  });

  it('takes a customer for a sale that never had one', async () => {
    const c = await store.addCustomer({ name: 'Walk-in Sam' });
    const sale = await sell();
    await expect(store.refundSale({
      receiptId: sale.id, date: sale.date, picks: fullRefundPicks(sale), method: 'credit',
    })).rejects.toThrow(/needs a customer/);

    const refund = await store.refundSale({
      receiptId: sale.id, date: sale.date, picks: fullRefundPicks(sale),
      method: 'credit', customerId: c.id,
    });
    expect(refund.customerName).toBe('Walk-in Sam');
    expect(store.creditBalance(c.id)).toBe(16);
  });

  it('takes the credit back out if the refund receipt cannot be filed', async () => {
    const c = await store.addCustomer({ name: 'Maya' });
    const sale = await sell({ customerId: c.id });
    mock.failNextFsWrite();
    await expect(store.refundSale({
      receiptId: sale.id, date: sale.date, picks: fullRefundPicks(sale), method: 'credit',
    })).rejects.toThrow();
    expect(store.creditBalance(c.id)).toBe(0);
  });
});

describe('spending store credit', () => {
  async function withCredit(amount = 20) {
    const c = await store.addCustomer({ name: 'Maya' });
    await store.adjustCredit({ customerId: c.id, amount });
    return c;
  }

  it('settles a whole sale and takes it off the balance', async () => {
    const c = await withCredit();
    const sale = await sell({ customerId: c.id, payments: [{ method: 'credit', amount: 16 }] });
    expect(store.creditBalance(c.id)).toBe(4);
    expect(sale.creditSpent).toBe(16);
    expect(sale.creditBalance).toBe(4);
    const entry = store.creditEntries(c.id)[0];
    expect(entry).toMatchObject({ type: 'spent', amount: -16, receiptId: sale.id, receiptNumber: sale.number });
  });

  it('composes with the split payments already built', async () => {
    const c = await withCredit(10);
    const sale = await sell({
      customerId: c.id,
      payments: [{ method: 'credit', amount: 10 }, { method: 'card', amount: 6 }],
    });
    expect(store.creditBalance(c.id)).toBe(0);
    expect(sale.payments).toHaveLength(2);
    // Revenue is the whole sale, as it should be: the goods left the shop.
    expect(sale.total).toBe(16);
  });

  it('refuses more credit than the balance holds, and a sale with no customer', async () => {
    const c = await withCredit(5);
    await expect(sell({ customerId: c.id, payments: [{ method: 'credit', amount: 16 }] }))
      .rejects.toThrow(/more store credit than the balance/);
    await expect(sell({ payments: [{ method: 'credit', amount: 16 }] }))
      .rejects.toThrow(/Attach the customer/);
    expect(store.creditBalance(c.id)).toBe(5);
  });

  it('does not record the sale at all if the spend cannot be made durable', async () => {
    const c = await withCredit();
    mock.failNextKvSet();
    await expect(sell({ customerId: c.id, payments: [{ method: 'credit', amount: 16 }] }))
      .rejects.toThrow(/needs a connection/);
    expect(store.creditBalance(c.id)).toBe(20);
    expect(store.settings.nextReceipt).toBe(1001);
  });

  it('gives credit back when a sale rolls back', async () => {
    const c = await withCredit();
    // The month file's write is rejected outright (not a transport failure),
    // so the sale never happened - and neither did the spend.
    mock.failNextFsWrite();
    await expect(sell({ customerId: c.id, payments: [{ method: 'credit', amount: 16 }] }))
      .rejects.toThrow();
    expect(store.creditBalance(c.id)).toBe(20);
  });

  it('is its own column in the receipts CSV', async () => {
    const c = await withCredit();
    const sale = await sell({ customerId: c.id, payments: [{ method: 'credit', amount: 16 }] });
    const csv = receiptsCsv([sale]);
    const [head, row] = csv.trim().split('\r\n');
    expect(head).toContain('Paid store credit');
    expect(row.split(',')[head.split(',').indexOf('Paid store credit')]).toBe('16.00');
    expect(paymentMethodInfo('credit').label).toBe('Store credit');
  });
});

describe('credit in a backup', () => {
  it('travels with the customers it belongs to, and drops orphans', async () => {
    const c = await store.addCustomer({ name: 'Maya' });
    await store.adjustCredit({ customerId: c.id, amount: 12 });
    const data = await store.exportAll();
    data.credit.push({
      id: 'orphan', at: Date.now(), customerId: 'nobody', type: 'issued',
      amount: 99, currency: 'USD',
    });

    const fresh = new Store();
    await fresh.init();
    await fresh.importAll(data);
    expect(fresh.creditBalance(c.id)).toBe(12);
    expect(fresh.credit).toHaveLength(1);
    expect(fresh.outstandingCredit()).toBe(12);
  });
});
