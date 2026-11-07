// @vitest-environment jsdom
/**
 * Dashboard, tasks, calendar and communication: pure logic plus a smoke
 * test that renders every screen on the sample portfolio.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { ACC } from '../src/core/accounts.js';
import { buildCharge, buildPayment, computeIndex } from '../src/core/ledger.js';

beforeAll(() => {
  window.matchMedia ??= (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.requestAnimationFrame ??= window.requestAnimationFrame;
  window.cancelAnimationFrame ??= (id) => clearTimeout(id);
  globalThis.cancelAnimationFrame ??= window.cancelAnimationFrame;
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  };
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= function () {};
});

const TODAY = '2026-10-12';
const settle = () => new Promise((r) => setTimeout(r, 20));
const lease = { id: 'L1', propertyId: 'P1', unitId: 'U1' };

describe('dashboard figures', () => {
  it('compares this month collections with charges, leaving deposits out', async () => {
    const { monthCollection } = await import('../src/views/home.js');
    const txs = [
      buildCharge({ lease, date: '2026-10-01', items: [{ accountId: ACC.rent, amount: 100000 }, { accountId: ACC.depositsHeld, amount: 50000 }] }),
      buildPayment({ lease, date: '2026-10-03', amount: 110000, allocations: [{ accountId: ACC.depositsHeld, amount: 50000 }, { accountId: ACC.rent, amount: 60000 }] }),
      buildCharge({ lease, date: '2026-09-01', items: [{ accountId: ACC.rent, amount: 100000 }] }),
    ];
    expect(monthCollection(txs, '2026-10')).toEqual({ charged: 100000, collected: 60000 });
  });

  it('counts prepayments as collected', async () => {
    const { monthCollection } = await import('../src/views/home.js');
    const txs = [buildPayment({ lease, date: '2026-10-03', amount: 5000, allocations: [] })];
    expect(monthCollection(txs, '2026-10').collected).toBe(5000);
  });

  it('finds the oldest unpaid charge first in, first out', async () => {
    const { oldestUnpaid } = await import('../src/views/home.js');
    const txs = [
      buildCharge({ lease, date: '2026-08-01', items: [{ accountId: ACC.rent, amount: 1000 }] }),
      buildCharge({ lease, date: '2026-09-01', items: [{ accountId: ACC.rent, amount: 1000 }] }),
      buildPayment({ lease, date: '2026-09-05', amount: 1500, allocations: [{ accountId: ACC.rent, amount: 1500 }] }),
    ];
    expect(oldestUnpaid(computeIndex(txs).lease('L1'))).toBe('2026-09-01');
    expect(oldestUnpaid(computeIndex(txs.slice(0, 1)).lease('L1'))).toBe('2026-08-01');
    expect(oldestUnpaid(computeIndex([]).lease('L1'))).toBe(null);
  });

  it('counts rent paid early as credit, not as a debt', async () => {
    const { oldestUnpaid } = await import('../src/views/home.js');
    const { ACC } = await import('../src/core/accounts.js');
    const { computeIndex, buildCharge, buildPayment, buildApplyPrepayment } = await import('../src/core/ledger.js');
    const lease = { id: 'L1', propertyId: 'P1', unitId: 'U1' };
    const rent = (date) => buildCharge({ lease, date, items: [{ accountId: ACC.rent, amount: 100000 }] });
    const txs = [
      buildPayment({ lease, date: '2026-08-31', amount: 100000, allocations: [] }),
      rent('2026-09-01'),
      buildApplyPrepayment({ lease, date: '2026-09-01', items: [{ accountId: ACC.rent, amount: 100000 }] }),
      rent('2026-10-01'),
    ];
    const info = computeIndex(txs).lease('L1');
    expect(info.balance).toBe(100000);
    expect(oldestUnpaid(info)).toBe('2026-10-01');
  });

  it('describes due dates in plain words', async () => {
    const { dueText } = await import('../src/views/home.js');
    expect(dueText('2026-10-12', TODAY)).toBe('Due today');
    expect(dueText('2026-10-13', TODAY)).toBe('Due tomorrow');
    expect(dueText('2026-10-11', TODAY)).toBe('1 day overdue');
    expect(dueText('2026-10-02', TODAY)).toBe('10 days overdue');
  });
});

describe('email templates', () => {
  it('fills a late notice with the balance', async () => {
    const { fillTemplate } = await import('../src/views/compose.js');
    const out = fillTemplate('late-notice', { unitLabel: 'Maple Court · 1A', balance: 12500, company: 'Acme', fmt: (c) => `$${(c / 100).toFixed(2)}`, today: TODAY });
    expect(out.subject).toBe('Past due balance for Maple Court · 1A');
    expect(out.body).toContain('$125.00');
    expect(out.body).toContain('Acme');
    expect(out.body).not.toMatch(/\u2014/);
  });

  it('uses the renewal offer rent when there is one', async () => {
    const { fillTemplate } = await import('../src/views/compose.js');
    const day = (n) => fillTemplate('rent-reminder', { rentDay: n, fmt: String, today: TODAY }).body.match(/due on the (\w+) of/)[1];
    expect([1, 2, 3, 15, 21, 22, 23, 31].map(day)).toEqual(['1st', '2nd', '3rd', '15th', '21st', '22nd', '23rd', '31st']);
    const out = fillTemplate('renewal-offer', { lease: { end: '2026-12-31', renewal: { offerRent: 150000 } }, rent: 140000, fmt: (c) => String(c), today: TODAY });
    expect(out.body).toContain('150000');
  });
});

describe('every workspace screen renders on the sample portfolio', () => {
  let ctx;
  beforeAll(async () => {
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

  const firstId = (coll) => ctx.app.store.all(coll)[0].id;

  it('renders each route with a heading', async () => {
    const routes = [
      ['#/', /Good (morning|afternoon|evening)/],
      ['#/tasks', /Tasks/],
      ['#/tasks?view=done', /Tasks/],
      ['#/tasks/new', /New task/],
      [`#/tasks/${firstId('tasks')}`, /./],
      [`#/tasks/${firstId('tasks')}/edit`, /Edit task/],
      ['#/tasks/nope', /Task not found/],
      ['#/calendar', /Calendar/],
      ['#/calendar?view=agenda', /Calendar/],
      ['#/communication', /Communication/],
    ];
    for (const [hash, re] of routes) {
      await go(hash);
      const h1 = ctx.main.querySelector('h1');
      expect(h1, hash).toBeTruthy();
      expect(h1.textContent, hash).toMatch(re);
      expect(ctx.main.textContent, hash).not.toMatch(/Something went wrong|Not built yet/);
    }
  });

  it('shows the dashboard cards with real figures', async () => {
    await go('#/');
    const text = ctx.main.textContent;
    for (const t of ['Outstanding balances', 'Incoming requests', 'Expiring leases', 'Vacant units', 'Bills to pay', 'Income and expenses', 'This week', 'Rental applications', 'Overdue tasks']) expect(text).toContain(t);
    expect(ctx.main.querySelectorAll('.home-kpis .stat').length).toBe(4);
  });

  it('accepts an incoming request from the dashboard', async () => {
    await go('#/');
    const store = ctx.app.store;
    const before = store.all('tasks').filter((t) => t.status === 'new' && t.kind === 'resident').length;
    const btn = [...ctx.main.querySelectorAll('button')].find((b) => /^Accept /.test(b.getAttribute('aria-label') || ''));
    btn.click();
    await settle();
    expect(store.all('tasks').filter((t) => t.status === 'new' && t.kind === 'resident').length).toBe(before - 1);
  });

  it('creates a task from the form', async () => {
    await go('#/tasks/new');
    const store = ctx.app.store;
    const n = store.all('tasks').length;
    const form = ctx.main.querySelector('form.task-form');
    form.querySelector('input[name="title"]').value = 'Replace hallway bulb';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    for (let i = 0; i < 50 && store.all('tasks').length === n; i++) await settle();
    const created = store.all('tasks').find((t) => t.title === 'Replace hallway bulb');
    expect(created).toBeTruthy();
    expect(created.number).toBeGreaterThan(0);
  });

  it('lists calendar items in the month grid', async () => {
    await go('#/calendar?view=month&m=2026-10');
    expect(ctx.main.querySelector('[role="grid"]')).toBeTruthy();
    expect(ctx.main.querySelectorAll('[role="gridcell"]').length % 7).toBe(0);
    expect(ctx.main.querySelectorAll('.cal-item').length).toBeGreaterThan(0);
  });

  it('gathers calendar items of every type', async () => {
    const { calendarItems } = await import('../src/views/calendar.js');
    const store = ctx.app.store;
    store.put('events', { title: 'Owner meeting', date: '2026-10-20', start: '09:00' });
    const items = calendarItems(store, { from: '2026-09-01', to: '2026-12-31', today: TODAY, ledger: ctx.app.ledger() });
    const types = new Set(items.map((i) => i.type));
    for (const t of ['lease', 'maintenance', 'task', 'bill', 'event']) expect(types.has(t), t).toBe(true);
    const dates = items.map((i) => i.date);
    expect([...dates].sort()).toEqual(dates);
    expect(items.every((i) => i.date >= '2026-09-01' && i.date <= '2026-12-31')).toBe(true);
  });

  it('builds announcement audiences from current tenants', async () => {
    const { announcementAudience } = await import('../src/views/communication.js');
    const store = ctx.app.store;
    const all = announcementAudience(store, { today: TODAY });
    const maple = announcementAudience(store, { propertyId: 'pr-maple', today: TODAY });
    expect(all.recipients.length).toBeGreaterThan(maple.recipients.length);
    expect(maple.recipients.length).toBeGreaterThan(0);
    expect(new Set(all.recipients.map((r) => r.tenantId)).size).toBe(all.recipients.length);
    const withFuture = announcementAudience(store, { propertyId: 'pr-maple', includeFuture: true, today: TODAY });
    expect(withFuture.recipients.length).toBeGreaterThan(maple.recipients.length);
  });

  it('trying a send again keeps the message, so people who have it are skipped', async () => {
    const { composeEmail } = await import('../src/views/compose.js');
    const store = ctx.app.store;
    const payloads = [];
    const saved = { puter: globalThis.puter, demo: ctx.app.demo };
    globalThis.puter = {
      workers: {
        exec: async (url, init) => {
          const p = JSON.parse(init.body);
          payloads.push(p);
          return { ok: true, status: 200, json: async () => ({ ok: true, sent: 1, results: [{ email: 'pat@example.com', status: 'skipped', reason: 'already_sent' }, { email: 'sam@example.com', status: 'sent' }] }) };
        },
      },
    };
    ctx.app.demo = false;
    try {
      const done = composeEmail({ to: [{ name: 'Pat', email: 'pat@example.com' }, { name: 'Sam', email: 'sam@example.com' }], subject: 'Water off', body: 'Thursday', id: 'msg-earlier', kind: 'announcement', title: 'Try again' });
      const dlg = document.querySelector('dialog[open]');
      [...dlg.querySelectorAll('button')].find((b) => /^Send/.test(b.textContent.trim())).click();
      const msg = await done;
      expect(payloads[0].message).toMatchObject({ id: 'msg-earlier', kind: 'announcement' });
      expect(msg).toMatchObject({ id: 'msg-earlier', kind: 'announcement', status: 'sent' });
      expect(store.get('messages', 'msg-earlier').results.map((r) => r.status)).toEqual(['sent', 'sent']);
    } finally {
      globalThis.puter = saved.puter;
      ctx.app.demo = saved.demo;
    }
  });

  it('shows a renewal as a renewal, not a move-in and a lease ending', async () => {
    const { calendarItems } = await import('../src/views/calendar.js');
    const store = ctx.app.store;
    const unit = store.all('units')[0];
    const old = store.put('leases', { propertyId: unit.propertyId, unitId: unit.id, type: 'fixed', start: '2025-11-20', end: '2026-11-19', tenantIds: [], recurring: [] });
    const next = store.put('leases', { propertyId: unit.propertyId, unitId: unit.id, type: 'fixed', start: '2026-11-20', end: '2027-11-19', tenantIds: [], recurring: [], renewsLeaseId: old.id });
    store.patch('leases', old.id, { renewedByLeaseId: next.id });
    const items = calendarItems(store, { from: '2026-11-01', to: '2026-11-30', today: TODAY, ledger: ctx.app.ledger() });
    const mine = items.filter((i) => i.href === `#/leases/${old.id}` || i.href === `#/leases/${next.id}`);
    expect(mine.map((i) => i.title.split(':')[0])).toEqual(['Renewal starts']);
  });

  it('logs a message from the compose dialog in the demo', async () => {
    const { composeEmail } = await import('../src/views/compose.js');
    const store = ctx.app.store;
    const n = store.all('messages').length;
    const done = composeEmail({ to: [{ name: 'Pat', email: 'pat@example.com' }], subject: 'Hello', body: 'Testing' });
    const dlg = document.querySelector('dialog[open]');
    const save = [...dlg.querySelectorAll('button')].find((b) => b.textContent.includes('Save to log'));
    save.click();
    const msg = await done;
    expect(msg.status).toBe('logged');
    expect(store.all('messages').length).toBe(n + 1);
  });
});

describe('incoming request counts', () => {
  it('the nav badge counts the same requests as the dashboard and the Incoming view', async () => {
    const { navCounts } = await import('../src/core/counts.js');
    const { computeIndex } = await import('../src/core/ledger.js');
    const tasks = [
      { id: 'a', kind: 'resident', status: 'new' },
      { id: 'b', kind: 'owner', status: 'new' },
      { id: 'c', kind: 'contact', status: 'new' },
      { id: 'd', kind: 'todo', status: 'new' },
      { id: 'e', kind: 'resident', status: 'in-progress' },
    ];
    const store = { all: (c) => (c === 'tasks' ? tasks : []), get: () => null, state: { settings: {} } };
    expect(navCounts(store, '2026-10-12', computeIndex([])).tasks.n).toBe(3);
  });
});
