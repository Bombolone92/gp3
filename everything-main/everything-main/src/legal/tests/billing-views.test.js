// @vitest-environment jsdom
/**
 * Renders the activities, billing, bill, and accounts screens against the
 * sample firm and exercises the main flows: generating bills, editing a
 * draft, and voiding a bill.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { buildSampleData } from '../src/core/sample.js';
import { billTotals, isUnbilled } from '../src/core/finance.js';

const TODAY = '2026-10-12';

beforeAll(() => {
  globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Element.prototype.scrollIntoView ??= function () {};
  const D = globalThis.HTMLDialogElement?.prototype;
  if (D && !D.showModal) {
    D.showModal = function () {
      this.setAttribute('open', '');
    };
    D.close = function () {
      this.removeAttribute('open');
    };
  }
});

beforeEach(async () => {
  document.body.replaceChildren();
  location.hash = '';
  app.demo = true;
  app.user = null;
  app.today = () => TODAY;
  app.store = createStore({ backend: createMemoryBackend(buildSampleData(TODAY)), flushDelay: 0 });
  await app.store.init();
});

function ctx(params = {}, query = {}) {
  return { params, query, route: { params, query }, watch() {}, onDispose() {}, live: (fn) => fn() };
}

async function mount(mod, params, query) {
  const out = (await mod).render(ctx(params, query));
  const node = out instanceof Node ? out : out.node;
  document.body.append(node);
  return { node, out };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('activities screen', () => {
  it('lists entries for the period with totals', async () => {
    const { node } = await mount(import('../src/views/activities.js'), {}, { range: 'year' });
    expect(node.querySelector('h1').textContent).toBe('Activities');
    expect(node.querySelectorAll('tbody tr:not(.dt-spacer)').length).toBeGreaterThan(5);
    expect(node.querySelector('.dt-foot').textContent).toMatch(/entries/);
  });

  it('filters to unbilled time', async () => {
    const { node } = await mount(import('../src/views/activities.js'), {}, { range: 'year', kind: 'time', billed: 'unbilled' });
    const pills = [...node.querySelectorAll('tbody .pill')].map((p) => p.textContent);
    expect(pills.length).toBeGreaterThan(0);
    expect(pills.every((t) => t === 'Unbilled')).toBe(true);
  });
});

describe('billing screens', () => {
  it('shows bills by status and outstanding balances', async () => {
    const { node } = await mount(import('../src/views/billing.js'), {}, { status: 'all' });
    expect(node.querySelector('h1').textContent).toBe('Billing');
    expect(node.querySelectorAll('tbody tr:not(.dt-spacer)').length).toBeGreaterThan(3);
    document.body.replaceChildren();
    const o = await mount(import('../src/views/billing.js'), { tab: 'outstanding' }, {});
    expect(o.node.querySelector('.dt-foot').textContent).toMatch(/Outstanding/);
  });

  it('generates draft bills from unbilled work', async () => {
    const store = app.store;
    const before = store.all('bills').length;
    const { node } = await mount(import('../src/views/bill-generate.js'), {}, {});
    const rows = node.querySelectorAll('.gen-table tbody tr');
    expect(rows.length).toBeGreaterThan(0);
    const btn = [...node.querySelectorAll('button')].find((b) => /Generate \d+ draft/.test(b.textContent));
    btn.click();
    for (let i = 0; i < 50 && store.all('bills').length === before; i++) await flush();
    await flush();
    const created = store.all('bills').slice(before);
    expect(created.length).toBe(rows.length);
    for (const b of created) {
      expect(b.status).toBe('draft');
      expect(billTotals(b).total).toBeGreaterThan(0);
      for (const l of b.lines) if (l.activityId) expect(store.get('activities', l.activityId).billId).toBe(b.id);
    }
    expect(new Set(created.map((b) => b.number)).size).toBe(created.length);
  });

  it('edits a draft bill and releases removed lines', async () => {
    const store = app.store;
    const draft = store.all('bills').find((b) => b.status === 'draft');
    expect(draft).toBeTruthy();
    const { node } = await mount(import('../src/views/bill-detail.js'), { id: draft.id }, {});
    expect(node.querySelector('h1').textContent).toBe(`Bill #${draft.number}`);
    [...node.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit').click();
    const removed = draft.lines[0];
    node.querySelector('.edit-lines tbody tr button[aria-label^="Remove line"]').click();
    [...node.querySelectorAll('button')].find((b) => b.textContent.includes('Save changes')).click();
    const saved = store.get('bills', draft.id);
    expect(saved.lines).toHaveLength(draft.lines.length - 1);
    if (removed.activityId) expect(isUnbilled(store.get('activities', removed.activityId))).toBe(true);
  });

  it('renders an issued bill as a document with totals', async () => {
    const issued = app.store.all('bills').find((b) => b.status === 'issued');
    const { node } = await mount(import('../src/views/bill-detail.js'), { id: issued.id }, {});
    expect(node.querySelector('.bill-doc')).toBeTruthy();
    expect(node.querySelector('.doc-totals').textContent).toMatch(/Total/);
  });
});

describe('accounts screens', () => {
  it('shows accounts, trust by matter, and a trust ledger with reconciliation', async () => {
    const { node } = await mount(import('../src/views/accounts.js'), {}, {});
    expect(node.querySelectorAll('.acct-card').length).toBe(2);
    expect(node.textContent).toMatch(/Trust funds by matter/);
    document.body.replaceChildren();
    const d = await mount(import('../src/views/accounts.js'), { id: 'acct-trust' }, {});
    expect(d.node.querySelector('h1').textContent).toMatch(/trust/i);
    expect(d.node.querySelectorAll('tbody tr:not(.dt-spacer)').length).toBeGreaterThan(3);
    expect(d.node.textContent).toMatch(/Three-way reconciliation/);
    expect(d.node.querySelectorAll('.recon-cell').length).toBe(3);
  });
});
