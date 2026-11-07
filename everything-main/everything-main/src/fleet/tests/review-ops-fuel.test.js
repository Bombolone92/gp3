// @vitest-environment jsdom
/** Fuel entry form: the volume, price and total calculation. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  Element.prototype.scrollIntoView ??= function () {};
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
  store.put('vehicles', { id: 'v1', name: 'Van 1', meterUnit: 'mi', fuelType: 'Gasoline' });
  document.body.innerHTML = '';
}

async function fuelForm(params = {}, query = { vehicle: 'v1' }) {
  const mod = await import('../src/views/fuel-form.js');
  const out = mod.render({ params, query, live: (fn) => fn(), onDispose() {} });
  document.body.append(out.node);
  return out;
}

const field = (name) => document.querySelector(`[name="${name}"]`);
const type = (name, value) => {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('input'));
};

describe('fuel form: any two of volume, price and total', () => {
  beforeEach(boot);

  it('fills the total from volume and price', async () => {
    await fuelForm();
    type('volume', '12.5');
    type('price', '3.459');
    expect(field('totalCents').value).toBe('43.24');
  });

  it('works out the missing one again after a field is cleared', async () => {
    await fuelForm();
    type('volume', '10');
    type('price', '3');
    expect(field('totalCents').value).toBe('30.00');
    // Clearing the volume leaves it empty rather than filling it back in.
    type('volume', '');
    expect(field('volume').value).toBe('');
    // Price and total are now the two given, so the volume follows.
    type('totalCents', '45');
    expect(field('volume').value).toBe('15');
  });
});

describe('fuel form warnings', () => {
  beforeEach(boot);

  it('warns once about an odometer lower than an earlier fill-up', async () => {
    const { saveFuel } = await import('../src/core/actions.js');
    saveFuel(store, { vehicleId: 'v1', date: '2026-10-01', meter: 12000, volume: 10, total: 3000, kind: 'fuel' });
    await fuelForm();
    type('meter', '11000');
    const warnings = [...document.querySelectorAll('.form-warning p')].map((p) => p.textContent);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/lower/);
  });
});

describe('saving a fuel entry', () => {
  beforeEach(boot);

  it('adds one entry when Save is clicked twice', async () => {
    await fuelForm();
    type('volume', '10');
    type('price', '3');
    const save = document.querySelector('.form-foot button[type=submit]');
    save.click();
    await new Promise((r) => setTimeout(r, 0));
    // The fuel list is still loading, so the form is still on screen.
    save.click();
    await new Promise((r) => setTimeout(r, 5));
    expect(store.all('fuel')).toHaveLength(1);
    expect(store.all('meters')).toHaveLength(0);
  });
});
