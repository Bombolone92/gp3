// @vitest-environment jsdom
/**
 * Second review of the first wave: new checks on forms must still let
 * records saved before them be edited.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { polyfill, freshStore, viewCtx, settle, saveDialog } from './review-vehicles-setup.js';
import { app } from '../src/app.js';
import { lineItemsEditor } from '../src/views/line-items.js';
import { docTotals } from '../src/core/totals.js';

beforeAll(polyfill);

describe('records saved before wave 1 can still be edited', () => {
  it('a vehicle that shares its VIN with an older (archived) record saves when the VIN is untouched', async () => {
    await freshStore({ sample: true });
    const vin = '1FTBR1C82MKA00001';
    app.store.put('vehicles', { id: 'old', name: 'Old van record', vin, archived: true, status: 'active', type: 'Van' });
    app.store.patch('vehicles', 'v101', { vin });
    const { render } = await import('../src/views/vehicle-form.js');
    const ctx = viewCtx({ params: { id: 'v101' }, query: {} });
    const node = render({ ...ctx, route: { path: '/vehicles/:id/edit' } }).node;
    document.querySelector('main').replaceChildren(node);
    const name = node.querySelector('#f-name') || [...node.querySelectorAll('input')].find((i) => i.value === app.store.get('vehicles', 'v101').name);
    name.value = 'Renamed van';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    node.querySelector('.form-foot .btn.primary').click();
    await settle(20);
    expect([...node.querySelectorAll('[aria-invalid="true"]')].map((e) => e.closest('.field')?.textContent)).toEqual([]);
    expect(app.store.get('vehicles', 'v101').name).toBe('Renamed van');
    ctx.dispose();
  });

  it('an assignment overlapping another closed one saves a note edit', async () => {
    await freshStore({ sample: true });
    app.store.put('assignments', { id: 'a1', vehicleId: 'v101', contactId: 'c1', start: '2026-01-01', end: '2026-01-31' });
    app.store.put('assignments', { id: 'a2', vehicleId: 'v101', contactId: 'c2', start: '2026-01-15', end: '2026-02-15' });
    const { openAssignmentDialog } = await import('../src/views/assignments.js');
    openAssignmentDialog(app.store.get('assignments', 'a2'));
    await settle();
    const dlg = document.querySelector('dialog[open]');
    const notes = dlg.querySelector('textarea');
    notes.value = 'Fixed note';
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    saveDialog();
    await settle(20);
    expect([...dlg.querySelectorAll('[aria-invalid="true"]')].map((e) => e.closest('.field')?.textContent)).toEqual([]);
    expect(app.store.get('assignments', 'a2').notes).toBe('Fixed note');
  });
});

describe('a warranty credit line (a negative flat labor cost)', () => {
  const type = (el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input'));
  };

  it('keeps the credit when the hours on its line are edited', async () => {
    await freshStore({ sample: true });
    const ed = lineItemsEditor([{ id: 'l1', taskId: null, description: 'Warranty credit', laborHours: null, laborRate: null, laborCost: -15000, parts: [] }]);
    document.querySelector('main').replaceChildren(ed);
    expect(docTotals({ lineItems: ed.value }).subtotal).toBe(-15000);
    type(ed.querySelector('input[aria-label="Labor hours"]'), '1');
    expect(ed.value[0].laborCost).toBe(-15000);
    expect(ed.querySelector('input[aria-label="Labor cost"]').getAttribute('aria-invalid')).toBe(null);
  });

  it('can be typed in, while quantities and rates stay zero or more', async () => {
    await freshStore({ sample: true });
    const ed = lineItemsEditor([{ id: 'l1', taskId: null, description: 'Warranty credit', laborHours: null, laborRate: null, laborCost: null, parts: [] }]);
    document.querySelector('main').replaceChildren(ed);
    type(ed.querySelector('input[aria-label="Labor cost"]'), '-150');
    expect(ed.value[0].laborCost).toBe(-15000);
    type(ed.querySelector('input[aria-label="Labor rate per hour"]'), '-80');
    expect(ed.value[0].laborRate).toBe(null);
    expect(ed.querySelector('input[aria-label="Labor rate per hour"]').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('a completed work order whose service entry was deleted', () => {
  it('does not bring the service entry back when the work order is edited', async () => {
    await freshStore();
    const { completeWorkOrder, deleteServiceEntry } = await import('../src/core/actions.js');
    const v = app.store.put('vehicles', { name: 'Van 1', meter: 1000, status: 'active' });
    const t = app.store.put('serviceTasks', { name: 'Oil change' });
    const r = app.store.put('reminders', { vehicleId: v.id, taskId: t.id, interval: { every: 6, unit: 'months' }, lastDate: '2026-04-01', history: [] });
    const wo0 = app.store.put('workOrders', { number: 7, vehicleId: v.id, status: 'in_progress', repairClass: 'scheduled', issueDate: '2026-10-01', lineItems: [{ id: 'l1', taskId: t.id, parts: [] }], issueIds: [], reminderIds: [r.id] });
    const entry = completeWorkOrder(app.store, wo0, { date: '2026-10-05', meter: 1100 }, app.settings());
    // Entered twice by mistake: the entry is deleted from service history.
    deleteServiceEntry(app.store, entry.id);
    expect(app.store.get('reminders', r.id).history).toHaveLength(0);

    const { render } = await import('../src/views/service-form.js');
    const ctx = viewCtx({ params: { id: wo0.id } });
    const node = render({ ...ctx, route: { path: '/work-orders/:id/edit' } }).node;
    document.querySelector('main').replaceChildren(node);
    const notes = [...node.querySelectorAll('textarea')][0];
    notes.value = 'Checked the drain plug';
    notes.dispatchEvent(new Event('input', { bubbles: true }));
    [...node.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save work order').click();
    await settle(20);
    expect(app.store.get('workOrders', wo0.id).notes).toBe('Checked the drain plug');
    expect(app.store.all('serviceEntries')).toHaveLength(0);
    expect(app.store.get('reminders', r.id).history).toHaveLength(0);
    ctx.dispose();
  });
});
