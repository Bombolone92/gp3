import { describe, it, expect } from 'vitest';
import { Store } from '../src/lib/store.js';
import { sampleDataset, wipeSampleData } from '../src/lib/sample.js';
import { suggestMatches } from '../src/lib/reconcile.js';
import { fakePuter } from './helpers/fake-puter.js';

describe('sampleDataset', () => {
  it('installs through importAll and produces a coherent dataset', async () => {
    const sdk = fakePuter();
    const store = new Store(() => sdk);
    await store.init();
    await store.updateSettings({ baseCurrency: 'GBP' });
    const data = sampleDataset(store, { now: new Date(2026, 7, 26) });
    await store.importAll(data);

    const all = await store.loadAll();
    expect(all.length).toBeGreaterThan(15);
    expect(all.every((e) => e.currency === 'GBP')).toBe(true);
    expect(all.every((e) => store.category(e.categoryId))).toBe(true);
    expect(all.every((e) => e.date <= '2026-08-26')).toBe(true);
    expect(store.months).toEqual(['2026-08', '2026-07', '2026-06']);
    expect(store.reports.map((r) => r.status).sort()).toEqual(['draft', 'reimbursed', 'submitted']);
    expect(all.every((e) => !e.reportId || store.report(e.reportId))).toBe(true);
    expect(store.settings.sampleData).toBe(true);

    const lines = await store.loadStatements();
    const matched = lines.filter((l) => l.matchedExpenseId);
    expect(matched.length).toBeGreaterThan(5);
    for (const l of matched) expect(store.getExpense(l.matchedExpenseId)).toMatchObject({ reconciled: true, statementLineId: l.id });
    // The open lines are built so the matcher has something to suggest.
    expect(suggestMatches(lines, all).length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => !l.matchedExpenseId && !suggestMatches(lines, all).some((m) => m.lineId === l.id))).toBe(true);
  });
  it('wipes back to an empty, un-onboarded state', async () => {
    const sdk = fakePuter();
    const store = new Store(() => sdk);
    await store.init();
    await store.importAll(sampleDataset(store));
    await wipeSampleData(store);
    expect(await store.loadAll()).toEqual([]);
    expect(store.reports).toEqual([]);
    expect(store.settings.sampleData).toBe(false);
    expect(store.settings.onboarded).toBe(false);
  });
});
