// @vitest-environment jsdom
/**
 * Behavior of the maintenance screens (work orders, service, parts,
 * purchase orders, reminders, issues), rendered against a memory store.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { app } from '../src/app.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { bucketOf } from '../src/core/schema.js';

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

let store;
beforeEach(async () => {
  app.demo = true;
  app.team = null;
  app.today = () => '2026-10-12';
  app.store = store = createStore({ backend: createMemoryBackend({}, { bucketOf }), flushDelay: 0 });
  await store.init();
  document.body.innerHTML = '';
  location.hash = '';
});

const settle = () => new Promise((r) => setTimeout(r, 5));

// Disposed after each test, as the view host does on leaving a page, so
// a list's redraw timer can't fire once the test environment is gone.
const disposers = [];
afterEach(() => {
  while (disposers.length) disposers.pop()();
});

/** Render a view module the way the view host does, with live regions. */
function render(mod, { path, params = {}, query = {} }) {
  const lives = [];
  const ctx = {
    params,
    query,
    route: { path, params, query },
    live(fn, colls = 'all', tag = 'div') {
      const node = document.createElement(tag);
      const draw = () => {
        const out = fn();
        node.replaceChildren(...(Array.isArray(out) ? out.filter(Boolean) : out ? [out] : []));
      };
      draw();
      node.redraw = draw;
      lives.push(draw);
      return node;
    },
    onDispose: (fn) => disposers.push(fn),
  };
  const out = mod.render(ctx);
  const view = out instanceof Node ? { node: out } : out;
  document.body.append(view.node);
  view.redraw = () => lives.forEach((d) => d());
  return view;
}

const dialogs = () => [...document.querySelectorAll('dialog[open]')];
const topDialog = () => dialogs().at(-1);
const byText = (root, sel, text) => [...root.querySelectorAll(sel)].find((b) => b.textContent.trim() === text);
const button = (root, text) => byText(root, 'button', text);
function fieldInput(root, label) {
  const l = [...root.querySelectorAll('label')].find((x) => x.textContent.replace(/\s*\*$/, '').trim() === label);
  return l?.htmlFor ? root.ownerDocument.getElementById(l.htmlFor) : null;
}
function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('service tasks', () => {
  it('restores an archived task that is not in use instead of deleting it', async () => {
    const { openTaskDialog } = await import('../src/views/service-tasks.js');
    const t = store.put('serviceTasks', { name: 'Wash', archived: true });
    openTaskDialog(t);
    button(topDialog(), 'Restore').click();
    await settle();
    expect(dialogs().filter((d) => /Delete service task/.test(d.textContent))).toHaveLength(0);
    expect(store.get('serviceTasks', t.id)).toMatchObject({ archived: false });
  });
});

describe('service tasks in use', () => {
  it('archives a task used only on a work order or a service program instead of deleting it', async () => {
    const { openTaskDialog } = await import('../src/views/service-tasks.js');
    const a = store.put('serviceTasks', { name: 'Brakes', archived: false });
    const b = store.put('serviceTasks', { name: 'Tires', archived: false });
    store.put('workOrders', { number: 1, status: 'open', lineItems: [{ id: 'l1', taskId: a.id, parts: [] }] });
    store.put('servicePrograms', { name: 'Light duty', schedules: [{ id: 's1', taskId: b.id, interval: { every: 6, unit: 'months' } }], vehicleIds: [] });
    for (const t of [a, b]) {
      openTaskDialog(t);
      button(topDialog(), 'Delete').click();
      await settle();
      expect(dialogs().filter((d) => /Delete service task/.test(d.textContent))).toHaveLength(0);
      expect(store.get('serviceTasks', t.id)).toMatchObject({ archived: true });
    }
  });
});

describe('editing a completed work order', () => {
  async function setup() {
    const { completeWorkOrder } = await import('../src/core/actions.js');
    const v = store.put('vehicles', { name: 'Van 1', meter: 1000, status: 'active' });
    const p = store.put('parts', { number: 'OF-1', description: 'Oil filter', unitCost: 500, locations: [{ location: 'Main shop', qty: 10 }] });
    const wo0 = store.put('workOrders', { number: 7, vehicleId: v.id, status: 'in_progress', repairClass: 'scheduled', issueDate: '2026-10-01', lineItems: [{ id: 'l1', taskId: null, description: 'Oil', parts: [{ id: 'pp1', partId: p.id, name: 'Oil filter', qty: 2, unitCost: 500 }] }], issueIds: [], reminderIds: [] });
    const entry = completeWorkOrder(store, wo0, { date: '2026-10-05', meter: 1100 }, app.settings());
    const mod = await import('../src/views/service-form.js');
    const view = render(mod, { path: `/work-orders/${wo0.id}/edit`, params: { id: wo0.id } });
    return { v, p, wo: store.get('workOrders', wo0.id), entry, view };
  }

  it('clears the completion date when the status is changed back', async () => {
    const { wo, view } = await setup();
    const status = fieldInput(view.node, 'Status');
    status.value = 'open';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    button(view.node, 'Save work order').click();
    await settle();
    expect(store.get('workOrders', wo.id)).toMatchObject({ status: 'open', completedDate: null });
  });

  it('carries line item changes into its service entry and inventory', async () => {
    const { wo, p, entry, view } = await setup();
    expect(store.get('parts', p.id).locations[0].qty).toBe(8);
    type(view.node.querySelector('.li-part input[aria-label^="Quantity"]'), '3');
    button(view.node, 'Save work order').click();
    await settle();
    expect(store.get('serviceEntries', entry.id).lineItems[0].parts[0].qty).toBe(3);
    expect(store.get('parts', p.id).locations[0].qty).toBe(7);
    expect(store.get('workOrders', wo.id)).toMatchObject({ status: 'completed', completedDate: '2026-10-05' });
  });
});

describe('editing an older service entry', () => {
  it('does not tick and complete a reminder the entry was not linked to', async () => {
    const v = store.put('vehicles', { name: 'Van 1', meter: 20000, status: 'active' });
    const t = store.put('serviceTasks', { name: 'Oil change' });
    const e = store.put('serviceEntries', { vehicleId: v.id, date: '2026-03-01', meter: 9000, repairClass: 'scheduled', lineItems: [{ id: 'l1', taskId: t.id, parts: [] }], issueIds: [], reminderIds: [] });
    const r = store.put('reminders', { vehicleId: v.id, taskId: t.id, interval: { every: 6, unit: 'months' }, lastDate: '2026-09-01', lastMeter: 19000, history: [] });
    const mod = await import('../src/views/service-form.js');
    const view = render(mod, { path: `/service/${e.id}/edit`, params: { id: e.id } });
    const box = [...view.node.querySelectorAll('.check-list label')].find((l) => /Oil change/.test(l.textContent)).querySelector('input');
    expect(box.checked).toBe(false);
    button(view.node, 'Save service entry').click();
    await settle();
    expect(store.get('reminders', r.id)).toMatchObject({ lastDate: '2026-09-01', history: [] });
  });
});

describe('links to deleted records', () => {
  const hrefs = (node) => [...node.querySelectorAll('a')].map((a) => a.getAttribute('href'));

  it('does not link a work order to its deleted service entry, or an entry to its deleted work order', async () => {
    const v = store.put('vehicles', { name: 'Van 1' });
    const wo = store.put('workOrders', { number: 3, vehicleId: v.id, status: 'completed', completedDate: '2026-10-01', issueDate: '2026-10-01', serviceEntryId: 'gone-entry', lineItems: [] });
    const e = store.put('serviceEntries', { vehicleId: v.id, date: '2026-10-01', workOrderId: 'gone-wo', lineItems: [] });
    const woView = render(await import('../src/views/work-order-detail.js'), { path: `/work-orders/${wo.id}`, params: { id: wo.id } });
    expect(hrefs(woView.node)).not.toContain('#/service/gone-entry');
    document.body.innerHTML = '';
    const eView = render(await import('../src/views/service-detail.js'), { path: `/service/${e.id}`, params: { id: e.id } });
    expect(hrefs(eView.node)).not.toContain('#/work-orders/gone-wo');
    document.body.innerHTML = '';
    const list = render(await import('../src/views/service.js'), { path: '/service' });
    expect(hrefs(list.node)).not.toContain('#/work-orders/gone-wo');
  });

  it('shows a reminder completion whose service entry was deleted without a broken link', async () => {
    const v = store.put('vehicles', { name: 'Van 1' });
    const r = store.put('reminders', { vehicleId: v.id, taskId: null, interval: { every: 6, unit: 'months' }, lastDate: '2026-09-01', history: [{ date: '2026-03-01', meter: null, entryId: 'gone-entry', onTime: true }, { date: '2026-09-01', meter: null, entryId: null, onTime: true }] });
    const view = render(await import('../src/views/reminder-detail.js'), { path: `/reminders/${r.id}`, params: { id: r.id } });
    expect(hrefs(view.node)).not.toContain('#/service/gone-entry');
    expect(view.node.textContent).toMatch(/Mar 1, 2026/);
  });

  it('does not link an issue to the deleted service entry that resolved it', async () => {
    const v = store.put('vehicles', { name: 'Van 1' });
    const i = store.put('issues', { number: 4, vehicleId: v.id, summary: 'Brake light', status: 'resolved', resolvedAt: '2026-10-01', resolution: { type: 'service', id: 'gone-entry', date: '2026-10-01' }, priority: 'low', reportedDate: '2026-09-30' });
    const view = render(await import('../src/views/issue-detail.js'), { path: `/issues/${i.id}`, params: { id: i.id } });
    expect(hrefs(view.node)).not.toContain('#/service/gone-entry');
    expect(view.node.textContent).toMatch(/Deleted service entry/);
  });
});

describe('issue bulk actions', () => {
  async function selectAll() {
    const v = store.put('vehicles', { name: 'Van 1' });
    const base = { vehicleId: v.id, priority: 'low', reportedDate: '2026-10-01' };
    const open = store.put('issues', { ...base, number: 1, summary: 'Open one', status: 'open' });
    const fixed = store.put('issues', { ...base, number: 2, summary: 'Fixed one', status: 'resolved', resolvedAt: '2026-10-02', resolution: { type: 'service', id: 'e1', date: '2026-10-02' } });
    const closed = store.put('issues', { ...base, number: 3, summary: 'Duplicate', status: 'closed', resolvedAt: '2026-10-03', resolution: { type: 'note', note: 'Duplicate of #1', date: '2026-10-03' } });
    const view = render(await import('../src/views/issues.js'), { path: '/issues', query: { tab: 'all' } });
    const head = view.node.querySelector('input[aria-label="Select all on this page"]');
    head.checked = true;
    head.dispatchEvent(new Event('change'));
    return { view, open, fixed, closed };
  }

  it('resolves only open issues and keeps how the others were resolved or closed', async () => {
    const { view, open, fixed, closed } = await selectAll();
    button(view.node.querySelector('.bulk-bar'), 'Resolve').click();
    await settle();
    expect(store.get('issues', open.id).status).toBe('resolved');
    expect(store.get('issues', fixed.id)).toMatchObject({ status: 'resolved', resolvedAt: '2026-10-02', resolution: { type: 'service', id: 'e1' } });
    expect(store.get('issues', closed.id)).toMatchObject({ status: 'closed', resolution: { note: 'Duplicate of #1' } });
  });

  it('closes only open issues', async () => {
    const { view, open, fixed } = await selectAll();
    button(view.node.querySelector('.bulk-bar'), 'Close').click();
    await settle();
    expect(store.get('issues', open.id).status).toBe('closed');
    expect(store.get('issues', fixed.id)).toMatchObject({ status: 'resolved', resolvedAt: '2026-10-02' });
  });
});

describe('issue form', () => {
  it('removes the meter reading when the meter is cleared', async () => {
    const { recordMeter } = await import('../src/core/actions.js');
    const v = store.put('vehicles', { name: 'Van 1', meter: 900 });
    const i = store.put('issues', { number: 1, vehicleId: v.id, summary: 'Noise', status: 'open', priority: 'low', reportedDate: '2026-10-01', meter: 5000, labels: [] });
    recordMeter(store, { vehicleId: v.id, value: 5000, date: '2026-10-01', source: { type: 'issue', id: i.id } });
    expect(store.get('vehicles', v.id).meter).toBe(5000);
    const view = render(await import('../src/views/issue-form.js'), { path: `/issues/${i.id}/edit`, params: { id: i.id } });
    type(fieldInput(view.node, 'Meter at report'), '');
    button(view.node, 'Save issue').click();
    await settle();
    expect(store.all('meters').filter((m) => m.source?.id === i.id)).toHaveLength(0);
    expect(store.get('vehicles', v.id).meter).not.toBe(5000);
  });
});

describe('new service reminder', () => {
  async function fill(query, vehicleIds, meter = null) {
    const t = store.put('serviceTasks', { name: 'Tire rotation' });
    const view = render(await import('../src/views/reminder-form.js'), { path: '/reminders/new', query });
    if (meter !== null) type(fieldInput(view.node, 'At meter'), meter);
    view.node.querySelector('.multi-picker').value = vehicleIds;
    [...view.node.querySelectorAll('.picker')].find((p) => /Service task/.test(p.button.getAttribute('aria-label'))).value = t.id;
    const byTime = byText(view.node, 'label', 'Repeat on a time interval').querySelector('input');
    byTime.checked = false;
    byTime.dispatchEvent(new Event('change'));
    button(view.node, 'Add reminder').click();
    await settle();
    return store.all('reminders');
  }

  it('counts a meter schedule from the vehicle meter when no meter is entered', async () => {
    const a = store.put('vehicles', { name: 'Truck A', meter: 42000 });
    const [r] = await fill({}, [a.id]);
    expect(r).toMatchObject({ vehicleId: a.id, lastMeter: 42000, startMeter: 42000, meterInterval: 5000 });
  });

  it("counts each added vehicle from its own meter, not the first vehicle's", async () => {
    const a = store.put('vehicles', { name: 'Truck A', meter: 42000 });
    const b = store.put('vehicles', { name: 'Truck B', meter: 1000 });
    const rems = await fill({ vehicle: a.id }, [a.id, b.id]);
    expect(rems.find((r) => r.vehicleId === a.id)).toMatchObject({ lastMeter: 42000, startMeter: 42000 });
    expect(rems.find((r) => r.vehicleId === b.id)).toMatchObject({ lastMeter: 1000, startMeter: 1000 });
  });

  it('uses a meter that was typed in', async () => {
    const a = store.put('vehicles', { name: 'Truck A', meter: 42000 });
    const [r] = await fill({ vehicle: a.id }, [a.id], '40000');
    expect(r).toMatchObject({ lastMeter: 40000, startMeter: 40000 });
  });
});

describe('reminder bulk delete', () => {
  it('can be undone, bringing back the completion history', async () => {
    const v = store.put('vehicles', { name: 'Van 1', meter: 100 });
    const t = store.put('serviceTasks', { name: 'Oil change' });
    const r = store.put('reminders', { vehicleId: v.id, taskId: t.id, interval: { every: 6, unit: 'months' }, lastDate: '2026-09-01', history: [{ date: '2026-09-01', meter: 90, entryId: null, onTime: true }] });
    const view = render(await import('../src/views/reminders.js'), { path: '/reminders' });
    const head = view.node.querySelector('input[aria-label="Select all on this page"]');
    head.checked = true;
    head.dispatchEvent(new Event('change'));
    button(view.node.querySelector('.bulk-bar'), 'Delete').click();
    await settle();
    expect(store.get('reminders', r.id)).toBeNull();
    const undo = button(document.querySelector('.toast-region'), 'Undo');
    expect(undo).toBeTruthy();
    undo.click();
    expect(store.get('reminders', r.id)?.history).toHaveLength(1);
  });
});

describe('line item editor', () => {
  it('keeps a flat labor cost on a line that has hours but no rate', async () => {
    const { lineItemsEditor } = await import('../src/views/line-items.js');
    const ed = lineItemsEditor([{ id: 'l1', taskId: null, description: 'Diagnose', laborHours: 2, laborRate: null, laborCost: 15000, parts: [] }]);
    document.body.append(ed);
    const flat = ed.querySelector('input[aria-label="Labor cost"]');
    expect(flat.value).toBe('150.00');
    type(ed.querySelector('input[aria-label="Labor hours"]'), '3');
    expect(ed.value[0]).toMatchObject({ laborHours: 3, laborCost: 15000 });
  });

  it('lets the name of a part not in inventory be edited after the list redraws', async () => {
    const { lineItemsEditor } = await import('../src/views/line-items.js');
    const ed = lineItemsEditor([{ id: 'l1', taskId: null, description: 'Wipers', parts: [{ id: 'p1', partId: null, name: 'Wiper blade', qty: 2, unitCost: 900 }] }]);
    document.body.append(ed);
    const name = ed.querySelector('.li-part input[aria-label="Part name"]');
    expect(name?.value).toBe('Wiper blade');
    type(name, 'Wiper blades, 22 in');
    expect(ed.value[0].parts[0].name).toBe('Wiper blades, 22 in');
  });

  it('shows labor hours without a rate as hours only on the saved record', async () => {
    const { lineItemsView } = await import('../src/views/service-doc.js');
    const node = lineItemsView({ lineItems: [{ id: 'l1', description: 'Diagnose', laborHours: 2, laborRate: null, laborCost: 15000, parts: [] }] });
    expect(node.textContent).not.toMatch(/at \/hr/);
    expect(node.textContent).toMatch(/2(\.00)? hr/);
  });

  it('does not accept negative or unreadable quantities, hours and costs', async () => {
    const { lineItemsEditor } = await import('../src/views/line-items.js');
    const ed = lineItemsEditor([{ id: 'l1', taskId: null, description: 'Brakes', laborHours: 1, laborRate: 10000, parts: [{ id: 'p1', partId: 'x', name: 'Pads', qty: 1, unitCost: 4000 }] }]);
    document.body.append(ed);
    const qty = ed.querySelector('.li-part input[aria-label^="Quantity"]');
    const hours = ed.querySelector('input[aria-label="Labor hours"]');
    const cost = ed.querySelector('.li-part input[aria-label^="Unit cost"]');
    type(qty, '-2');
    type(hours, 'two');
    type(cost, '-40');
    const [li] = ed.value;
    expect(li.parts[0].qty).toBeNull();
    expect(li.laborHours).toBeNull();
    expect(li.parts[0].unitCost).toBe(0);
    for (const el of [qty, hours, cost]) expect(el.getAttribute('aria-invalid')).toBe('true');
    type(qty, '3');
    expect(qty.getAttribute('aria-invalid')).toBeNull();
    expect(ed.value[0].parts[0].qty).toBe(3);
  });
});

describe('totals editor', () => {
  it('ignores a negative tax rate or discount instead of lowering the total', async () => {
    const { totalsEditor } = await import('../src/views/line-items.js');
    const node = totalsEditor({ lineItems: [{ id: 'l1', laborCost: 10000, parts: [] }] });
    document.body.append(node);
    const tax = node.querySelector('input[aria-label="Tax percent"]');
    type(tax, '-10');
    expect(node.value.taxPercent).toBeNull();
    expect(tax.getAttribute('aria-invalid')).toBe('true');
    type(tax, '8.25%');
    expect(node.value.taxPercent).toBe(8.25);
    expect(tax.getAttribute('aria-invalid')).toBeNull();
    expect(node.textContent).toMatch(/108\.25/);
  });
});

describe('completing a work order', () => {
  it('warns when there is not enough of a part in stock', async () => {
    const { completeDialog } = await import('../src/views/service-form.js');
    const v = store.put('vehicles', { name: 'Van 1', meter: 100, status: 'active' });
    const p = store.put('parts', { number: 'BP-1', description: 'Brake pads', locations: [{ location: 'Main shop', qty: 1 }] });
    const wo = store.put('workOrders', { number: 9, vehicleId: v.id, status: 'in_progress', lineItems: [{ id: 'l1', description: 'Brakes', parts: [{ id: 'x', partId: p.id, name: 'Brake pads', qty: 3, unitCost: 100 }] }] });
    completeDialog(wo);
    expect(topDialog().textContent).toMatch(/Brake pads: 3 needed, 1 in stock/);
  });
});

describe('part stock adjustment', () => {
  async function openAdjust() {
    const p = store.put('parts', { number: 'F1', description: 'Filter', locations: [{ location: 'Main shop', qty: 2 }] });
    const view = render(await import('../src/views/part-detail.js'), { path: `/parts/${p.id}`, params: { id: p.id } });
    button(view.node, 'Adjust stock').click();
    return { p, dlg: topDialog() };
  }

  it('does not remove more than is on hand at the location', async () => {
    const { p, dlg } = await openAdjust();
    type(fieldInput(dlg, 'Change by'), '-5');
    button(dlg, 'Adjust').click();
    await settle();
    expect(store.get('parts', p.id).locations[0].qty).toBe(2);
    expect(dlg.textContent).toMatch(/Only 2 on hand at Main shop/);
  });

  it('asks for a change other than zero', async () => {
    const { dlg } = await openAdjust();
    type(fieldInput(dlg, 'Change by'), '0');
    button(dlg, 'Adjust').click();
    await settle();
    expect(dialogs()).toContain(dlg);
    expect(document.querySelector('.toast-region')?.textContent || '').not.toMatch(/Stock adjusted/);
  });
});

describe('part form', () => {
  it('does not save the same location twice', async () => {
    store.saveSettings({ partLocations: ['Main shop', 'Van'] });
    const view = render(await import('../src/views/part-form.js'), { path: '/parts/new' });
    type(fieldInput(view.node, 'Part number'), 'F-9');
    type(fieldInput(view.node, 'Description'), 'Fuel filter');
    button(view.node, 'Add location').click();
    const second = view.node.querySelector('select[aria-label="Location 2"]');
    second.value = 'Main shop';
    second.dispatchEvent(new Event('change'));
    button(view.node, 'Add part').click();
    await settle();
    expect(store.all('parts')).toHaveLength(0);
  });

  it('does not save a quantity or reorder point it cannot read', async () => {
    const p = store.put('parts', { number: 'F1', description: 'Filter', unit: 'each', locations: [{ location: 'Main shop', qty: 12, aisle: '', reorderPoint: 4 }] });
    const view = render(await import('../src/views/part-form.js'), { path: `/parts/${p.id}/edit`, params: { id: p.id } });
    const qty = view.node.querySelector('input[aria-label="Quantity at location 1"]');
    type(qty, '1o');
    type(view.node.querySelector('input[aria-label="Reorder point at location 1"]'), 'four');
    button(view.node, 'Save part').click();
    await settle();
    expect(store.get('parts', p.id).locations[0]).toMatchObject({ qty: 12, reorderPoint: 4 });
    expect(qty.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('purchase orders', () => {
  function setup(status = 'ordered', received = 0) {
    const vd = store.put('vendors', { name: 'Parts Co' });
    const p = store.put('parts', { number: 'F1', description: 'Filter', locations: [{ location: 'Main shop', qty: 0 }] });
    const po = store.put('purchaseOrders', { number: 5, vendorId: vd.id, status, date: '2026-10-01', location: 'Main shop', items: [{ id: 'i1', partId: p.id, qty: 10, unitCost: 100, received }] });
    return { p, po };
  }

  it('names a partially received order\'s status in the edit form', async () => {
    const { po } = setup('partial', 4);
    const view = render(await import('../src/views/purchase-order-form.js'), { path: `/purchase-orders/${po.id}/edit`, params: { id: po.id } });
    const status = fieldInput(view.node, 'Status');
    expect(status.selectedOptions[0].textContent).toBe('Partially received');
  });

  it('does not save parts with a quantity of zero or less', async () => {
    const { po } = setup('draft');
    const view = render(await import('../src/views/purchase-order-form.js'), { path: `/purchase-orders/${po.id}/edit`, params: { id: po.id } });
    type(view.node.querySelector('.po-items input[aria-label^="Quantity"]'), '-3');
    button(view.node, 'Save purchase order').click();
    await settle();
    expect(store.get('purchaseOrders', po.id).items[0].qty).toBe(10);
  });

  it('adds a receipt to what was received while the dialog was open', async () => {
    const { p, po } = setup('ordered');
    const view = render(await import('../src/views/purchase-order-detail.js'), { path: `/purchase-orders/${po.id}`, params: { id: po.id } });
    button(view.node, 'Receive').click();
    const dlg = topDialog();
    // Another device receives 4 meanwhile.
    const { receivePurchaseOrder } = await import('../src/core/actions.js');
    receivePurchaseOrder(store, store.get('purchaseOrders', po.id), { i1: 4 }, '2026-10-11');
    type(dlg.querySelector('.dialog-body input.num'), '6');
    button(dlg, 'Receive').click();
    await settle();
    expect(store.get('purchaseOrders', po.id)).toMatchObject({ status: 'received', items: [{ received: 10 }] });
    expect(store.get('parts', p.id).locations[0].qty).toBe(10);
  });

  it('offers a decimal keypad for received quantities, as for ordered ones', async () => {
    const { po } = setup('ordered');
    const view = render(await import('../src/views/purchase-order-detail.js'), { path: `/purchase-orders/${po.id}`, params: { id: po.id } });
    button(view.node, 'Receive').click();
    const dlg = topDialog();
    expect(dlg.querySelector('.dialog-body input.num').getAttribute('inputmode')).toBe('decimal');
    button(dlg, 'Cancel').click();
  });

  it('does not order fewer than were already received, and closes an order with nothing left to receive', async () => {
    const { po } = setup('partial', 4);
    store.patch('purchaseOrders', po.id, { items: [...po.items, { id: 'i2', partId: po.items[0].partId, qty: 2, unitCost: 100, received: 0 }] });
    const view = render(await import('../src/views/purchase-order-form.js'), { path: `/purchase-orders/${po.id}/edit`, params: { id: po.id } });
    const [q1, q2] = view.node.querySelectorAll('.po-items input[aria-label^="Quantity"]');
    type(q1, '3');
    button(view.node, 'Save purchase order').click();
    await settle();
    expect(store.get('purchaseOrders', po.id).items[0].qty).toBe(10);
    type(q1, '4');
    view.node.querySelectorAll('.po-items button[aria-label="Remove item"]')[1].click();
    button(view.node, 'Save purchase order').click();
    await settle();
    expect(store.get('purchaseOrders', po.id)).toMatchObject({ status: 'received', receivedDate: '2026-10-12', items: [{ qty: 4, received: 4 }] });
  });
});

describe('service program form', () => {
  it('names an archived vehicle that is in the program', async () => {
    const v = store.put('vehicles', { name: 'Old truck', archived: true });
    const t = store.put('serviceTasks', { name: 'Oil change' });
    const prog = store.put('servicePrograms', { name: 'Light duty', schedules: [{ id: 's1', taskId: t.id, interval: { every: 6, unit: 'months' }, meterInterval: null }], vehicleIds: [v.id] });
    const view = render(await import('../src/views/service-program.js'), { path: `/service-programs/${prog.id}`, params: { id: prog.id } });
    const tags = [...view.node.querySelectorAll('.multi-tags .tag')].map((x) => x.textContent);
    expect(tags).toEqual(['Old truck']);
  });

  it('does not save a negative interval', async () => {
    const t = store.put('serviceTasks', { name: 'Oil change' });
    const prog = store.put('servicePrograms', { name: 'Light duty', schedules: [{ id: 's1', taskId: t.id, interval: { every: 6, unit: 'months' }, meterInterval: 5000 }], vehicleIds: [] });
    const view = render(await import('../src/views/service-program.js'), { path: `/service-programs/${prog.id}`, params: { id: prog.id } });
    const row = view.node.querySelector('.sched-row');
    type(row.querySelector('input[aria-label^="Time interval"]'), '-6');
    type(row.querySelector('input[aria-label^="Meter interval"]'), '-5000');
    button(view.node, 'Save program').click();
    await settle();
    const [s1] = store.get('servicePrograms', prog.id).schedules;
    expect(s1.interval?.every ?? 6).toBeGreaterThan(0);
    expect(s1.meterInterval ?? 5000).toBeGreaterThan(0);
  });
});

describe('work order board', () => {
  async function board() {
    const v = store.put('vehicles', { name: 'Van 1' });
    const done = store.put('workOrders', { number: 1, vehicleId: v.id, status: 'completed', repairClass: 'scheduled', issueDate: '2026-10-01', completedDate: '2026-10-05', lineItems: [] });
    const open = store.put('workOrders', { number: 2, vehicleId: v.id, status: 'open', repairClass: 'scheduled', issueDate: '2026-10-01', lineItems: [] });
    const view = render(await import('../src/views/work-orders.js'), { path: '/work-orders', query: { view: 'board' } });
    return { view, done, open };
  }

  it('shows when a completed work order was completed, with or without an expected date', async () => {
    const { view, done } = await board();
    const card = view.node.querySelector(`.board-card[data-id="${done.id}"]`);
    expect(card.textContent).toMatch(/Oct 5, 2026/);
  });
});

describe('snoozing a reminder', () => {
  it('needs a date after today', async () => {
    const v = store.put('vehicles', { name: 'Van 1', meter: 100 });
    const r = store.put('reminders', { vehicleId: v.id, taskId: null, interval: { every: 1, unit: 'months' }, lastDate: '2026-08-01', history: [] });
    const view = render(await import('../src/views/reminder-detail.js'), { path: `/reminders/${r.id}`, params: { id: r.id } });
    view.node.querySelector('button[aria-label="More actions"]').click();
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => /Snooze/.test(b.textContent)).click();
    const dlg = topDialog();
    const until = fieldInput(dlg, 'Snooze until');
    until.value = '2026-10-01';
    button(dlg, 'Snooze').click();
    await settle();
    expect(store.get('reminders', r.id).snoozedUntil).toBeFalsy();
    expect(dlg.textContent).toMatch(/after today/);
  });
});

describe('completion date', () => {
  it('cannot be in the future', async () => {
    const { completeDialog } = await import('../src/views/service-form.js');
    const v = store.put('vehicles', { name: 'Van 1', meter: 100, status: 'active' });
    const wo = store.put('workOrders', { number: 9, vehicleId: v.id, status: 'in_progress', lineItems: [] });
    completeDialog(wo);
    const dlg = topDialog();
    fieldInput(dlg, 'Completed on').value = '2026-11-20';
    button(dlg, 'Complete').click();
    await settle();
    expect(store.get('workOrders', wo.id).status).toBe('in_progress');
    expect(store.all('serviceEntries')).toHaveLength(0);
  });
});

describe('editing a reminder', () => {
  it('keeps a one-time next due override when the schedule is not changed', async () => {
    const v = store.put('vehicles', { name: 'Van 1', meter: 100 });
    const t = store.put('serviceTasks', { name: 'Oil change' });
    const r = store.put('reminders', { vehicleId: v.id, taskId: t.id, interval: { every: 6, unit: 'months' }, meterInterval: null, lastDate: '2026-08-01', lastMeter: 90, nextDate: '2026-12-24', nextMeter: null, history: [] });
    const view = render(await import('../src/views/reminder-form.js'), { path: `/reminders/${r.id}/edit`, params: { id: r.id } });
    type(fieldInput(view.node, 'Days before'), '30');
    button(view.node, 'Save reminder').click();
    await settle();
    expect(store.get('reminders', r.id)).toMatchObject({ dueSoonDays: 30, nextDate: '2026-12-24' });
  });

  it('drops the override when the schedule changes', async () => {
    const v = store.put('vehicles', { name: 'Van 1', meter: 100 });
    const t = store.put('serviceTasks', { name: 'Oil change' });
    const r = store.put('reminders', { vehicleId: v.id, taskId: t.id, interval: { every: 6, unit: 'months' }, meterInterval: null, lastDate: '2026-08-01', lastMeter: 90, nextDate: '2026-12-24', nextMeter: null, history: [] });
    const view = render(await import('../src/views/reminder-form.js'), { path: `/reminders/${r.id}/edit`, params: { id: r.id } });
    type(fieldInput(view.node, 'Every'), '3');
    button(view.node, 'Save reminder').click();
    await settle();
    expect(store.get('reminders', r.id)).toMatchObject({ interval: { every: 3 }, nextDate: null });
  });
});

describe('work order view switch', () => {
  it('is one tab stop that arrow keys move through, like other radio groups', async () => {
    const view = render(await import('../src/views/work-orders.js'), { path: '/work-orders', query: {} });
    const group = view.node.querySelector('[role="radiogroup"][aria-label="View"]');
    const [list, board] = group.querySelectorAll('[role="radio"]');
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(board.getAttribute('tabindex')).toBe('-1');
    list.focus();
    group.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(location.hash).toBe('#/work-orders?view=board');
  });
});

describe('changing when a reminder is next due', () => {
  it('does not pin the regular schedule as an override when nothing is changed', async () => {
    const v = store.put('vehicles', { name: 'Van 1', meter: 100 });
    const r = store.put('reminders', { vehicleId: v.id, taskId: null, interval: { every: 6, unit: 'months' }, meterInterval: 5000, lastDate: '2026-08-01', lastMeter: 90, history: [] });
    const view = render(await import('../src/views/reminder-detail.js'), { path: `/reminders/${r.id}`, params: { id: r.id } });
    view.node.querySelector('button[aria-label="More actions"]').click();
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => /Change next due/.test(b.textContent)).click();
    const dlg = topDialog();
    fieldInput(dlg, 'Next due meter').value = '4000';
    button(dlg, 'Save').click();
    await settle();
    expect(store.get('reminders', r.id)).toMatchObject({ nextDate: null, nextMeter: 4000 });
  });
});

describe('completing a work order deleted meanwhile', () => {
  it('does not create an empty work order and service entry', async () => {
    const { completeDialog } = await import('../src/views/service-form.js');
    const v = store.put('vehicles', { name: 'Van 1', meter: 100, status: 'active' });
    const wo = store.put('workOrders', { number: 9, vehicleId: v.id, status: 'in_progress', lineItems: [] });
    completeDialog(wo);
    store.remove('workOrders', wo.id);
    button(topDialog(), 'Complete').click();
    await settle();
    expect(store.all('workOrders')).toHaveLength(0);
    expect(store.all('serviceEntries')).toHaveLength(0);
  });
});

describe('dialogs on a record deleted meanwhile', () => {
  it('do not bring back a nameless issue', async () => {
    const v = store.put('vehicles', { name: 'Van 1' });
    const i = store.put('issues', { number: 4, vehicleId: v.id, summary: 'Brake light', status: 'open', priority: 'low', reportedDate: '2026-10-01' });
    const view = render(await import('../src/views/issue-detail.js'), { path: `/issues/${i.id}`, params: { id: i.id } });
    view.node.querySelector('button[aria-label="More actions"]').click();
    [...document.querySelectorAll('[role="menuitem"]')].find((b) => /Close without fixing/.test(b.textContent)).click();
    store.remove('issues', i.id);
    button(topDialog(), 'Close issue').click();
    await settle();
    expect(store.all('issues')).toHaveLength(0);
  });

  it('do not crash or bring back a reminder', async () => {
    const { resolveReminder } = await import('../src/views/reminders.js');
    const v = store.put('vehicles', { name: 'Van 1', meter: 100 });
    const r = store.put('reminders', { vehicleId: v.id, taskId: null, interval: { every: 6, unit: 'months' }, lastDate: '2026-01-01', history: [] });
    resolveReminder(r);
    const dlg = topDialog();
    const how = fieldInput(dlg, 'How');
    how.value = 'done';
    how.dispatchEvent(new Event('change'));
    store.remove('reminders', r.id);
    button(dlg, 'Continue').click();
    await settle();
    expect(store.all('reminders')).toHaveLength(0);
    expect(dialogs()).not.toContain(dlg);
  });

  it('do not bring back a resolved renewal', async () => {
    const { resolveRenewal } = await import('../src/views/renewals.js');
    const v = store.put('vehicles', { name: 'Van 1' });
    const r = store.put('renewals', { kind: 'vehicle', vehicleId: v.id, type: 'Registration', dueDate: '2026-10-20', repeat: { every: 1, unit: 'years' }, history: [] });
    resolveRenewal(r);
    store.remove('renewals', r.id);
    button(topDialog(), 'Resolve').click();
    await settle();
    expect(store.all('renewals')).toHaveLength(0);
  });
});
