// @vitest-environment jsdom
/** Settings screens. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
});

let store;

async function boot() {
  const { app } = await import('../src/app.js');
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { bucketOf } = await import('../src/core/schema.js');
  const { defaultSettings } = await import('../src/core/settings.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  store = createStore({ backend: createMemoryBackend({ settings: { ...defaultSettings(), groups: [{ id: 'g1', name: 'North depot' }] } }, { bucketOf }), flushDelay: 0 });
  await store.init();
  app.store = store;
  document.body.innerHTML = '';
}

async function settings(section) {
  const mod = await import('../src/views/settings.js');
  const out = mod.render({ params: { section }, query: {}, live: (fn) => fn(), onDispose() {} });
  document.body.append(out.node);
}

const rename = (label, value) => {
  const el = document.querySelector(`input[aria-label="${label}"]`);
  el.value = value;
  el.dispatchEvent(new Event('change'));
  return el;
};

describe('settings lists', () => {
  beforeEach(boot);

  it('shows the saved name again when a name is emptied', async () => {
    await settings('vehicles');
    expect(rename('Vehicle types 1', '  ').value).toBe('Car');
    expect(rename('Status 1 name', '').value).toBe('Active');
    expect(rename('Group 1', '').value).toBe('North depot');
    expect(store.state.settings.vehicleTypes[0]).toBe('Car');
    expect(store.state.settings.groups[0].name).toBe('North depot');
  });

  it('does not rename a list entry to one that is already there', async () => {
    await settings('vehicles');
    expect(rename('Vehicle types 1', 'Van').value).toBe('Car');
    expect(store.state.settings.vehicleTypes.filter((t) => t === 'Van')).toHaveLength(1);
    expect(store.state.settings.vehicleTypes[0]).toBe('Car');
  });
});
