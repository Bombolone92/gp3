// @vitest-environment jsdom
/**
 * Smoke test: boot the app shell on the sample portfolio and render every
 * screen, failing on any exception, a crash screen, or a missing heading.
 * Catches broken imports, typos in rarely used views, and crashes on
 * real-looking data.
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
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const settle = () => new Promise((r) => setTimeout(r, 20));
const TODAY = '2026-10-12';

async function bootDemo() {
  const { app } = await import('../src/app.js');
  const { createStore } = await import('../src/core/store.js');
  const { createMemoryBackend } = await import('../src/core/backend.js');
  const { buildSampleData } = await import('../src/core/sample.js');
  const { buildShell } = await import('../src/ui/shell.js');
  const { startViews } = await import('../src/ui/viewhost.js');
  app.demo = true;
  app.today = () => TODAY;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(TODAY)) });
  await app.store.init();
  document.body.innerHTML = '<div id="app"></div>';
  const shell = buildShell({});
  document.getElementById('app').append(shell.root);
  startViews(shell.main);
  return { app, main: shell.main };
}

describe('every screen renders on the sample portfolio', () => {
  let ctx;
  const errors = [];
  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')));
    ctx = await bootDemo();
  });

  // Views load on demand; wait until the new one has rendered.
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

  const first = (coll, pred = () => true) => ctx.app.store.all(coll).find(pred)?.id;

  const routes = () => {
    const tx = (kind) => first('transactions', (t) => t.kind === kind);
    return [
      '#/',
      '#/properties',
      '#/properties/new',
      `#/properties/${first('properties')}`,
      `#/properties/${first('properties')}?tab=units`,
      `#/properties/${first('properties')}?tab=financials`,
      `#/properties/${first('properties')}/edit`,
      `#/units/${first('units')}`,
      '#/leases',
      '#/leases/new',
      `#/leases/new?unitId=${first('units', (u) => u.name === '1D')}`,
      `#/leases/new?renews=${first('leases', (l) => l.renewal?.status === 'accepted')}`,
      `#/leases/new?applicantId=${first('applicants', (a) => a.status === 'approved')}`,
      `#/work-orders/new?taskId=${first('tasks')}&propertyId=pr-maple`,
      `#/leases/${first('leases')}`,
      `#/leases/${first('leases')}?tab=ledger`,
      `#/leases/${first('leases')}/edit`,
      '#/tenants',
      '#/tenants/new',
      `#/tenants/${first('tenants')}`,
      '#/owners',
      '#/owners/new',
      `#/owners/${first('owners')}`,
      '#/balances',
      '#/listings',
      '#/applicants',
      '#/applicants/new',
      `#/applicants/${first('applicants')}`,
      '#/renewals',
      '#/financials',
      '#/ledger',
      `#/transactions/${tx('payment')}`,
      `#/transactions/${tx('bill')}`,
      '#/banking',
      '#/banking/acc-operating',
      '#/bills',
      `#/bills/${tx('bill')}`,
      '#/accounts',
      '#/accounts/acc-rent',
      '#/budgets',
      `#/budgets/${first('budgets')}`,
      '#/work-orders',
      '#/work-orders/new',
      `#/work-orders/${first('workOrders')}`,
      '#/vendors',
      '#/vendors/new',
      `#/vendors/${first('vendors')}`,
      '#/inspections',
      `#/inspections/${first('inspections')}`,
      '#/tasks',
      '#/tasks/new',
      `#/tasks/${first('tasks')}`,
      '#/communication',
      '#/calendar',
      '#/reports',
      '#/reports/rent-roll',
      '#/reports/income-statement',
      '#/reports/delinquency',
      '#/reports/balance-sheet',
      '#/reports/cash-flow',
      '#/reports/trial-balance',
      '#/reports/general-ledger',
      '#/reports/budget-vs-actual',
      '#/reports/unpaid-bills',
      '#/reports/deposits-held',
      '#/reports/tenant-ledger',
      '#/reports/vacancy',
      '#/reports/current-tenants',
      '#/reports/tenant-vehicles',
      '#/reports/leases-ending',
      '#/reports/renewal-status',
      '#/reports/applicants',
      '#/reports/work-orders',
      '#/reports/vendor-insurance',
      '#/reports/open-tasks',
      `#/reports/owner-statement?ownerId=ow-1`,
      '#/reports/owner-summary',
      '#/settings',
      '#/settings/accounting',
      '#/settings/late-fees',
      '#/settings/data',
      '#/settings/company',
      '#/settings/leases',
      '#/settings/lists',
      '#/settings/team',
      '#/settings/access',
      '#/settings/appearance',
      '#/settings/about',
      `#/properties/${first('properties')}?tab=leases`,
      `#/properties/${first('properties')}?tab=maintenance`,
      `#/leases/${first('leases')}?tab=tenants`,
      `#/vendors/${first('vendors')}`,
      `#/owners/${first('owners')}/edit`,
      `#/tenants/${first('tenants')}/edit`,
      `#/work-orders/${first('workOrders')}/edit`,
      `#/applicants/${first('applicants')}/edit`,
      `#/tasks/${first('tasks')}/edit`,
      `#/vendors/${first('vendors')}/edit`,
      '#/calendar?view=agenda',
    ];
  };

  it('renders each route with a heading and no crash screen', async () => {
    for (const hash of routes()) {
      await go(hash);
      const h1 = ctx.main.querySelector('h1');
      expect(h1, `no heading on ${hash}`).toBeTruthy();
      expect(ctx.main.textContent, `crash on ${hash}`).not.toMatch(/Something went wrong|Page not found|Not built yet/);
      // A null or undefined that reached the DOM as text, or bad math.
      expect(ctx.main.textContent, `stray value on ${hash}`).not.toMatch(/\bnull\b|\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date/);
      expect(ctx.main.querySelectorAll('a a, a button, button a, button button').length, `nested interactive elements on ${hash}`).toBe(0);
    }
    expect(errors.filter((e) => !/sync failed|cache/.test(e))).toEqual([]);
  }, 60000);

  it("screens do not reorder the store's own lists", async () => {
    const order = () => ['properties', 'owners', 'vendors', 'workOrders'].map((c) => ctx.app.store.all(c).map((r) => r.id).join());
    const before = order();
    for (const hash of ['#/leases', '#/balances', '#/work-orders', '#/work-orders/new', '#/properties/new']) await go(hash);
    expect(order()).toEqual(before);
  }, 30000);

  it('never uses an em dash in rendered text', async () => {
    for (const hash of ['#/', '#/leases', '#/financials', '#/reports', '#/settings']) {
      await go(hash);
      expect(ctx.main.textContent.includes('\u2014'), hash).toBe(false);
    }
  }, 30000);
});
