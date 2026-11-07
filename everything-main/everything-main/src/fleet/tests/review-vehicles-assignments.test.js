// @vitest-environment jsdom
/** Assignments and the meter readings they record. */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { polyfill, freshStore, settle, fillDialog, saveDialog, clickButton } from './review-vehicles-setup.js';
import { app } from '../src/app.js';
import { openAssignmentDialog } from '../src/views/assignments.js';

beforeAll(polyfill);

let veh;
let a;
let b;
beforeEach(async () => {
  await freshStore();
  veh = app.store.put('vehicles', { name: 'Van 1', archived: false, operatorId: null });
  a = app.store.put('contacts', { firstName: 'Ana', lastName: 'A', roles: ['operator'], archived: false });
  b = app.store.put('contacts', { firstName: 'Ben', lastName: 'B', roles: ['operator'], archived: false });
});

const readings = () => app.store.all('meters').filter((m) => m.vehicleId === veh.id);

async function assign(values, rec = {}) {
  openAssignmentDialog(rec);
  await settle();
  fillDialog(values);
  saveDialog();
  await settle();
  return document.querySelector('dialog[open]');
}

describe('assignment meters', () => {
  it('removes the starting reading when it is cleared from the assignment', async () => {
    await assign({ Vehicle: veh.id, Operator: a.id, 'Start date': '2026-10-01', 'Starting meter': '1200' });
    expect(readings().map((m) => m.value)).toEqual([1200]);
    const rec = app.store.all('assignments')[0];
    await assign({ 'Starting meter': '' }, rec);
    expect(readings()).toEqual([]);
    expect(app.store.get('vehicles', veh.id).meter).toBe(null);
  });

  it('removes the ending reading when the end date is cleared', async () => {
    await assign({ Vehicle: veh.id, Operator: a.id, 'Start date': '2026-10-01', 'End date': '2026-10-05', 'Ending meter': '1500' });
    expect(readings().map((m) => m.value)).toEqual([1500]);
    const rec = app.store.all('assignments')[0];
    await assign({ 'End date': '' }, rec);
    expect(readings()).toEqual([]);
  });

  it('deleting an assignment removes its readings, and Undo brings back both and the operator', async () => {
    await assign({ Vehicle: veh.id, Operator: a.id, 'Start date': '2026-10-01', 'Starting meter': '1200' });
    const rec = app.store.all('assignments')[0];
    expect(app.store.get('vehicles', veh.id).operatorId).toBe(a.id);
    openAssignmentDialog(rec);
    await settle();
    clickButton(document.querySelector('dialog[open]'), 'Delete');
    await settle();
    clickButton([...document.querySelectorAll('dialog[open]')].pop(), 'Delete');
    await settle();
    expect(app.store.all('assignments')).toEqual([]);
    expect(readings()).toEqual([]);
    expect(app.store.get('vehicles', veh.id).operatorId).toBe(null);
    clickButton(document.querySelector('.toast-region'), 'Undo');
    await settle();
    expect(app.store.all('assignments').length).toBe(1);
    expect(readings().map((m) => m.value)).toEqual([1200]);
    expect(app.store.get('vehicles', veh.id).operatorId).toBe(a.id);
    expect(app.store.get('vehicles', veh.id).meter).toBe(1200);
  });
});

describe('assignment dates', () => {
  it('ends the open assignment the day before a newer one starts', async () => {
    await assign({ Vehicle: veh.id, Operator: a.id, 'Start date': '2026-09-01' });
    await assign({ Vehicle: veh.id, Operator: b.id, 'Start date': '2026-10-01' });
    const [first] = app.store.all('assignments').filter((x) => x.contactId === a.id);
    expect(first.end).toBe('2026-09-30');
    expect(app.store.get('vehicles', veh.id).operatorId).toBe(b.id);
  });

  it('refuses an assignment that overlaps another one of the same vehicle', async () => {
    await assign({ Vehicle: veh.id, Operator: a.id, 'Start date': '2026-10-01' });
    // Starting earlier with no end would run alongside Ana's open assignment.
    const dlg = await assign({ Vehicle: veh.id, Operator: b.id, 'Start date': '2026-09-01' });
    expect(dlg).not.toBeNull();
    expect(dlg.textContent).toMatch(/Ana A/);
    expect(app.store.all('assignments').length).toBe(1);
    clickButton(dlg, 'Cancel');
  });

  it('refuses a second assignment starting the same day as an open one', async () => {
    await assign({ Vehicle: veh.id, Operator: a.id, 'Start date': '2026-10-01' });
    const dlg = await assign({ Vehicle: veh.id, Operator: b.id, 'Start date': '2026-10-01' });
    expect(dlg).not.toBeNull();
    expect(app.store.all('assignments').length).toBe(1);
    clickButton(dlg, 'Cancel');
  });

  it('allows an earlier assignment that ends before the next one starts', async () => {
    await assign({ Vehicle: veh.id, Operator: a.id, 'Start date': '2026-10-01' });
    const dlg = await assign({ Vehicle: veh.id, Operator: b.id, 'Start date': '2026-08-01', 'End date': '2026-08-31' });
    expect(dlg).toBeNull();
    expect(app.store.all('assignments').length).toBe(2);
    expect(app.store.get('vehicles', veh.id).operatorId).toBe(a.id);
  });

  it('refuses an end date before the start', async () => {
    const dlg = await assign({ Vehicle: veh.id, Operator: a.id, 'Start date': '2026-10-05', 'End date': '2026-10-01' });
    expect(dlg).not.toBeNull();
    expect(app.store.all('assignments').length).toBe(0);
    clickButton(dlg, 'Cancel');
  });
});

describe('assignment list', () => {
  async function listCells(tab) {
    localStorage.clear();
    const { render } = await import('../src/views/assignments.js');
    const { viewCtx } = await import('./review-vehicles-setup.js');
    const out = render(viewCtx({ query: { tab } }));
    document.querySelector('main').replaceChildren(out.node);
    await settle();
    return [...out.node.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
  }

  it('does not show a negative duration for an upcoming assignment', async () => {
    app.store.put('assignments', { vehicleId: veh.id, contactId: a.id, start: '2026-10-20', end: null });
    app.store.put('assignments', { vehicleId: veh.id, contactId: b.id, start: '2026-11-01', end: '2026-11-10' });
    const rows = await listCells('upcoming');
    const durations = rows.map((r) => r[4]).sort();
    expect(durations).toEqual(['-', '10 days']);
  });

  it('shows the vehicle when editing an assignment of an archived vehicle', async () => {
    app.store.patch('vehicles', veh.id, { archived: true });
    const rec = app.store.put('assignments', { vehicleId: veh.id, contactId: a.id, start: '2026-09-01', end: '2026-09-30' });
    openAssignmentDialog(rec);
    await settle();
    const dlg = document.querySelector('dialog[open]');
    expect(dlg.querySelector('.picker-btn').textContent).toMatch(/Van 1/);
    clickButton(dlg, 'Cancel');
  });

  it('shows the operator when editing an assignment of an archived contact', async () => {
    app.store.patch('contacts', a.id, { archived: true });
    const rec = app.store.put('assignments', { vehicleId: veh.id, contactId: a.id, start: '2026-09-01', end: '2026-09-30' });
    openAssignmentDialog(rec);
    await settle();
    const dlg = document.querySelector('dialog[open]');
    expect(dlg.querySelectorAll('.picker-btn')[1].textContent).toMatch(/Ana A/);
    clickButton(dlg, 'Cancel');
  });

  it('shows the vehicle when editing a reading of an archived vehicle', async () => {
    const { openMeterDialog } = await import('../src/views/meters.js');
    app.store.patch('vehicles', veh.id, { archived: true });
    const m = app.store.put('meters', { vehicleId: veh.id, value: 5, date: '2026-09-01', source: null, note: '', void: false });
    openMeterDialog(m);
    await settle();
    const dlg = document.querySelector('dialog[open]');
    expect(dlg.querySelector('.picker-btn').textContent).toMatch(/Van 1/);
    clickButton(dlg, 'Cancel');
  });
});

describe('meters on future assignments', () => {
  it('refuses a starting or ending meter dated in the future', async () => {
    let dlg = await assign({ Vehicle: veh.id, Operator: a.id, 'Start date': '2026-11-01', 'Starting meter': '5000' });
    expect(dlg).not.toBeNull();
    expect(dlg.textContent).toMatch(/has started/);
    clickButton(dlg, 'Cancel');
    dlg = await assign({ Vehicle: veh.id, Operator: a.id, 'Start date': '2026-10-01', 'End date': '2026-10-20', 'Ending meter': '5000' });
    expect(dlg).not.toBeNull();
    expect(dlg.textContent).toMatch(/has ended/);
    clickButton(dlg, 'Cancel');
    expect(readings()).toEqual([]);
  });
});
