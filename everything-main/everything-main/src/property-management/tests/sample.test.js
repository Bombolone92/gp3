import { describe, it, expect } from 'vitest';
import { buildSampleData } from '../src/core/sample.js';
import { computeIndex, isBalanced } from '../src/core/ledger.js';
import { computePostings, leaseStatus } from '../src/core/leases.js';

describe('sample data', () => {
  const today = '2026-10-12';
  const data = buildSampleData(today);
  const c = data.collections;

  it('has a realistic portfolio', () => {
    expect(c.properties.length).toBe(5);
    expect(c.units.length).toBeGreaterThan(15);
    expect(c.leases.filter((l) => leaseStatus(l, today) === 'active').length).toBeGreaterThan(12);
    expect(c.leases.some((l) => leaseStatus(l, today) === 'future')).toBe(true);
    expect(c.leases.some((l) => leaseStatus(l, today) === 'past')).toBe(true);
  });

  it('only contains balanced transactions with unique ids, none in the future', () => {
    const ids = new Set();
    for (const t of c.transactions) {
      expect(isBalanced(t), t.id).toBe(true);
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(t.date <= today).toBe(true);
    }
  });

  it('references records that exist', () => {
    const has = (coll, id) => c[coll].some((r) => r.id === id);
    for (const l of c.leases) {
      expect(has('units', l.unitId)).toBe(true);
      expect(has('properties', l.propertyId)).toBe(true);
      for (const t of l.tenantIds) expect(has('tenants', t)).toBe(true);
    }
    for (const t of c.transactions) for (const line of t.lines) expect(has('accounts', line.accountId), line.accountId).toBe(true);
  });

  it('has some tenants behind on rent and leaves nothing for the app to post today', () => {
    const ix = computeIndex(c.transactions);
    const owing = c.leases.filter((l) => ix.lease(l.id).balance > 0);
    expect(owing.length).toBeGreaterThanOrEqual(2);
    const again = computePostings({ leases: c.leases, index: ix, settings: data.settings, today });
    expect(again.transactions.filter((t) => t.kind === 'charge' && !t.id.startsWith('lf-'))).toEqual([]);
  });

  it('produces the same portfolio and money every time', () => {
    const again = buildSampleData(today).collections;
    const shape = (cs) => Object.fromEntries(Object.entries(cs).map(([k, v]) => [k, v.length]));
    const money = (txs) => txs.map((t) => `${t.kind}:${t.date}:${t.lines.reduce((s, l) => s + Math.abs(l.amount), 0)}`).sort().join('|');
    expect(shape(again)).toEqual(shape(c));
    expect(money(again.transactions)).toBe(money(c.transactions));
  });
});

describe('sample late fees', () => {
  it('only charges late fees to the tenants who pay late', () => {
    const today = '2026-10-12';
    const data = buildSampleData(today);
    const ix = computeIndex(data.collections.transactions);
    const run = computePostings({ leases: data.collections.leases, index: ix, settings: data.settings, today });
    const feeLeases = new Set(run.transactions.filter((t) => t.id.startsWith('lf-')).map((t) => t.leaseId));
    // Nothing new to charge: history already has the fees it should.
    expect(feeLeases.size).toBe(0);
    const owing = data.collections.leases.filter((l) => ix.lease(l.id).balance > 0);
    expect(owing.length).toBeLessThanOrEqual(3);
  });
});
