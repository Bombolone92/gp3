// @vitest-environment jsdom
/**
 * Forms inside the booted app shell: leaving a form, and the page's own
 * reloads.
 */
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
  HTMLCanvasElement.prototype.getContext ??= () => null;
});

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

let ctx;
async function boot() {
  const { app } = await import('../src/app.js');
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { bucketOf } = await import('../src/core/schema.js');
  const { buildSampleData } = await import('../src/core/sample.js');
  const { buildShell } = await import('../src/ui/shell.js');
  const { startViews } = await import('../src/ui/viewhost.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  app.store = createStore({ backend: createMemoryBackend(buildSampleData('2026-10-12'), { bucketOf }) });
  await app.store.init();
  document.body.innerHTML = '<div id="app"></div>';
  const shell = buildShell({});
  document.getElementById('app').append(shell.root);
  startViews(shell.main);
  return { app, main: shell.main };
}

const heading = () => ctx.main.querySelector('h1')?.textContent;
async function waitFor(text) {
  for (let i = 0; i < 200 && heading() !== text; i++) await tick();
  await tick();
}
const cancel = () => [...ctx.main.querySelectorAll('.form-foot button')].find((b) => b.textContent === 'Cancel').click();

beforeAll(async () => {
  // Opened straight from a link, in a new tab: no app page behind it.
  history.replaceState(null, '', '#/fuel/new');
  ctx = await boot();
  await waitFor('New fuel entry');
});

describe('cancelling a form', () => {
  it('stays in the app when the form was opened from a link', async () => {
    cancel();
    await waitFor('Fuel and energy');
    expect(location.hash).toBe('#/fuel');
    expect(heading()).toBe('Fuel and energy');
  });

  it('goes back to the page the form was opened from', async () => {
    location.hash = '#/vendors';
    await waitFor('Vendors');
    location.hash = '#/issues/new';
    await waitFor('New issue');
    cancel();
    await waitFor('Vendors');
    expect(location.hash).toBe('#/vendors');
  });
});

describe('leaving the page', () => {
  const unload = () => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };

  it('asks before closing with unsent changes, but not on the app\'s own reloads', async () => {
    const { reloadApp } = await import('../src/app.js');
    const store = ctx.app.store;
    location.hash = '#/vendors';
    await waitFor('Vendors');
    // A change still waiting to be sent (offline, say).
    let pending = 1;
    const { pendingCount, persistCache } = store;
    store.pendingCount = () => pending;
    try {
      expect(unload()).toBe(true);
      // Switching fleets, a new role: the change is kept on the device first.
      const saved = [];
      store.persistCache = async () => saved.push('cache');
      await reloadApp({ reload: () => saved.push('reload') && unload() && saved.push('asked') });
      expect(saved).toEqual(['cache', 'reload']);
      // A real close later still asks.
      expect(unload()).toBe(true);
      pending = 0;
      expect(unload()).toBe(false);
    } finally {
      Object.assign(store, { pendingCount, persistCache });
    }
  });

  it('still asks on the app\'s own reloads when a form has unsaved changes', async () => {
    const { reloadApp } = await import('../src/app.js');
    location.hash = '#/vendors/new';
    await waitFor('New vendor');
    const name = ctx.main.querySelector('input[name="name"]');
    name.value = 'Quick Lube';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    let asked = null;
    await reloadApp({ reload: () => (asked = unload()) });
    expect(asked).toBe(true);
  });
});
