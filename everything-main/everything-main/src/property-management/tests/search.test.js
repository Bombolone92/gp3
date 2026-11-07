// @vitest-environment jsdom
/** Global search: the index and the command palette. */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
});

async function demoStore() {
  const { app } = await import('../src/app.js');
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { buildSampleData } = await import('../src/core/sample.js');
  app.today = () => '2026-10-12';
  app.store = createStore({ backend: createMemoryBackend(buildSampleData('2026-10-12')) });
  await app.store.init();
  return app;
}

describe('search', () => {
  it('finds units and leases by a property name changed after the first search', async () => {
    const app = await demoStore();
    const { createSearchIndex } = await import('../src/core/search.js');
    const search = createSearchIndex(app.store);
    const prop = app.store.all('properties').find((p) => app.store.all('units').some((u) => u.propertyId === p.id));
    expect(search(prop.name).some((g) => g.coll === 'units')).toBe(true);
    app.store.patch('properties', prop.id, { name: 'Zephyr Court' });
    const units = search('zephyr court').find((g) => g.coll === 'units');
    expect(units?.total).toBe(app.store.all('units').filter((u) => u.propertyId === prop.id).length);
    expect(search(prop.name).some((g) => g.coll === 'units')).toBe(false);
  });

  it('finds a phone number typed without its formatting, and letters like Ł and ø', async () => {
    const app = await demoStore();
    const { createSearchIndex } = await import('../src/core/search.js');
    const t = app.store.put('tenants', { firstName: 'Łukasz', lastName: 'Søren', phones: ['(503) 555-0199'] });
    const search = createSearchIndex(app.store);
    const found = (q) => search(q).find((g) => g.coll === 'tenants')?.items.some((i) => i.id === t.id) || false;
    for (const q of ['5035550199', '503-555-0199', '503.555.0199', '(503) 555-0199', 'lukasz', 'soren', 'Łukasz']) expect(found(q), q).toBe(true);
    expect(found('503-555-0198')).toBe(false);
  });

  it('Enter right after typing opens the match for what was typed', async () => {
    const app = await demoStore();
    const { openSearch } = await import('../src/ui/search.js');
    const tenant = app.store.all('tenants').find((t) => t.lastName);
    location.hash = '#/';
    openSearch();
    const input = document.querySelector('dialog.palette input');
    input.value = tenant.lastName;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(location.hash).toBe(`#/tenants/${tenant.id}`);
  });
});
