// @vitest-environment jsdom
/** Reports: filters, CSV export, printing; fuel and expense lists. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  Element.prototype.scrollIntoView ??= function () {};
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
});

let app;
let store;
const opened = [];

// Unsubscribe views a test left open, so a pending redraw cannot run
// after the test environment is torn down.
afterEach(() => opened.splice(0).forEach((dispose) => dispose()));

async function boot() {
  ({ app } = await import('../src/app.js'));
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { bucketOf } = await import('../src/core/schema.js');
  const { defaultSettings } = await import('../src/core/settings.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  store = createStore({ backend: createMemoryBackend({ settings: { ...defaultSettings(), groups: [{ id: 'g1', name: 'North depot' }] } }, { bucketOf }), flushDelay: 0 });
  await store.init();
  app.store = store;
  store.put('vehicles', { id: 'v1', name: 'Van 1', groupId: 'g1', type: 'Van', meterUnit: 'mi' });
  store.put('vehicles', { id: 'v2', name: 'Truck 2', groupId: null, type: 'Box truck', meterUnit: 'mi' });
  document.body.innerHTML = '';
}

async function view(name, params = {}, query = {}) {
  const mod = await import(`../src/views/${name}.js`);
  const disposers = [];
  const ctx = {
    params,
    query,
    live: (fn) => {
      const node = document.createElement('div');
      const draw = () => node.replaceChildren(...[fn()].flat().filter(Boolean));
      draw();
      node.redraw = draw;
      return node;
    },
    onDispose: (fn) => disposers.push(fn),
  };
  const out = mod.render(ctx);
  document.body.append(out.node || out);
  const dispose = () => disposers.splice(0).forEach((d) => d());
  opened.push(dispose);
  return { out, dispose };
}

// Capture what "Export CSV" downloads.
async function csvOf(click) {
  let text = null;
  const blobs = [];
  const orig = URL.createObjectURL;
  URL.createObjectURL = (b) => (blobs.push(b), 'blob:x');
  URL.revokeObjectURL ??= () => {};
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    click();
    text = await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.readAsText(blobs[0]);
    });
  } finally {
    URL.createObjectURL = orig;
    clickSpy.mockRestore();
  }
  return text.trim().split('\r\n').map((l) => l.split(','));
}

const metric = (label) => [...document.querySelectorAll('.metric')].find((m) => m.querySelector('.metric-label')?.textContent === label)?.querySelector('.metric-value')?.textContent;

describe('report filters', () => {
  beforeEach(boot);

  it('applies the vehicle group filter to expenses by type', async () => {
    store.put('expenses', { vehicleId: 'v1', date: '2026-10-01', type: 'Tolls', amount: 1500 });
    store.put('expenses', { vehicleId: 'v2', date: '2026-10-01', type: 'Tolls', amount: 98500 });
    await view('report', { id: 'expenses' }, { group: 'g1' });
    expect(metric('Total')).toMatch(/15\.00/);
    expect(metric('Entries')).toBe('1');
  });

  it('applies the vehicle type filter to service by task', async () => {
    const line = (cost) => [{ id: 'l', taskId: null, description: 'Oil change', laborCost: cost, parts: [] }];
    store.put('serviceEntries', { vehicleId: 'v1', date: '2026-10-01', lineItems: line(5000) });
    store.put('serviceEntries', { vehicleId: 'v2', date: '2026-10-02', lineItems: line(7000) });
    await view('report', { id: 'tasks' }, { type: 'Van' });
    const row = document.querySelector('tbody tr');
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(row.textContent).toMatch(/50\.00/);
  });

  it('applies the vehicle group filter to the most failed items', async () => {
    const sub = (vehicleId, label) => ({ formId: 'f', formName: 'Daily', vehicleId, date: '2026-10-01', failed: 1, results: [{ itemId: label, label, type: 'passfail', value: 'fail', pass: false }] });
    store.put('inspections', sub('v1', 'Horn'));
    store.put('inspections', sub('v2', 'Brakes'));
    await view('report', { id: 'inspections' }, { group: 'g1' });
    const failures = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Most failed items');
    expect(failures.textContent).toContain('Horn');
    expect(failures.textContent).not.toContain('Brakes');
  });
});

describe('report vehicle type filter', () => {
  beforeEach(boot);

  it('offers vehicle types that are in use but no longer in settings', async () => {
    store.put('vehicles', { id: 'v3', name: 'Tow 3', type: 'Tow truck', meterUnit: 'mi' });
    await view('report', { id: 'costs' });
    const select = document.querySelector('select[aria-label="Vehicle type"]');
    expect([...select.options].map((o) => o.value)).toContain('Tow truck');
  });
});

describe('report link to a removed group', () => {
  beforeEach(boot);

  it('shows the whole fleet, as the group menu says', async () => {
    store.put('expenses', { vehicleId: 'v1', date: '2026-10-01', type: 'Tolls', amount: 1500 });
    await view('report', { id: 'costs' }, { group: 'gone' });
    expect(document.querySelector('select[aria-label="Vehicle group"]').value).toBe('');
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
  });
});

describe('CSV export', () => {
  beforeEach(boot);
  const fuel = () => {
    store.put('fuel', { id: 'a', vehicleId: 'v1', date: '2026-10-01', meter: 1000, volume: 10, price: 3, total: 3000, kind: 'fuel' });
    store.put('fuel', { id: 'b', vehicleId: 'v1', date: '2026-10-05', meter: 1100, volume: 10, price: 3, total: 3000, kind: 'fuel' });
  };
  const col = (rows, label) => rows.slice(1).map((r) => r[rows[0].indexOf(label)]);

  it('exports the fuel report cost per meter in currency, not cents', async () => {
    fuel();
    await view('report', { id: 'fuel' });
    const rows = await csvOf(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Export CSV')).click());
    expect(col(rows, 'Fuel cost per meter')).toEqual(['0.60']);
    expect(col(rows, 'Cost')).toEqual(['60.00']);
  });

  it('exports the fuel list cost per meter in currency, not cents', async () => {
    fuel();
    await view('fuel', {}, { tab: 'all' });
    document.querySelector('button[aria-label="More actions"]').click();
    const exp = [...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent.includes('Export to CSV'));
    const rows = await csvOf(() => exp.click());
    expect(col(rows, 'Cost per meter').sort()).toEqual(['', '0.30']);
  });
});

describe('printing a report', () => {
  beforeEach(boot);

  it('prints every row, not only the first page, and names the filters', async () => {
    for (let i = 0; i < 60; i++) {
      store.put('vehicles', { id: `x${i}`, name: `Unit ${i}`, groupId: 'g1', meterUnit: 'mi' });
      store.put('expenses', { vehicleId: `x${i}`, date: '2026-10-01', type: 'Tolls', amount: 100 + i });
    }
    const { dispose } = await view('report', { id: 'costs' }, { group: 'g1' });
    expect(document.querySelectorAll('.table tbody tr')).toHaveLength(50);
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.querySelectorAll('.table tbody tr')).toHaveLength(60);
    expect(document.querySelector('.print-only').textContent).toContain('North depot');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.querySelectorAll('.table tbody tr')).toHaveLength(50);
    dispose();
  });
});

describe('expenses list', () => {
  beforeEach(boot);

  it('opens an expense from its card on a phone', async () => {
    store.put('expenses', { id: 'e1', vehicleId: 'v1', date: '2026-10-01', type: 'Tolls', amount: 1500 });
    await view('expenses');
    const card = document.querySelector('.grid-cards .grid-card');
    expect(card.tagName).toBe('BUTTON');
    card.click();
    await settle();
    expect(document.querySelector('dialog[open]')?.textContent).toContain('Edit expense');
  });

  it('can filter by an expense type that is no longer in settings', async () => {
    store.put('expenses', { id: 'e1', vehicleId: 'v1', date: '2026-10-01', type: 'Road tax', amount: 1500 });
    await view('expenses');
    [...document.querySelectorAll('.filter-btn')].find((b) => b.textContent.includes('Type')).click();
    const labels = [...document.querySelectorAll('.filter-option')].map((l) => l.textContent);
    expect(labels.some((t) => t.startsWith('Road tax'))).toBe(true);
    expect(labels.some((t) => t.startsWith('Insurance'))).toBe(true);
  });
});

describe('report date range', () => {
  beforeEach(boot);

  it('describes an open-ended custom range on the printout', async () => {
    await view('report', { id: 'costs' }, { range: 'custom', from: '2026-09-01', to: '2026-09-30' });
    const set = (label, v) => {
      const el = document.querySelector(`input[aria-label="${label}"]`);
      el.value = v;
      el.dispatchEvent(new Event('change'));
    };
    set('From', '');
    expect(document.querySelector('.print-only').textContent).toMatch(/^Up to Sep 30, 2026$/);
    set('From', '2026-09-01');
    set('To', '');
    expect(document.querySelector('.print-only').textContent).toMatch(/^From Sep 1, 2026$/);
  });
});

describe('bulk delete', () => {
  beforeEach(boot);
  const selectAllAndDelete = async () => {
    document.querySelector('thead input[type=checkbox]').click();
    [...document.querySelectorAll('.bulk-bar button')].find((b) => b.textContent.includes('Delete')).click();
    await settle();
  };
  const dialogButton = (label) => [...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent === label);

  it('asks before deleting the selected expenses', async () => {
    store.put('expenses', { vehicleId: 'v1', date: '2026-10-01', type: 'Tolls', amount: 1500 });
    store.put('expenses', { vehicleId: 'v2', date: '2026-10-02', type: 'Tolls', amount: 2500 });
    await view('expenses');
    await selectAllAndDelete();
    dialogButton('Cancel').click();
    await settle();
    expect(store.all('expenses')).toHaveLength(2);
    // Cancelling keeps the selection, so Delete can be used again.
    [...document.querySelectorAll('.bulk-bar button')].find((b) => b.textContent.includes('Delete')).click();
    await settle();
    dialogButton('Delete').click();
    await settle();
    expect(store.all('expenses')).toHaveLength(0);
  });

  it('asks before deleting the selected fuel entries', async () => {
    store.put('fuel', { vehicleId: 'v1', date: '2026-10-01', volume: 10, total: 3000, kind: 'fuel' });
    await view('fuel', {}, { tab: 'all' });
    await selectAllAndDelete();
    dialogButton('Cancel').click();
    await settle();
    expect(store.all('fuel')).toHaveLength(1);
  });
});

describe('fuel summary report', () => {
  beforeEach(boot);

  it('labels each vehicle volume with its unit', async () => {
    store.put('vehicles', { id: 'ev', name: 'EV 3', fuelType: 'Electric', meterUnit: 'mi' });
    store.put('fuel', { vehicleId: 'ev', date: '2026-10-01', volume: 60, total: 900, kind: 'charge' });
    store.put('fuel', { vehicleId: 'v1', date: '2026-10-01', volume: 15, total: 4500, kind: 'fuel' });
    await view('report', { id: 'fuel' });
    const rowOf = (name) => [...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes(name));
    expect(rowOf('EV 3').textContent).toContain('60 kWh');
    expect(rowOf('Van 1').textContent).toContain('15 gal');
  });
});

describe('operating cost report', () => {
  beforeEach(boot);

  it('shows usage and cost per meter in each vehicle unit', async () => {
    store.put('vehicles', { id: 'fk', name: 'Forklift 4', type: 'Forklift', meterUnit: 'hr' });
    store.put('meters', { vehicleId: 'fk', date: '2026-09-01', value: 1000 });
    store.put('meters', { vehicleId: 'fk', date: '2026-10-01', value: 1100 });
    store.put('expenses', { vehicleId: 'fk', date: '2026-10-01', type: 'Other', amount: 5000 });
    await view('report', { id: 'costs' });
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Forklift 4'));
    expect(row.textContent).toContain('100 hr');
    expect(row.textContent).toMatch(/0\.50\/hr/);
    expect(document.querySelector('thead').textContent).not.toMatch(/Distance \(mi\)|Cost per mi/);
  });
});
