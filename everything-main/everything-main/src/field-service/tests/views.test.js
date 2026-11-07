// @vitest-environment jsdom
/**
 * Smoke test: boot the app shell on the demo data and render every screen,
 * failing on any exception or missing heading. Catches broken imports,
 * typos in rarely-used views, and crashes on real-looking data.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

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
});

const settle = () => new Promise((r) => setTimeout(r, 20));

async function bootDemo() {
  const { app } = await import('../src/app.js');
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { buildSampleData } = await import('../src/core/sample.js');
  const { buildShell } = await import('../src/ui/shell.js');
  const { startViews } = await import('../src/ui/viewhost.js');
  app.demo = true;
  app.today = () => '2026-10-12';
  app.store = createStore({ backend: createMemoryBackend(buildSampleData('2026-10-12')) });
  await app.store.init();
  document.body.innerHTML = '<div id="app"></div>';
  const shell = buildShell({});
  document.getElementById('app').append(shell.root);
  startViews(shell.main);
  return { app, main: shell.main };
}

describe('every screen renders on demo data', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await bootDemo();
  });

  // Views are loaded on demand; wait until the new one has rendered rather
  // than for a fixed time (CI machines can be much slower).
  const go = async (hash) => {
    const before = ctx.main.firstElementChild;
    location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    for (let i = 0; i < 250; i++) {
      await settle();
      const now = ctx.main.firstElementChild;
      if (now && now !== before && ctx.main.querySelector('h1')) break;
    }
    await settle();
  };

  const firstId = (coll) => ctx.app.store.all(coll)[0].id;

  const routes = () => [
    ['#/', /Good (morning|afternoon|evening)/],
    ['#/schedule?view=week', /to 17, 2026/],
    ['#/schedule?view=day', /Monday, October 12, 2026/],
    ['#/schedule?view=month', /October 2026/],
    ['#/schedule?view=list', /to Nov 10, 2026/],
    ['#/clients', /Clients/],
    ['#/clients/new', /New client/],
    [`#/clients/${firstId('clients')}`, /./],
    [`#/clients/${firstId('clients')}/edit`, /Edit/],
    ['#/requests', /Requests/],
    ['#/requests/new', /New request/],
    [`#/requests/${firstId('requests')}`, /Request #/],
    ['#/quotes', /Quotes/],
    ['#/quotes/new', /New quote/],
    [`#/quotes/${firstId('quotes')}`, /Quote #/],
    [`#/quotes/${firstId('quotes')}/edit`, /Edit quote/],
    ['#/jobs', /Jobs/],
    ['#/jobs/new', /New job/],
    [`#/jobs/${firstId('jobs')}`, /Job #/],
    [`#/jobs/${firstId('jobs')}/edit`, /Edit job/],
    ['#/invoices', /Invoices/],
    ['#/invoices/new', /New invoice/],
    [`#/invoices/${firstId('invoices')}`, /Invoice #/],
    ['#/payments', /Payments/],
    ['#/timesheets', /Timesheets/],
    ['#/expenses', /Expenses/],
    ['#/reports', /Reports/],
    ...['business', 'products', 'team', 'taxes', 'documents', 'lists', 'appearance', 'data', 'about'].map((s) => [`#/settings/${s}`, /Settings/]),
    ['#/nope', /Page not found/],
  ];

  it('renders each route without errors', async () => {
    const errors = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => errors.push(a.join(' ')));
    for (const [hash, heading] of routes()) {
      await go(hash);
      const h1 = ctx.main.querySelector('h1');
      expect(h1, `heading on ${hash}: ${errors.join(" / ").slice(0, 400)} ${ctx.main.textContent.slice(0, 200)}`).not.toBeNull();
      expect(h1.textContent, `heading on ${hash}`).toMatch(heading);
      expect(ctx.main.textContent).not.toMatch(/Something went wrong|undefined|NaN|\[object Object\]/);
    }
    spy.mockRestore();
    expect(errors).toEqual([]);
  });

  it('marks the current section in the navigation', async () => {
    await go('#/jobs');
    expect(document.querySelector('.rail [aria-current="page"]').textContent).toMatch(/Jobs/);
  });

  it('opens the search palette and finds a client', async () => {
    const { openSearch } = await import('../src/ui/search.js');
    const name = ctx.app.store.all('clients')[0].lastName;
    openSearch(name);
    await settle();
    const dlg = document.querySelector('dialog.palette');
    expect(dlg).not.toBeNull();
    expect(dlg.textContent).toContain(name);
    dlg.querySelector('.dialog-head button, button')?.click();
    dlg.remove();
  });
});
