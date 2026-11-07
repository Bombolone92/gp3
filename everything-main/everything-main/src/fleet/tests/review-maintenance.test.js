import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { bucketOf } from '../src/core/schema.js';
import { defaultSettings } from '../src/core/settings.js';
import * as act from '../src/core/actions.js';

async function open(seed) {
  const store = createStore({ backend: createMemoryBackend(seed, { bucketOf }), flushDelay: 0 });
  await store.init();
  return store;
}

const settings = defaultSettings();

describe('stock adjustments', () => {
  it('adds stock at a location the part is not stocked at yet, not at the first one', async () => {
    const s = await open();
    const p = s.put('parts', { number: 'F1', locations: [{ location: 'Main shop', qty: 4, aisle: 'A1', reorderPoint: 2 }] });
    act.adjustStock(s, p.id, 'Warehouse', 3);
    const locs = s.get('parts', p.id).locations;
    expect(locs.find((l) => l.location === 'Main shop').qty).toBe(4);
    expect(locs.find((l) => l.location === 'Warehouse').qty).toBe(3);
  });

  it('still takes stock from the first location when no location is given', async () => {
    const s = await open();
    const p = s.put('parts', { number: 'F1', locations: [{ location: 'Main shop', qty: 4 }, { location: 'Van', qty: 1 }] });
    act.adjustStock(s, p.id, null, -2);
    expect(s.get('parts', p.id).locations.map((l) => l.qty)).toEqual([2, 1]);
  });
});

describe('purchase order receipts', () => {
  it('keeps an ordered purchase order ordered when nothing was received', async () => {
    const s = await open();
    const p = s.put('parts', { number: 'F1', locations: [{ location: 'Main shop', qty: 0 }] });
    const po = s.put('purchaseOrders', { status: 'ordered', location: 'Main shop', items: [{ id: 'i1', partId: p.id, qty: 5, unitCost: 100, received: 0 }] });
    const out = act.receivePurchaseOrder(s, po, { i1: 0 }, '2026-10-12');
    expect(out.status).toBe('ordered');
    expect(out.receivedDate).toBeFalsy();
  });
});

describe('editing a service entry after it completed a reminder', () => {
  async function setup() {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van', meter: 12000 });
    const t = s.put('serviceTasks', { name: 'Oil change' });
    const r = s.put('reminders', { vehicleId: v.id, taskId: t.id, interval: { every: 6, unit: 'months' }, meterInterval: 5000, lastDate: '2026-01-01', lastMeter: 5000, startDate: '2026-01-01', startMeter: 5000, history: [] });
    const e = act.saveServiceEntry(s, { vehicleId: v.id, date: '2026-10-01', meter: 11000, lineItems: [{ id: 'l1', taskId: t.id, parts: [] }], reminderIds: [r.id], issueIds: [] }, settings);
    return { s, v, t, r, e };
  }

  it('moves the completion when the entry date or meter is corrected', async () => {
    const { s, r, e } = await setup();
    act.saveServiceEntry(s, { ...s.get('serviceEntries', e.id), date: '2026-09-01', meter: 10500 }, settings);
    const rem = s.get('reminders', r.id);
    expect(rem.lastDate).toBe('2026-09-01');
    expect(rem.lastMeter).toBe(10500);
    expect(rem.history).toHaveLength(1);
    expect(rem.history[0]).toMatchObject({ date: '2026-09-01', meter: 10500, entryId: e.id });
  });

  it('undoes the completion when the reminder is unlinked from the entry', async () => {
    const { s, r, e } = await setup();
    act.saveServiceEntry(s, { ...s.get('serviceEntries', e.id), reminderIds: [] }, settings);
    const rem = s.get('reminders', r.id);
    expect(rem.history).toHaveLength(0);
    expect(rem.lastDate).toBe('2026-01-01');
    expect(rem.lastMeter).toBe(5000);
  });

  it('leaves a later completion alone', async () => {
    const { s, v, t, r, e } = await setup();
    const e2 = act.saveServiceEntry(s, { vehicleId: v.id, date: '2026-10-10', meter: 11900, lineItems: [{ id: 'l2', taskId: t.id, parts: [] }], reminderIds: [r.id], issueIds: [] }, settings);
    act.saveServiceEntry(s, { ...s.get('serviceEntries', e.id), notes: 'typo fixed' }, settings);
    const rem = s.get('reminders', r.id);
    expect(rem.lastDate).toBe('2026-10-10');
    expect(rem.history.map((h) => h.entryId)).toEqual([e.id, e2.id]);
  });
});

describe('editing a service entry that resolved an issue', () => {
  async function setup() {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van' });
    const i = s.put('issues', { number: 1, vehicleId: v.id, summary: 'Brake light', status: 'open' });
    const e = act.saveServiceEntry(s, { vehicleId: v.id, date: '2026-10-01', lineItems: [], issueIds: [i.id], reminderIds: [] }, settings);
    return { s, i, e };
  }

  it('reopens the issue when it is unticked', async () => {
    const { s, i, e } = await setup();
    expect(s.get('issues', i.id).status).toBe('resolved');
    act.saveServiceEntry(s, { ...s.get('serviceEntries', e.id), issueIds: [] }, settings);
    expect(s.get('issues', i.id)).toMatchObject({ status: 'open', resolvedAt: null, resolution: null });
  });

  it('moves the resolution date with the entry date', async () => {
    const { s, i, e } = await setup();
    act.saveServiceEntry(s, { ...s.get('serviceEntries', e.id), date: '2026-09-28' }, settings);
    expect(s.get('issues', i.id)).toMatchObject({ status: 'resolved', resolvedAt: '2026-09-28', resolution: { type: 'service', id: e.id, date: '2026-09-28' } });
  });

  it('leaves an issue resolved some other way alone', async () => {
    const { s, e } = await setup();
    const v2 = s.all('vehicles')[0];
    const other = s.put('issues', { number: 2, vehicleId: v2.id, summary: 'Wipers', status: 'resolved', resolvedAt: '2026-09-01', resolution: { type: 'note', note: 'Fixed', date: '2026-09-01' } });
    act.saveServiceEntry(s, { ...s.get('serviceEntries', e.id), issueIds: [] }, settings);
    expect(s.get('issues', other.id)).toMatchObject({ status: 'resolved', resolution: { type: 'note' } });
  });
});
