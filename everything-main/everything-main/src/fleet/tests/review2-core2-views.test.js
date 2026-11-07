// @vitest-environment jsdom
/** Wave 2 review: reports, dashboard, and renewals screens. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

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
  document.body.innerHTML = '';
}

// Lives redraw on store changes, as in the app.
let lives = [];
let disposers = [];
afterEach(() => {
  disposers.forEach((d) => d());
  disposers = [];
});
async function view(name, params = {}, query = {}) {
  const mod = await import(`../src/views/${name}.js`);
  const ctx = {
    params,
    query,
    route: { path: `/${name}` },
    live: (fn) => {
      const node = document.createElement('div');
      const draw = () => node.replaceChildren(...[fn()].flat().filter(Boolean));
      draw();
      node.redraw = draw;
      lives.push(draw);
      return node;
    },
    onDispose: (fn) => disposers.push(fn),
  };
  const out = mod.render(ctx);
  document.body.append(out.node || out);
  return out;
}
const redrawAll = () => lives.forEach((d) => d());

async function csvOf(click) {
  const blobs = [];
  const orig = URL.createObjectURL;
  URL.createObjectURL = (b) => (blobs.push(b), 'blob:x');
  URL.revokeObjectURL ??= () => {};
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    click();
    const text = await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.readAsText(blobs[0]);
    });
    return text.trim().split('\r\n').map((l) => l.split(','));
  } finally {
    URL.createObjectURL = orig;
    clickSpy.mockRestore();
  }
}

const firstColumn = () => [...document.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td').textContent);
const header = (label) => [...document.querySelectorAll('th button.sort')].find((b) => b.textContent === label);

describe('report table sort', () => {
  beforeEach(async () => {
    lives = [];
    await boot();
    store.put('vehicles', { id: 'v1', name: 'Bravo', meterUnit: 'mi' });
    store.put('vehicles', { id: 'v2', name: 'Alpha', meterUnit: 'mi' });
    store.put('vehicles', { id: 'v3', name: 'Charlie', meterUnit: 'mi' });
    store.put('expenses', { vehicleId: 'v1', date: '2026-10-01', type: 'Tolls', amount: 3000 });
    store.put('expenses', { vehicleId: 'v2', date: '2026-10-01', type: 'Tolls', amount: 1000 });
    store.put('expenses', { vehicleId: 'v3', date: '2026-10-01', type: 'Tolls', amount: 2000 });
  });

  it('keeps the sort the person picked when the report updates', async () => {
    await view('report', { id: 'costs' });
    expect(firstColumn()).toEqual(['Bravo', 'Charlie', 'Alpha']);
    header('Vehicle').click();
    expect(firstColumn()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    store.put('expenses', { vehicleId: 'v3', date: '2026-10-02', type: 'Tolls', amount: 100 });
    redrawAll();
    expect(firstColumn()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(header('Vehicle').closest('th').getAttribute('aria-sort')).toBe('ascending');
  });

  it('exports rows in the order on screen', async () => {
    const out = await view('report', { id: 'costs' });
    header('Vehicle').click();
    header('Vehicle').click();
    expect(firstColumn()).toEqual(['Charlie', 'Bravo', 'Alpha']);
    const exportBtn = [...out.node.querySelectorAll('button')].find((b) => b.textContent === 'Export CSV');
    const rows = await csvOf(() => exportBtn.click());
    expect(rows.slice(1).map((r) => r[0])).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });

  it('exports in the default order before any header is clicked', async () => {
    const out = await view('report', { id: 'costs' });
    const exportBtn = [...out.node.querySelectorAll('button')].find((b) => b.textContent === 'Export CSV');
    const rows = await csvOf(() => exportBtn.click());
    expect(rows.slice(1).map((r) => r[0])).toEqual(['Bravo', 'Charlie', 'Alpha']);
  });
});

describe('utilization chart', () => {
  beforeEach(async () => {
    lives = [];
    await boot();
  });
  const bars = () => [...document.querySelectorAll('.bar-item')].map((li) => ({ label: li.children[0].textContent, text: li.children[1].textContent, width: parseFloat(li.querySelector('.bar-fill').style.width) }));

  it('compares kilometers and miles as distances, each labeled in its own unit', async () => {
    store.put('vehicles', { id: 'v1', name: 'Van', meterUnit: 'mi' });
    store.put('vehicles', { id: 'v2', name: 'Import truck', meterUnit: 'km' });
    store.put('meters', { vehicleId: 'v1', date: '2026-10-01', value: 10000 });
    store.put('meters', { vehicleId: 'v1', date: '2026-10-10', value: 11000 });
    store.put('meters', { vehicleId: 'v2', date: '2026-10-01', value: 50000 });
    store.put('meters', { vehicleId: 'v2', date: '2026-10-10', value: 51000 });
    await view('report', { id: 'utilization' });
    const [first, second] = bars();
    // 1,000 mi is farther than 1,000 km, so it leads with the longer bar.
    expect(first).toMatchObject({ label: 'Van', text: '1,000 mi', width: 100 });
    expect(second).toMatchObject({ label: 'Import truck', text: '1,000 km' });
    expect(second.width).toBeCloseTo(62.1, 0);
  });
});

describe('dashboard', () => {
  beforeEach(async () => {
    lives = [];
    await boot();
  });
  const metricValue = (label) => [...document.querySelectorAll('.metric')].find((m) => m.querySelector('.metric-label')?.textContent === label)?.querySelector('.metric-value')?.textContent;

  it('stops counting a vehicle whose assignment has ended', async () => {
    // Saved while the assignment was current; it ended yesterday.
    store.put('vehicles', { id: 'v1', name: 'Van', status: 'active', operatorId: 'c1' });
    store.put('assignments', { vehicleId: 'v1', contactId: 'c1', start: '2026-09-01', end: '2026-10-11' });
    store.put('vehicles', { id: 'v3', name: 'Pickup', status: 'active', operatorId: 'c3' });
    store.put('assignments', { vehicleId: 'v3', contactId: 'c3', start: '2026-01-01', end: null });
    await view('dashboard');
    expect(metricValue('Assigned')).toBe('1');
    expect(metricValue('Unassigned')).toBe('1');
  });

  it('counts a vehicle whose assignment began today', async () => {
    // Entered ahead of time, so the stored operator is still empty.
    store.put('vehicles', { id: 'v2', name: 'Truck', status: 'active', operatorId: null });
    store.put('assignments', { vehicleId: 'v2', contactId: 'c2', start: '2026-10-12', end: null });
    await view('dashboard');
    expect(metricValue('Assigned')).toBe('1');
    expect(metricValue('Unassigned')).toBe('0');
  });
});

describe('renewals of archived vehicles', () => {
  beforeEach(async () => {
    lives = [];
    await boot();
    store.put('vehicles', { id: 'v1', name: 'Van', status: 'active' });
    store.put('vehicles', { id: 'v2', name: 'Sold truck', status: 'sold', archived: true });
    store.put('renewals', { kind: 'vehicle', vehicleId: 'v1', type: 'Registration', dueDate: '2026-10-01', history: [] });
    store.put('renewals', { kind: 'vehicle', vehicleId: 'v2', type: 'Registration', dueDate: '2026-10-01', history: [] });
    store.put('renewals', { kind: 'vehicle', vehicleId: 'v2', type: 'Insurance', dueDate: '2026-10-15', history: [] });
  });
  const tile = (title) => [...document.querySelectorAll('.tile')].find((t) => t.querySelector('.tile-title')?.textContent === title);
  const num = (t, label) => [...t.querySelectorAll('.tile-num')].find((n) => n.querySelector('.tile-label').textContent === label).querySelector('.tile-value').textContent;

  it('are left out of the dashboard counts and list', async () => {
    await view('dashboard');
    expect(num(tile('Renewals'), 'Overdue')).toBe('1');
    expect(num(tile('Renewals'), 'Due soon')).toBe('0');
    const panel = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Renewals due');
    expect(panel.querySelectorAll('.dash-row')).toHaveLength(1);
    expect(panel.textContent).not.toContain('Sold truck');
  });

  it('are not listed as open, overdue, or due soon', async () => {
    await view('renewals');
    const counts = Object.fromEntries([...document.querySelectorAll('[role="tab"]')].map((t) => [t.id.split('-tab-')[1], t.querySelector('.tab-count')?.textContent]));
    expect(counts).toMatchObject({ open: '1', overdue: '1', due_soon: '0' });
  });
});

describe('fuel summary report', () => {
  beforeEach(async () => {
    lives = [];
    await boot();
  });

  it('names the meter unit in fuel cost per meter', async () => {
    store.put('vehicles', { id: 'v1', name: 'Van', meterUnit: 'mi' });
    store.put('vehicles', { id: 'v2', name: 'Import truck', meterUnit: 'km' });
    for (const [vid, id, date, meter] of [['v1', 'a', '2026-10-01', 1000], ['v1', 'b', '2026-10-05', 1100], ['v2', 'c', '2026-10-01', 5000], ['v2', 'd', '2026-10-05', 5100]]) {
      store.put('fuel', { id, vehicleId: vid, date, meter, volume: 10, total: 3000, kind: 'fuel' });
    }
    await view('report', { id: 'fuel' });
    const col = [...document.querySelectorAll('thead th')].findIndex((th) => th.textContent === 'Fuel cost per meter');
    const cells = Object.fromEntries([...document.querySelectorAll('tbody tr')].map((tr) => [tr.children[0].textContent, tr.children[col].textContent]));
    expect(cells.Van).toMatch(/\/mi$/);
    expect(cells['Import truck']).toMatch(/\/km$/);
  });
});
