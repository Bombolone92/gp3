// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../src/lib/store.js';
import { dashboardView } from '../src/views/dashboard.js';
import { capTableView } from '../src/views/captable.js';
import { puterBackend } from './helpers/puter-kv.js';

let founders;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T12:00:00'));
  puterBackend().install();
  await store.init();
  const cls = await store.addClass({ name: 'Common', kind: 'common' });
  const holder = await store.addStakeholder({ name: 'Founder', kind: 'founder' });
  // Unpriced, so the dashboard shows the pool tile rather than an implied valuation.
  founders = await store.addSecurity({ kind: 'shares', stakeholderId: holder.id, classId: cls.id, quantity: 1000, pricePerShare: 0, date: '2024-01-01' });
  await store.addPlan({ name: '2024 Plan', adopted: '2024-01-01', classId: cls.id, reserve: 100_000 });
  const old = await store.addPlan({ name: '2020 Plan', adopted: '2020-01-01', classId: cls.id, reserve: 30_000 });
  await store.retirePlan(old.id, { date: '2025-01-01' });
});
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });
const tile = (view, label) => [...view.querySelectorAll('.stat-tile')].find((n) => n.querySelector('.stat-label').textContent === label);

describe('the dashboard pool tile', () => {
  it('counts only the plans whose unallocated shares it holds', () => {
    const view = dashboardView({ navigate: vi.fn() });
    const pool = tile(view, 'Plan reserves');
    expect(pool.querySelector('.stat-value').textContent).toBe('100K');
    expect(pool.textContent).toContain('Unallocated');
    expect(pool.textContent).not.toContain('across 2 plans');
  });
});
