// @vitest-environment jsdom
/** Meter history: sources, units, voiding, and warnings. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { polyfill, freshStore, settle, viewCtx, fillDialog, saveDialog } from './review-vehicles-setup.js';
import { app } from '../src/app.js';
import { recordMeter } from '../src/core/actions.js';

beforeAll(polyfill);

let veh;
beforeEach(async () => {
  await freshStore();
  veh = app.store.put('vehicles', { name: 'Van 1', archived: false, meterUnit: 'mi' });
});

describe('readings recorded by an assignment', () => {
  it('say "Assignment" and link to the vehicle\'s assignments', async () => {
    const { sourceLink } = await import('../src/views/vehicle-detail.js');
    const node = sourceLink({ vehicleId: veh.id, source: { type: 'assignment', id: 'x-start' } });
    expect(node.textContent).toBe('Assignment');
    expect(node.getAttribute('href')).toBe(`#/assignments?tab=all&f_vehicle=${veh.id}`);
  });

  it('can be found with the Source filter on the meter history', async () => {
    recordMeter(app.store, { vehicleId: veh.id, value: 100, date: '2026-10-01', source: { type: 'assignment', id: 'a-start' } });
    const { render } = await import('../src/views/meters.js');
    const out = render(viewCtx({ query: { f_source: 'assignment' } }));
    document.querySelector('main').replaceChildren(out.node);
    await settle();
    expect(out.node.querySelectorAll('tbody tr').length).toBe(1);
    expect(out.node.querySelector('.filter-btn.active').textContent).toMatch(/Source: Assignment/);
  });
});

describe('the meter reading dialog', () => {
  async function pickVehicle(dlg, name) {
    dlg.querySelector('.picker-btn').click();
    await settle();
    [...document.querySelectorAll('.popover [role="option"]')].find((o) => o.textContent.includes(name)).click();
    await settle();
  }

  it("shows the chosen vehicle's meter unit", async () => {
    app.store.put('vehicles', { name: 'Loader', archived: false, meterUnit: 'hr' });
    const { openMeterDialog } = await import('../src/views/meters.js');
    openMeterDialog({});
    await settle();
    const dlg = document.querySelector('dialog[open]');
    await pickVehicle(dlg, 'Loader');
    expect(dlg.querySelector('.affix-end').textContent).toBe('hr');
  });

  it("shows the vehicle's meter unit on assignment meters", async () => {
    app.store.put('vehicles', { name: 'Loader', archived: false, meterUnit: 'hr' });
    const { openAssignmentDialog } = await import('../src/views/assignments.js');
    openAssignmentDialog({});
    await settle();
    const dlg = document.querySelector('dialog[open]');
    await pickVehicle(dlg, 'Loader');
    expect([...dlg.querySelectorAll('.affix-end')].map((n) => n.textContent)).toEqual(['hr', 'hr']);
  });
});

describe('meter reading dates', () => {
  it('refuses a reading dated in the future, as fuel entries do', async () => {
    const { openMeterDialog } = await import('../src/views/meters.js');
    openMeterDialog({ vehicleId: veh.id });
    await settle();
    fillDialog({ Reading: '5000', Date: '2027-10-12' });
    const dlg = saveDialog();
    await settle();
    expect(app.store.all('meters')).toEqual([]);
    expect(dlg.textContent).toMatch(/future/);
  });
});

describe('meter history on phones', () => {
  it('names the source the same way as the table', async () => {
    recordMeter(app.store, { vehicleId: veh.id, value: 100, date: '2026-10-01', source: { type: 'fuel', id: 'f1' } });
    localStorage.clear();
    const { render } = await import('../src/views/meters.js');
    const out = render(viewCtx());
    document.querySelector('main').replaceChildren(out.node);
    await settle();
    expect(out.node.querySelector('.grid-cards').textContent).toMatch(/Fuel entry/);
  });
});
