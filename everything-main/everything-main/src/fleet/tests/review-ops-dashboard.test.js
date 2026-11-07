// @vitest-environment jsdom
/** Dashboard widgets against the data under them. */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

const savedTZ = process.env.TZ;
beforeAll(() => {
  // A business west of UTC, where UTC times are on a different hour.
  process.env.TZ = 'America/Los_Angeles';
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
});
afterAll(() => {
  if (savedTZ === undefined) delete process.env.TZ;
  else process.env.TZ = savedTZ;
});

let app;
let store;

async function boot() {
  ({ app } = await import('../src/app.js'));
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { bucketOf } = await import('../src/core/schema.js');
  const { defaultSettings } = await import('../src/core/settings.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  store = createStore({ backend: createMemoryBackend({ settings: defaultSettings() }, { bucketOf }), flushDelay: 0 });
  await store.init();
  app.store = store;
  store.put('vehicles', { id: 'v1', name: 'Van 1', status: 'active', meterUnit: 'mi' });
  document.body.innerHTML = '';
}

async function dashboard() {
  const mod = await import('../src/views/dashboard.js');
  const ctx = { params: {}, query: {}, live: (fn) => { const n = document.createElement('div'); n.append(fn()); return n; }, onDispose() {} };
  const out = mod.render(ctx);
  document.body.append(out.node);
  return out.node;
}

const panel = (title) => [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === title);

describe('dashboard', () => {
  beforeEach(boot);

  it('shows recent inspection times in local time', async () => {
    store.put('inspections', { id: 'i1', formId: 'f1', formName: 'Pre-trip', vehicleId: 'v1', date: '2026-10-12', startedAt: '2026-10-12T16:30:00.000Z', submittedAt: '2026-10-12T16:40:00.000Z', results: [], failed: 0 });
    await dashboard();
    const row = panel('Recent inspections').querySelector('.dash-row');
    expect(row.textContent).toContain('9:40');
    expect(row.textContent).not.toContain('4:30');
  });

  it('compares this month so far with the same days of last month', async () => {
    store.put('expenses', { vehicleId: 'v1', date: '2026-09-05', type: 'Tolls', amount: 10000 });
    store.put('expenses', { vehicleId: 'v1', date: '2026-09-25', type: 'Insurance', amount: 100000 });
    store.put('expenses', { vehicleId: 'v1', date: '2026-10-03', type: 'Tolls', amount: 20000 });
    await dashboard();
    const trend = panel('Operating costs').querySelector('.trend');
    // Oct 1-12 ($200) against Sep 1-12 ($100), not against all of September.
    expect(trend.textContent).toMatch(/^100% /);
    expect(trend.classList.contains('up')).toBe(true);
  });

  it('works out cost per mile from vehicles measured in miles only', async () => {
    store.put('vehicles', { id: 'v2', name: 'Import truck', status: 'active', meterUnit: 'km' });
    store.put('meters', { vehicleId: 'v1', date: '2026-09-20', value: 10000 });
    store.put('meters', { vehicleId: 'v1', date: '2026-10-10', value: 11000 });
    store.put('meters', { vehicleId: 'v2', date: '2026-09-20', value: 50000 });
    store.put('meters', { vehicleId: 'v2', date: '2026-10-10', value: 53000 });
    store.put('expenses', { vehicleId: 'v1', date: '2026-10-01', type: 'Tolls', amount: 10000 });
    store.put('expenses', { vehicleId: 'v2', date: '2026-10-01', type: 'Tolls', amount: 10000 });
    await dashboard();
    const text = panel('Operating costs').textContent;
    expect(text).toContain('1,000 mi');
    expect(text).toMatch(/Cost per mi, 30 days\D*0\.10\D/);
  });
});
