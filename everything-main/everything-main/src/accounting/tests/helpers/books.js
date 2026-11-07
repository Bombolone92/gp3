import { Store } from '../../src/lib/store.js';

/** A fresh company with the default chart and a couple of contacts and items. */
export function makeBooks({ today = '2026-06-15' } = {}) {
  const s = new Store();
  s.clock = () => today;
  s.createCompany({ name: 'Test Co' });
  const acct = (name) => [...s.accounts.values()].find((a) => a.name === name).id;
  const customer = s.saveContact({ kind: 'customer', displayName: 'Acme Corp', email: 'ap@acme.test' });
  const customer2 = s.saveContact({ kind: 'customer', displayName: 'Beta LLC' });
  const vendor = s.saveContact({ kind: 'vendor', displayName: 'Office Depot' });
  const service = s.saveItem({ name: 'Consulting', kind: 'service', price: 15000, incomeAccountId: acct('Services'), taxable: false });
  const product = s.saveItem({ name: 'Widget', kind: 'nonInventory', price: 2500, incomeAccountId: acct('Sales'), expenseAccountId: acct('Cost of Goods Sold'), taxable: true });
  const tax = s.taxRateList()[0];
  s.put('taxRates', { ...tax, rate: 825 });
  return { s, acct, customer, customer2, vendor, service, product, taxId: tax.id };
}
