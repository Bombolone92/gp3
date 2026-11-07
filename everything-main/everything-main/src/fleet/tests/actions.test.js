import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { bucketOf } from '../src/core/schema.js';
import { defaultSettings } from '../src/core/settings.js';
import * as act from '../src/core/actions.js';
import { buildSampleData } from '../src/core/sample.js';
import { reminderState } from '../src/core/reminders.js';
import { COLLECTIONS } from '../src/core/schema.js';

async function open(seed) {
  const store = createStore({ backend: createMemoryBackend(seed, { bucketOf }), flushDelay: 0 });
  await store.init();
  return store;
}

const settings = defaultSettings();

describe('meters', () => {
  it('keeps the vehicle meter at its newest reading', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van' });
    act.recordMeter(s, { vehicleId: v.id, value: 1000, date: '2026-10-01' });
    act.recordMeter(s, { vehicleId: v.id, value: 900, date: '2026-09-01' });
    expect(s.get('vehicles', v.id).meter).toBe(1000);
    act.recordMeter(s, { vehicleId: v.id, value: 1200, date: '2026-10-05' });
    expect(s.get('vehicles', v.id)).toMatchObject({ meter: 1200, meterDate: '2026-10-05' });
  });

  it('updates the reading that belongs to a fuel entry instead of adding one', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van' });
    const f = act.saveFuel(s, { vehicleId: v.id, date: '2026-10-01', meter: 500, volume: 10, total: 3000 });
    act.saveFuel(s, { ...s.get('fuel', f.id), meter: 550 });
    expect(s.all('meters')).toHaveLength(1);
    expect(s.get('vehicles', v.id).meter).toBe(550);
    act.deleteFuel(s, f.id);
    expect(s.all('meters')).toHaveLength(0);
    expect(s.get('vehicles', v.id).meter).toBe(null);
  });

  it('warns about readings lower than earlier ones', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van' });
    act.recordMeter(s, { vehicleId: v.id, value: 1000, date: '2026-10-01' });
    expect(act.meterWarnings(s, { vehicleId: v.id, value: 900, date: '2026-10-02' })).toHaveLength(1);
    expect(act.meterWarnings(s, { vehicleId: v.id, value: 1100, date: '2026-10-02' })).toHaveLength(0);
  });
});

describe('service and work orders', () => {
  it('a service entry resolves issues and restarts reminders once', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van', meter: 9000 });
    const issue = await act.createIssue(s, { vehicleId: v.id, summary: 'Brakes squeal' });
    expect(issue.number).toBe(1);
    const rem = s.put('reminders', { vehicleId: v.id, taskId: 't1', interval: { every: 6, unit: 'months' }, meterInterval: 5000, lastDate: '2026-01-01', lastMeter: 4000, history: [] });
    expect(reminderState(rem, s.get('vehicles', v.id), '2026-10-12', settings).status).toBe('overdue');
    const matching = act.matchingReminders(s, v.id, [{ taskId: 't1' }]);
    expect(matching.map((r) => r.id)).toEqual([rem.id]);
    const entry = act.saveServiceEntry(s, { vehicleId: v.id, date: '2026-10-12', meter: 9100, lineItems: [{ taskId: 't1' }], issueIds: [issue.id], reminderIds: [rem.id] }, settings);
    act.saveServiceEntry(s, s.get('serviceEntries', entry.id), settings);
    const r = s.get('reminders', rem.id);
    expect(r.history).toHaveLength(1);
    expect(r.lastMeter).toBe(9100);
    expect(reminderState(r, s.get('vehicles', v.id), '2026-10-12', settings).status).toBe('upcoming');
    expect(s.get('issues', issue.id).status).toBe('resolved');
    act.deleteServiceEntry(s, entry.id);
    expect(s.get('reminders', rem.id).history).toHaveLength(0);
  });

  it('completing a work order creates history and uses parts from stock', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Truck' });
    const part = s.put('parts', { number: 'OF-1', locations: [{ location: 'Main shop', qty: 5, reorderPoint: 2 }] });
    const wo = s.put('workOrders', { number: 1, vehicleId: v.id, status: 'in_progress', lineItems: [{ taskId: 't1', laborHours: 1, laborRate: 9000, parts: [{ partId: part.id, qty: 2, unitCost: 900 }] }] });
    const entry = act.completeWorkOrder(s, wo, { date: '2026-10-12', meter: 1234 }, settings);
    expect(s.get('workOrders', wo.id)).toMatchObject({ status: 'completed', serviceEntryId: entry.id, stockDeducted: true });
    expect(entry.workOrderId).toBe(wo.id);
    expect(act.stockOnHand(s.get('parts', part.id))).toBe(3);
    // Completing again (after a re-open) neither duplicates history nor stock.
    act.completeWorkOrder(s, act.reopenWorkOrder(s, s.get('workOrders', wo.id)), { date: '2026-10-13', meter: 1240 }, settings);
    expect(s.all('serviceEntries')).toHaveLength(1);
    expect(act.stockOnHand(s.get('parts', part.id))).toBe(3);
    expect(s.get('vehicles', v.id).meter).toBe(1240);
  });

  it('receives purchase orders into stock, partially then fully', async () => {
    const s = await open();
    const part = s.put('parts', { number: 'X', locations: [{ location: 'Main shop', qty: 0 }] });
    const po = s.put('purchaseOrders', { number: 1, status: 'ordered', location: 'Main shop', items: [{ id: 'i1', partId: part.id, qty: 10, unitCost: 500, received: 0 }] });
    const p1 = act.receivePurchaseOrder(s, po, { i1: 4 }, '2026-10-12');
    expect(p1.status).toBe('partial');
    const p2 = act.receivePurchaseOrder(s, p1, { i1: 6 }, '2026-10-13');
    expect(p2.status).toBe('received');
    expect(act.stockOnHand(s.get('parts', part.id))).toBe(10);
  });
});

describe('inspections, assignments, programs', () => {
  it('submitting an inspection records the meter and opens issues for failures', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van' });
    const form = { id: 'f', name: 'Pre-trip', items: [{ id: 'm', type: 'meter', label: 'Odometer' }, { id: 'l', type: 'passfail', label: 'Lights' }, { id: 'h', type: 'passfail', label: 'Horn' }] };
    const sub = await act.submitInspection(s, { form, vehicleId: v.id, answers: { m: { value: '4200' }, l: { value: 'fail', note: 'Left out' }, h: { value: 'pass' } }, date: '2026-10-12', by: 'Dan' }, settings);
    expect(sub.failed).toBe(1);
    expect(sub.issueIds).toHaveLength(1);
    const issue = s.get('issues', sub.issueIds[0]);
    expect(issue).toMatchObject({ vehicleId: v.id, status: 'open', description: 'Left out' });
    expect(issue.source).toMatchObject({ type: 'inspection', id: sub.id });
    expect(s.get('vehicles', v.id).meter).toBe(4200);
  });

  it('a new assignment ends the open one and sets the operator', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van' });
    act.assignVehicle(s, { vehicleId: v.id, contactId: 'c1', start: '2026-01-01', end: null }, '2026-10-12');
    expect(s.get('vehicles', v.id).operatorId).toBe('c1');
    act.assignVehicle(s, { vehicleId: v.id, contactId: 'c2', start: '2026-10-01', end: null }, '2026-10-12');
    expect(s.get('vehicles', v.id).operatorId).toBe('c2');
    expect(s.all('assignments').find((a) => a.contactId === 'c1').end).toBe('2026-09-30');
  });

  it('keeps program reminders in step with the program', async () => {
    const s = await open();
    const a = s.put('vehicles', { name: 'A', meter: 100 });
    const b = s.put('vehicles', { name: 'B', meter: 200 });
    const manual = s.put('reminders', { vehicleId: a.id, taskId: 'tx' });
    const program = s.put('servicePrograms', { name: 'P', vehicleIds: [a.id, b.id], schedules: [{ id: 's1', taskId: 't1', interval: { every: 3, unit: 'months' } }] });
    act.syncProgramReminders(s, program, '2026-10-12');
    expect(s.all('reminders').filter((r) => r.programId === program.id)).toHaveLength(2);
    const next = s.put('servicePrograms', { ...program, vehicleIds: [b.id], schedules: [{ id: 's1', taskId: 't1', interval: { every: 6, unit: 'months' } }] });
    act.syncProgramReminders(s, next, '2026-10-12');
    const left = s.all('reminders').filter((r) => r.programId === program.id);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ vehicleId: b.id, interval: { every: 6, unit: 'months' }, lastMeter: 200 });
    act.removeProgram(s, next, '2026-10-12');
    expect(s.all('reminders').map((r) => r.id)).toEqual([manual.id]);
  });
});

describe('sample data', () => {
  it('is consistent and deterministic', () => {
    const a = buildSampleData('2026-10-12');
    const b = buildSampleData('2026-10-12');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const c of Object.keys(a.collections)) expect(COLLECTIONS).toContain(c);
    const vehicles = new Set(a.collections.vehicles.map((v) => v.id));
    for (const c of ['fuel', 'meters', 'issues', 'serviceEntries', 'reminders', 'inspections', 'workOrders']) {
      for (const r of a.collections[c]) expect(vehicles.has(r.vehicleId)).toBe(true);
    }
    const ids = new Set();
    for (const list of Object.values(a.collections)) for (const r of list) {
      expect(ids.has(`${r.id}`)).toBe(false);
      ids.add(r.id);
    }
    // Nothing is dated in the future except due dates.
    for (const f of a.collections.fuel) expect(f.date <= '2026-10-12').toBe(true);
    // Some reminders are overdue or due soon so the demo has something to show.
    const states = a.collections.reminders.map((r) => reminderState(r, a.collections.vehicles.find((v) => v.id === r.vehicleId), '2026-10-12', a.settings).status);
    expect(states).toContain('overdue');
    expect(states).toContain('upcoming');
  });

  it('loads into a store', async () => {
    const data = buildSampleData('2026-10-12');
    const s = await open(data);
    expect(s.all('vehicles').length).toBe(data.collections.vehicles.length);
    expect(s.all('fuel').length).toBe(data.collections.fuel.length);
  });
});

describe('review regressions', () => {
  it('grades a back-dated completion against the meter at the time', async () => {
    const { completeReminder } = await import('../src/core/reminders.js');
    const rem = { interval: null, meterInterval: 5000, lastDate: '2026-01-01', lastMeter: 10000, history: [] };
    const done = completeReminder(rem, { date: '2026-09-01', meter: 14900 }, { meter: 15500 }, settings);
    expect(done.history[0].onTime).toBe(true);
  });

  it('measures plug-in hybrid fuel and charging separately', async () => {
    const { fuelDerivedAll } = await import('../src/core/fuel.js');
    const entries = [
      { id: 'a', vehicleId: 'p', kind: 'fuel', meter: 1000, volume: 8, date: '2026-01-01' },
      { id: 'c', vehicleId: 'p', kind: 'charge', meter: 1100, volume: 30, date: '2026-01-02' },
      { id: 'b', vehicleId: 'p', kind: 'fuel', meter: 1400, volume: 8, date: '2026-01-05' },
    ];
    const d = fuelDerivedAll(entries, () => ({ meterUnit: 'mi' }), 'gal');
    expect(d.get('b').economy).toBeCloseTo(50);
  });

  it('re-completing a work order keeps receipts and moves only the stock difference', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Truck' });
    const part = s.put('parts', { number: 'P', locations: [{ location: 'Main shop', qty: 10 }] });
    const wo = s.put('workOrders', { number: 1, vehicleId: v.id, status: 'in_progress', lineItems: [{ taskId: 't', parts: [{ partId: part.id, qty: 2, unitCost: 100 }] }] });
    const entry = act.completeWorkOrder(s, wo, { date: '2026-10-12', meter: 10 }, settings);
    s.patch('serviceEntries', entry.id, { attachments: [{ id: 'f', path: 'files/x.jpg' }] });
    const reopened = act.reopenWorkOrder(s, s.get('workOrders', wo.id));
    s.put('workOrders', { ...reopened, lineItems: [{ taskId: 't', parts: [{ partId: part.id, qty: 5, unitCost: 100 }] }] });
    act.completeWorkOrder(s, s.get('workOrders', wo.id), { date: '2026-10-13', meter: 12 }, settings);
    expect(act.stockOnHand(s.get('parts', part.id))).toBe(5);
    expect(s.get('serviceEntries', entry.id).attachments).toHaveLength(1);
  });
});
