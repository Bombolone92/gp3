// @vitest-environment jsdom
/**
 * Leasing and maintenance: pure logic (listings, renewals, income ratio,
 * inspection comparison) plus a smoke test that renders every screen on the
 * demo portfolio.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { listingCandidates, listingStats, renewalBuckets, incomeRatio, ratioTone, raiseRent, screeningProgress, listingText } from '../src/views/leasing/shared.js';
import { compareInspections, insuranceState, workOrderTotal } from '../src/views/maintenance/shared.js';
import { previousInspection } from '../src/views/maintenance/inspection.js';

const today = '2026-10-12';
const rent = (amount, start) => [{ id: 'r', accountId: 'acc-rent', amount, day: 1, start }];

describe('listing candidates', () => {
  const properties = [{ id: 'p', name: 'Elm House', address: { street: '1 Elm St', city: 'Salem', state: 'OR' } }];
  const units = ['A', 'B', 'C', 'D'].map((n) => ({ id: n, propertyId: 'p', name: n, marketRent: 100000, beds: 2, baths: 1, sqft: 800 }));
  const leases = [
    { id: 'old', unitId: 'A', propertyId: 'p', type: 'fixed', start: '2025-01-01', end: '2026-09-30', recurring: rent(100000, '2025-01-01') },
    { id: 'b', unitId: 'B', propertyId: 'p', type: 'fixed-rollover', start: '2026-01-01', end: '2026-12-31', moveOut: { date: '2026-11-15' }, recurring: rent(100000, '2026-01-01') },
    { id: 'c', unitId: 'C', propertyId: 'p', type: 'fixed-rollover', start: '2026-01-01', end: '2026-12-31', recurring: rent(100000, '2026-01-01') },
    { id: 'd', unitId: 'D', propertyId: 'p', type: 'fixed', start: '2026-11-01', end: '2027-10-31', recurring: rent(100000, '2026-11-01') },
  ];
  const applicants = [{ id: 'x', unitId: 'A', status: 'new' }, { id: 'y', unitId: 'A', status: 'rejected' }];
  const out = listingCandidates({ units, properties, leases, applicants, today });

  it('includes vacant units and units with a tenant moving out, not occupied or pre-leased ones', () => {
    expect(out.map((c) => [c.unit.id, c.state]).sort()).toEqual([
      ['A', 'vacant'],
      ['B', 'leaving'],
    ]);
  });

  it('works out days vacant, availability and open applicants', () => {
    const a = out.find((c) => c.unit.id === 'A');
    expect(a.daysVacant).toBe(12);
    expect(a.applicants).toBe(1);
    expect(out.find((c) => c.unit.id === 'B').availableFrom).toBe('2026-11-16');
  });

  it('summarizes vacancy', () => {
    expect(listingStats(out)).toMatchObject({ vacant: 1, leaving: 1, listed: 0, avgDaysVacant: 12, rentLost: 100000 });
  });

  it('writes listing text without em dashes', () => {
    const text = listingText(out[0], { money: (c) => `$${c / 100}`, date: (d) => d });
    expect(text).toContain('Rent: $1000 per month');
    expect(text).not.toMatch(/\u2014/);
  });
});

describe('renewals', () => {
  const base = { propertyId: 'p', unitId: 'u', start: '2025-12-01', recurring: rent(100000, '2025-12-01') };
  const leases = [
    { ...base, id: 'soon', type: 'fixed-rollover', end: '2026-11-15' },
    { ...base, id: 'offered', type: 'fixed', end: '2026-12-31', renewal: { status: 'offered', offerRent: 103000 } },
    { ...base, id: 'later', type: 'fixed', end: '2027-06-30' },
    { ...base, id: 'leaving', type: 'fixed-rollover', end: '2026-12-31', moveOut: { date: '2026-12-31' } },
    { ...base, id: 'renewed', type: 'fixed', end: '2026-12-31' },
    { ...base, id: 'next', type: 'fixed', start: '2027-01-01', end: '2027-12-31', renewsLeaseId: 'renewed' },
    { ...base, id: 'm2m', type: 'at-will', end: null },
    { ...base, id: 'rolled', type: 'fixed-rollover', end: '2026-09-30' },
  ];
  const { columns, monthToMonth } = renewalBuckets(leases, today, { windowDays: 120, noticeDays: 60 });

  it('buckets leases ending within the window by renewal status', () => {
    expect(columns['not-started'].map((r) => r.lease.id)).toEqual(['soon']);
    expect(columns.offered.map((r) => r.lease.id)).toEqual(['offered']);
    expect(columns.declined.map((r) => r.lease.id)).toEqual(['leaving']);
    expect(columns.accepted.map((r) => r.lease.id)).toEqual(['renewed']);
    expect(columns.accepted[0].renewed.id).toBe('next');
  });

  it('a draft renewal leaves the lease waiting for a decision', () => {
    const withDraft = [{ ...base, id: 'old', type: 'fixed-rollover', end: '2026-11-15' }, { ...base, id: 'draft', draft: true, type: 'fixed', start: '2026-11-16', end: '2027-11-15', renewsLeaseId: 'old' }];
    const { columns: c } = renewalBuckets(withDraft, today, { windowDays: 120, noticeDays: 60 });
    expect(c['not-started'].map((r) => r.lease.id)).toEqual(['old']);
    expect(c.accepted).toEqual([]);
  });

  it('flags leases inside the notice period', () => {
    expect(columns['not-started'][0]).toMatchObject({ daysLeft: 34, expiringSoon: true, rent: 100000 });
    expect(columns.offered[0].offerRent).toBe(103000);
  });

  it('lists month-to-month leases separately', () => {
    expect(monthToMonth.map((r) => r.lease.id).sort()).toEqual(['m2m', 'rolled']);
    expect(monthToMonth.find((r) => r.lease.id === 'rolled').since).toBe('2026-10-01');
  });

  it('rounds rent increases to whole dollars', () => {
    expect(raiseRent(129500, 3)).toBe(133400);
    expect(raiseRent(100000, 0)).toBe(100000);
  });
});

describe('applicants', () => {
  it('computes the income to rent ratio and its tone', () => {
    expect(incomeRatio(450000, 150000)).toBe(3);
    expect(incomeRatio(0, 150000)).toBe(null);
    expect(ratioTone(3.1)).toBe('good');
    expect(ratioTone(2.6)).toBe('fair');
    expect(ratioTone(1.9)).toBe('low');
  });

  it('counts screening checks', () => {
    expect(screeningProgress({ screening: { creditChecked: true, incomeVerified: true } })).toEqual({ done: 2, total: 4 });
  });
});

describe('maintenance helpers', () => {
  it('compares inspections area by area', () => {
    const prev = { areas: [{ name: 'Kitchen', condition: 'good' }, { name: 'Bath', condition: 'poor' }] };
    const cur = { areas: [{ name: 'kitchen ', condition: 'damaged' }, { name: 'Bath', condition: 'fair' }, { name: 'Garage', condition: 'good' }] };
    expect(compareInspections(prev, cur).map((c) => c.change)).toEqual(['worse', 'better', 'new']);
  });

  it('finds the previous completed inspection of the same unit', () => {
    const all = [
      { id: '1', propertyId: 'p', unitId: 'u', status: 'completed', date: '2026-01-01' },
      { id: '2', propertyId: 'p', unitId: 'u', status: 'completed', date: '2026-05-01' },
      { id: '3', propertyId: 'p', unitId: 'other', status: 'completed', date: '2026-06-01' },
      { id: '4', propertyId: 'p', unitId: 'u', status: 'scheduled', date: '2026-10-01' },
    ];
    expect(previousInspection(all, all[3]).id).toBe('2');
    expect(previousInspection(all, all[0])).toBe(null);
  });

  it('compares a same-day move-in with the move-out, never the other way round', () => {
    const out = { id: 'o', propertyId: 'p', unitId: 'u', status: 'completed', type: 'move-out', date: '2026-10-01', createdAt: '2026-09-20T00:00:00Z' };
    const inn = { id: 'i', propertyId: 'p', unitId: 'u', status: 'completed', type: 'move-in', date: '2026-10-01', createdAt: '2026-09-10T00:00:00Z' };
    expect(previousInspection([out, inn], inn)?.id).toBe('o');
    expect(previousInspection([out, inn], out)).toBe(null);
  });

  it('flags vendor insurance that expired or expires within 30 days', () => {
    expect(insuranceState({ insuranceExpires: '2026-10-01' }, today)).toBe('expired');
    expect(insuranceState({ insuranceExpires: '2026-11-01' }, today)).toBe('soon');
    expect(insuranceState({ insuranceExpires: '2027-01-01' }, today)).toBe(null);
    expect(insuranceState({}, today)).toBe(null);
  });

  it('totals work order line items in cents', () => {
    expect(workOrderTotal({ items: [{ qty: 2, amount: 1250 }, { qty: 1.5, amount: 1001 }] })).toBe(4002);
  });
});

// ---- Screens ------------------------------------------------------------------

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  window.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.IntersectionObserver ??= window.IntersectionObserver;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
});

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('leasing and maintenance screens render on demo data', () => {
  let ctx;
  beforeAll(async () => {
    const { app } = await import('../src/app.js');
    const { createStore } = await import('../src/core/store.js');
    const { createMemoryBackend } = await import('../src/core/backend.js');
    const { buildSampleData } = await import('../src/core/sample.js');
    const { buildShell } = await import('../src/ui/shell.js');
    const { startViews } = await import('../src/ui/viewhost.js');
    app.demo = true;
    app.today = () => today;
    app.store = createStore({ backend: createMemoryBackend(buildSampleData(today)) });
    await app.store.init();
    document.body.innerHTML = '<div id="app"></div>';
    const shell = buildShell({});
    document.getElementById('app').append(shell.root);
    startViews(shell.main);
    ctx = { app, main: shell.main };
  });

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

  const routes = () => [
    ['#/listings', /Listings/],
    ['#/listings?show=listed', /Listings/],
    ['#/applicants', /Applicants/],
    ['#/applicants?status=all', /Applicants/],
    ['#/applicants/new', /New applicant/],
    [`#/applicants/${first('applicants', (a) => a.status === 'approved')}`, /./],
    [`#/applicants/${first('applicants')}/edit`, /Edit/],
    ['#/renewals', /Renewals/],
    ['#/work-orders', /Work orders/],
    ['#/work-orders?status=all', /Work orders/],
    ['#/work-orders/new', /New work order/],
    [`#/work-orders/${first('workOrders')}`, /./],
    [`#/work-orders/${first('workOrders', (w) => (w.items || []).length || w.status === 'completed')}`, /./],
    [`#/work-orders/${first('workOrders')}/edit`, /Edit WO-/],
    ['#/vendors', /Vendors/],
    ['#/vendors/new', /New vendor/],
    [`#/vendors/${first('vendors')}`, /./],
    [`#/vendors/${first('vendors')}?tab=bills`, /./],
    [`#/vendors/${first('vendors')}?tab=payments`, /./],
    [`#/vendors/${first('vendors')}/edit`, /Edit/],
    ['#/inspections', /Inspections/],
    [`#/inspections/${first('inspections')}`, /inspection/i],
  ];

  it('renders every route with a heading and no crash', async () => {
    for (const [hash, heading] of routes()) {
      await go(hash);
      const h1 = ctx.main.querySelector('h1');
      expect(h1, hash).toBeTruthy();
      expect(h1.textContent, hash).toMatch(heading);
      expect(ctx.main.textContent, hash).not.toMatch(/Something went wrong|Page not found|not found/);
    }
  });

  it('shows the demo listings and the work order board', async () => {
    await go('#/listings');
    expect(ctx.main.querySelectorAll('.listing-card').length + ctx.main.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    localStorage.setItem('pm.workOrders.view', 'board');
    await go('#/work-orders?q=');
    await go('#/work-orders');
    expect(ctx.main.querySelectorAll('.board-col').length).toBe(5);
    localStorage.removeItem('pm.workOrders.view');
  });

  /** Submit a form twice while the server is slow to hand out a number. */
  const doubleSubmit = async (form, coll) => {
    const store = ctx.app.store;
    const next = store.nextNumber;
    store.nextNumber = (c) => new Promise((r) => setTimeout(() => r(next(c)), 80));
    const count = store.all(coll).length;
    try {
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      await new Promise((r) => setTimeout(r, 250));
    } finally {
      store.nextNumber = next;
    }
    return store.all(coll).length - count;
  };

  it('creating a task or work order twice in a row makes one', async () => {
    await go('#/tasks/new');
    let form = ctx.main.querySelector('form');
    form.querySelector('input[name=title], input').value = 'Fix the gate';
    expect(await doubleSubmit(form, 'tasks')).toBe(1);

    await go('#/work-orders/new');
    form = ctx.main.querySelector('form');
    form.querySelector('input[name=title], input').value = 'Gate hinge';
    const prop = form.querySelector('select[name=propertyId]');
    prop.value = ctx.app.store.all('properties')[0].id;
    prop.dispatchEvent(new Event('change', { bubbles: true }));
    expect(await doubleSubmit(form, 'workOrders')).toBe(1);
  });

  it('bills a work order net of its discount, and asks before billing it again', async () => {
    const store = ctx.app.store;
    const vendor = store.all('vendors')[0];
    const w = store.put('workOrders', { number: 900, title: 'Repair gate', propertyId: store.all('properties')[0].id, vendorId: vendor.id, status: 'completed', items: [{ description: 'Labor', qty: 1, amount: 20000 }, { description: 'Discount', qty: 1, amount: -5000 }] });
    await go(`#/work-orders/${w.id}`);
    const dialogs = () => [...document.querySelectorAll('dialog[open]')];
    const createBtn = () => [...ctx.main.querySelectorAll('.card button')].find((b) => /Create bill/.test(b.textContent));
    createBtn().click();
    for (let i = 0; i < 50 && !dialogs().length; i++) await settle();
    const dlg = dialogs().pop();
    const amounts = [...dlg.querySelectorAll('.tx-row-expense:not(.tx-row-head) .input.num')].map((i) => i.value);
    expect(amounts).toEqual(['150.00']);
    dlg.querySelector('.dialog-foot .btn.primary').click();
    for (let i = 0; i < 50 && !store.all('transactions').some((t) => t.kind === 'bill' && t.workOrderId === w.id); i++) await settle();
    expect(ctx.app.ledger().bill(store.all('transactions').find((t) => t.kind === 'bill' && t.workOrderId === w.id).id).total).toBe(15000);
    await settle();
    createBtn().click();
    for (let i = 0; i < 50 && !dialogs().length; i++) await settle();
    expect(dialogs().pop().textContent).toMatch(/already has a bill/);
    dialogs().pop().querySelector('.dialog-foot .btn:not(.primary)').click();
    await settle();
    expect(store.all('transactions').filter((t) => t.kind === 'bill' && t.workOrderId === w.id)).toHaveLength(1);
  });

  it('reopening a completed task or work order clears its completion date', async () => {
    const store = ctx.app.store;
    const task = store.put('tasks', { number: 950, title: 'Done once', kind: 'todo', status: 'completed', completedOn: '2026-10-01' });
    const wo = store.put('workOrders', { number: 951, title: 'Fixed once', propertyId: store.all('properties')[0].id, status: 'completed', completedOn: '2026-10-01' });
    for (const [hash, coll, id, status] of [[`#/tasks/${task.id}/edit`, 'tasks', task.id, 'in-progress'], [`#/work-orders/${wo.id}/edit`, 'workOrders', wo.id, 'in-progress']]) {
      await go(hash);
      const form = ctx.main.querySelector('form');
      const sel = [...form.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'completed'));
      sel.value = status;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      form.dispatchEvent(new Event('submit', { cancelable: true }));
      for (let i = 0; i < 20 && store.get(coll, id).status !== status; i++) await settle();
      expect(store.get(coll, id)).toMatchObject({ status, completedOn: null });
    }
  });

  it("doesn't offer to email about a task when nobody on it has an email address", async () => {
    const store = ctx.app.store;
    const tenant = store.put('tenants', { firstName: 'No', lastName: 'Email', emails: [], phones: ['555-0100'] });
    const task = store.put('tasks', { number: 960, title: 'Leaky tap', kind: 'resident', status: 'new', tenantId: tenant.id });
    await go(`#/tasks/${task.id}`);
    ctx.main.querySelector('button[aria-label="More actions"]').click();
    await settle();
    const labels = [...document.querySelectorAll('[role=menuitem]')].map((x) => x.textContent.trim());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(labels).not.toContain('Email');
  });

  it('closing a completed task keeps its completed date', async () => {
    const store = ctx.app.store;
    const task = store.put('tasks', { number: 970, title: 'Done then closed', kind: 'todo', status: 'completed', completedOn: '2026-10-01' });
    await go(`#/tasks/${task.id}/edit`);
    const form = ctx.main.querySelector('form');
    const sel = [...form.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'closed'));
    sel.value = 'closed';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    for (let i = 0; i < 20 && store.get('tasks', task.id).status !== 'closed'; i++) await settle();
    expect(store.get('tasks', task.id)).toMatchObject({ status: 'closed', completedOn: '2026-10-01' });
  });

  it('changes a work order status from its card menu', async () => {
    const w = ctx.app.store.all('workOrders').find((x) => x.status === 'new');
    const { setStatus } = await import('../src/views/maintenance/work-orders.js');
    setStatus(w, 'in-progress');
    expect(ctx.app.store.get('workOrders', w.id).status).toBe('in-progress');
    setStatus(ctx.app.store.get('workOrders', w.id), 'completed');
    expect(ctx.app.store.get('workOrders', w.id).completedOn).toBe(today);
  });
});
