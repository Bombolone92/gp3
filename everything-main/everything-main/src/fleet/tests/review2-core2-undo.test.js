// @vitest-environment jsdom
/** Wave 2 review: deleting a record that recorded a meter reading, and Undo. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { polyfill, freshStore, settle, clickButton, viewCtx } from './review-vehicles-setup.js';
import { app } from '../src/app.js';
import { recordMeter } from '../src/core/actions.js';

beforeAll(polyfill);

let veh;
beforeEach(async () => {
  await freshStore();
  veh = app.store.put('vehicles', { name: 'Van 1', meterUnit: 'mi' });
  app.store.put('meters', { vehicleId: veh.id, date: '2026-10-01', value: 1000, source: null });
});

const readings = () => app.store.all('meters').filter((m) => m.vehicleId === veh.id).map((m) => m.value).sort((a, b) => a - b);

async function deleteFrom(viewName, id, menuLabel) {
  const mod = await import(`../src/views/${viewName}.js`);
  const ctx = viewCtx({ params: { id } });
  const out = mod.render(ctx);
  document.querySelector('main').append(out.node || out);
  document.querySelector('[aria-label="More actions"]').click();
  await settle();
  clickButton(document, menuLabel);
  await settle();
  clickButton([...document.querySelectorAll('dialog[open]')].pop(), 'Delete');
  await settle();
  ctx.dispose();
}

describe('deleting and undoing', () => {
  it('Undo brings back the meter reading of a deleted inspection', async () => {
    const insp = app.store.put('inspections', { formId: 'f', formName: 'Daily', vehicleId: veh.id, date: '2026-10-10', meter: 1500, results: [], failed: 0 });
    recordMeter(app.store, { vehicleId: veh.id, value: 1500, date: '2026-10-10', source: { type: 'inspection', id: insp.id } });
    await deleteFrom('inspection-detail', insp.id, 'Delete inspection');
    expect(readings()).toEqual([1000]);
    expect(app.store.get('vehicles', veh.id).meter).toBe(1000);
    clickButton(document.querySelector('.toast-region'), 'Undo');
    await settle();
    expect(app.store.get('inspections', insp.id)).toBeTruthy();
    expect(readings()).toEqual([1000, 1500]);
    expect(app.store.get('vehicles', veh.id).meter).toBe(1500);
  });

  it("deleting an issue removes the meter reading it recorded, and Undo brings it back", async () => {
    const issue = app.store.put('issues', { number: 1, vehicleId: veh.id, summary: 'Brakes squeal', status: 'open', priority: 'none', reportedDate: '2026-10-11', meter: 1600 });
    recordMeter(app.store, { vehicleId: veh.id, value: 1600, date: '2026-10-11', source: { type: 'issue', id: issue.id } });
    expect(app.store.get('vehicles', veh.id).meter).toBe(1600);
    await deleteFrom('issue-detail', issue.id, 'Delete issue');
    expect(app.store.get('issues', issue.id)).toBeNull();
    expect(readings()).toEqual([1000]);
    expect(app.store.get('vehicles', veh.id).meter).toBe(1000);
    clickButton(document.querySelector('.toast-region'), 'Undo');
    await settle();
    expect(readings()).toEqual([1000, 1600]);
    expect(app.store.get('vehicles', veh.id).meter).toBe(1600);
  });
});

describe('completing a work order', () => {
  it("starts from the vehicle's current meter when it moved on since the work order was opened", async () => {
    const { completeDialog } = await import('../src/views/service-form.js');
    const { saveFuel } = await import('../src/core/actions.js');
    const wo = app.store.put('workOrders', { number: 7, vehicleId: veh.id, status: 'in_progress', issueDate: '2026-10-02', meter: 1000, lineItems: [] });
    saveFuel(app.store, { vehicleId: veh.id, date: '2026-10-08', meter: 1800, volume: 10, total: 3000, kind: 'fuel' });
    completeDialog(app.store.get('workOrders', wo.id));
    await settle();
    const dlg = document.querySelector('dialog[open]');
    const meter = [...dlg.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Meter');
    expect(dlg.querySelector(`[id="${meter.getAttribute('for')}"]`).value).toBe('1800');
    [...dlg.querySelectorAll('.dialog-foot .btn.primary')].pop().click();
    await settle();
    // Not rolled back to the reading from when the work order was opened.
    expect(app.store.get('vehicles', veh.id).meter).toBe(1800);
    expect(app.store.get('workOrders', wo.id).status).toBe('completed');
  });

  it("keeps the work order's meter when it is the newer one", async () => {
    const { completeDialog } = await import('../src/views/service-form.js');
    const wo = app.store.put('workOrders', { number: 8, vehicleId: veh.id, status: 'in_progress', issueDate: '2026-10-02', meter: 1200, lineItems: [] });
    completeDialog(app.store.get('workOrders', wo.id));
    await settle();
    const dlg = document.querySelector('dialog[open]');
    const meter = [...dlg.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Meter');
    expect(dlg.querySelector(`[id="${meter.getAttribute('for')}"]`).value).toBe('1200');
  });
});

describe('the Complete work order dialog', () => {
  it('warns about a meter lower than an earlier reading', async () => {
    const { completeDialog } = await import('../src/views/service-form.js');
    const wo = app.store.put('workOrders', { number: 9, vehicleId: veh.id, status: 'in_progress', issueDate: '2026-10-02', meter: null, lineItems: [] });
    completeDialog(wo);
    await settle();
    const dlg = document.querySelector('dialog[open]');
    const label = [...dlg.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Meter');
    const input = dlg.querySelector(`[id="${label.getAttribute('for')}"]`);
    input.value = '900';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(dlg.textContent).toContain('This is lower than the reading of 1,000 mi on Oct 1, 2026.');
    input.value = '1100';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(dlg.textContent).not.toContain('This is lower');
    clickButton(dlg, 'Cancel');
  });
});
