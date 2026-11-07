// @vitest-environment jsdom
/** Wave 2 review: renewals, dashboard and report details. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { polyfill, freshStore, settle, clickButton, viewCtx } from './review-vehicles-setup.js';
import { app } from '../src/app.js';

beforeAll(polyfill);

let veh;
beforeEach(async () => {
  await freshStore();
  veh = app.store.put('vehicles', { name: 'Van 1', status: 'active', meterUnit: 'mi' });
});

describe('renewal dialog', () => {
  it('shows the vehicle when editing a renewal of an archived vehicle', async () => {
    const { openRenewalDialog } = await import('../src/views/renewals.js');
    app.store.patch('vehicles', veh.id, { archived: true });
    const r = app.store.put('renewals', { kind: 'vehicle', vehicleId: veh.id, type: 'Registration', dueDate: '2026-11-01', history: [] });
    openRenewalDialog(r);
    await settle();
    const dlg = document.querySelector('dialog[open]');
    expect(dlg.querySelector('.picker-btn').textContent).toMatch(/Van 1/);
    clickButton(dlg, 'Cancel');
  });

  it('shows the contact when editing a renewal of an archived contact', async () => {
    const { openRenewalDialog } = await import('../src/views/renewals.js');
    const c = app.store.put('contacts', { firstName: 'Ana', lastName: 'A', roles: ['operator'], archived: true });
    const r = app.store.put('renewals', { kind: 'contact', contactId: c.id, type: "Driver's license", dueDate: '2026-11-01', history: [] });
    openRenewalDialog(r);
    await settle();
    const dlg = document.querySelector('dialog[open]');
    expect(dlg.querySelector('.picker-btn').textContent).toMatch(/Ana A/);
    clickButton(dlg, 'Cancel');
  });
});

async function dashboard() {
  const mod = await import('../src/views/dashboard.js');
  const ctx = viewCtx();
  const out = mod.render(ctx);
  document.querySelector('main').append(out.node);
  return ctx;
}
const tile = (title) => [...document.querySelectorAll('.tile')].find((t) => t.querySelector('.tile-title')?.textContent === title);
const num = (t, label) => [...t.querySelectorAll('.tile-num')].find((n) => n.querySelector('.tile-label').textContent === label).querySelector('.tile-value').textContent;

describe('dashboard work orders', () => {
  it('leaves out work orders of archived vehicles', async () => {
    const sold = app.store.put('vehicles', { name: 'Sold truck', status: 'sold', archived: true });
    app.store.put('workOrders', { number: 1, vehicleId: veh.id, status: 'open', lineItems: [] });
    app.store.put('workOrders', { number: 2, vehicleId: sold.id, status: 'open', lineItems: [] });
    app.store.put('workOrders', { number: 3, vehicleId: sold.id, status: 'on_hold', lineItems: [] });
    const ctx = await dashboard();
    expect(num(tile('Work orders'), 'Open')).toBe('1');
    expect(num(tile('Work orders'), 'On hold')).toBe('0');
    ctx.dispose();
  });
});

describe('dashboard renewals due', () => {
  it('lists the most overdue first', async () => {
    for (const [type, dueDate] of [['Permit', '2026-10-10'], ['Registration', '2026-08-01'], ['Emissions', '2026-09-15'], ['Insurance', '2026-10-14']]) {
      app.store.put('renewals', { kind: 'vehicle', vehicleId: veh.id, type, dueDate, history: [] });
    }
    const ctx = await dashboard();
    const panel = [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === 'Renewals due');
    expect([...panel.querySelectorAll('.row-title')].map((t) => t.textContent)).toEqual(['Registration', 'Emissions', 'Permit', 'Insurance']);
    ctx.dispose();
  });
});

describe('compact tables', () => {
  async function table(n) {
    const { simpleTable } = await import('../src/views/common.js');
    const rows = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Row ${String(i).padStart(2, '0')}` }));
    const node = simpleTable({ rows, columns: [{ id: 'name', label: 'Name', render: (r) => r.name, sort: (r) => r.name }], rowHref: (r) => `#/things/${r.id}`, pageSize: 25 });
    document.querySelector('main').append(node);
    return node;
  }

  it('keeps keyboard focus on a sort button after sorting', async () => {
    const node = await table(3);
    const btn = node.querySelector('th button.sort');
    btn.focus();
    btn.click();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement.matches('th button.sort')).toBe(true);
    expect(node.querySelector('th').getAttribute('aria-sort')).toBe('ascending');
  });

  it('moves focus to the first newly shown row after Show more', async () => {
    const node = await table(30);
    const more = node.querySelector('.show-more button');
    expect(more.textContent).toBe('Show 5 more');
    more.focus();
    more.click();
    expect(node.querySelectorAll('tbody tr')).toHaveLength(30);
    expect(document.activeElement.textContent).toBe('Row 25');
  });

  it('keeps focus on Show more while there are more rows', async () => {
    const node = await table(60);
    const more = [...node.querySelectorAll('.show-more button')][0];
    more.focus();
    more.click();
    expect(document.activeElement.closest('.show-more')).toBeTruthy();
  });
});

describe('delete with undo', () => {
  it('copes with the record being deleted elsewhere while the dialog was open', async () => {
    const { deleteWithUndo } = await import('../src/views/common.js');
    const r = app.store.put('renewals', { kind: 'vehicle', vehicleId: veh.id, type: 'Registration', dueDate: '2026-11-01', history: [] });
    let extraCalls = 0;
    const done = deleteWithUndo('renewals', r, { label: 'renewal reminder', extra: () => extraCalls++ });
    await settle();
    // A teammate deletes it meanwhile.
    app.store.remove('renewals', r.id);
    clickButton([...document.querySelectorAll('dialog[open]')].pop(), 'Delete');
    expect(await done).toBe(true);
    expect(extraCalls).toBe(0);
    const region = document.querySelector('.toast-region');
    expect([...region.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Undo')).toBe(false);
  });
});
