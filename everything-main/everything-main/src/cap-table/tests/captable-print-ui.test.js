// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../src/lib/store.js';
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


describe('the cap table controls across a re-render', () => {
  it('name themselves so the shell can hand focus back', () => {
    const view = capTableView();
    expect(view.querySelector('.asof-input').dataset.focusKey).toBe('captable-asof');
    expect(view.querySelector('.check-row input').dataset.focusKey).toBe('captable-pool');
  });
});

describe('the printed issuance history', () => {
  it('prints a sub-dollar issuance in cents rather than as $0', async () => {
    await store.updateSecurity(founders.id, { pricePerShare: 0.0001 });
    const view = capTableView();
    document.body.append(view);
    window.dispatchEvent(new Event('beforeprint'));
    const history = [...view.querySelectorAll('.print-only .round-metric')].find((r) => r.textContent.startsWith('Jan 1, 2024'));
    expect(history.textContent).toContain('1,000 shares · $0.10');
    expect(history.textContent).not.toMatch(/\$0(?!\.)/);
  });
});
