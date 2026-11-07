import { describe, it, expect } from 'vitest';
import { Store } from '../src/lib/store.js';
import { loadSample } from '../src/lib/sample.js';
import { balanceSheet, trialBalance, cashFlow } from '../src/lib/reports.js';
import { periodRange } from '../src/lib/dates.js';

describe('sample company', () => {
  it('produces books that balance', () => {
    const s = new Store();
    s.clock = () => '2026-10-11';
    s.createCompany({ name: 'X' });
    loadSample(s);
    expect(s.txns.size).toBeGreaterThan(100);
    expect(s.ledger().imbalance()).toBe(0);
    expect(balanceSheet(s, { asOf: '2026-10-11' }).balanced).toBe(true);
    expect(balanceSheet(s, { asOf: '2026-10-11', basis: 'cash' }).balanced).toBe(true);
    expect(trialBalance(s, { asOf: '2026-10-11' }).balanced).toBe(true);
    const { from, to } = periodRange('thisYearToDate', { now: '2026-10-11' });
    const cf = cashFlow(s, { from, to });
    expect(cf.check.net).toBe(cf.check.cashChange);
    expect([...s.bankLines.values()].filter((l) => l.status === 'review').length).toBe(6);
  });

  it('adds to existing books without touching their company details or tax rate', () => {
    const s = new Store();
    s.clock = () => '2026-10-11';
    s.createCompany({ name: 'Own Co' });
    s.saveSettings({ company: { name: 'Own Co', email: 'me@own.test' } });
    const tax = s.taxRateList()[0];
    s.put('taxRates', { ...tax, name: 'City tax', rate: 825 });
    loadSample(s);
    expect(s.settings.company).toMatchObject({ name: 'Own Co', email: 'me@own.test', phone: '' });
    expect(s.taxRates.get(tax.id)).toMatchObject({ name: 'City tax', rate: 825 });
  });

  it('keeps the name typed at setup when starting as the sample company', () => {
    const s = new Store();
    s.clock = () => '2026-10-11';
    s.createCompany({ name: 'Review Co' });
    loadSample(s, { asCompany: true });
    expect(s.settings.company.name).toBe('Review Co');
    expect(s.settings.company.email).toBe('hello@brightline.example');
    expect(s.taxRateList()[0].rate).toBe(650);
  });
});
