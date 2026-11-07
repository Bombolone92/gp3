import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { bucketOf } from '../src/core/schema.js';
import { defaultSettings } from '../src/core/settings.js';
import * as act from '../src/core/actions.js';
import { parseRecalls, fetchRecalls } from '../src/core/recalls.js';
import * as R from '../src/core/reports.js';
import { fuelTotal, fuelWarnings, fuelDerived } from '../src/core/fuel.js';
import { lineLabor, lineParts, docTotals } from '../src/core/totals.js';
import { parseMoney, roundCents } from '../src/core/money.js';
import { parseCSV, toCSV } from '../src/core/csv.js';
import { createSearchIndex } from '../src/core/search.js';
import { inspectionsDue } from '../src/core/inspections.js';
import { addInterval } from '../src/core/dates.js';
import { completeReminder, reminderState, completeRenewal } from '../src/core/reminders.js';

async function open(seed) {
  const store = createStore({ backend: createMemoryBackend(seed, { bucketOf }), flushDelay: 0 });
  await store.init();
  return store;
}

const settings = defaultSettings();

describe('recalls', () => {
  it('reads NHTSA report dates as day/month/year', () => {
    // The recalls API sends "21/02/2019" for 21 February 2019.
    const list = parseRecalls({ results: [{ NHTSACampaignNumber: '19V103000', ReportReceivedDate: '21/02/2019' }, { NHTSACampaignNumber: '19V439000', ReportReceivedDate: '11/06/2019' }] });
    expect(list.map((r) => r.date)).toEqual(['2019-06-11', '2019-02-21']);
  });
});

describe('reports', () => {
  it('limits every report to the vehicles left by the group and type filters', () => {
    const a = { id: 'a', groupId: 'north' };
    const b = { id: 'b', groupId: 'south' };
    const all = {
      vehicles: [a, b],
      expenses: [
        { vehicleId: 'a', date: '2026-10-01', type: 'Tolls', amount: 1000 },
        { vehicleId: 'b', date: '2026-10-01', type: 'Tolls', amount: 5000 },
        { vehicleId: 'b', date: '2026-10-01', type: 'Parking', amount: 700 },
      ],
      serviceEntries: [
        { vehicleId: 'a', date: '2026-10-01', lineItems: [{ taskId: 't1', laborCost: 100 }] },
        { vehicleId: 'b', date: '2026-10-01', lineItems: [{ taskId: 't1', laborCost: 900 }, { taskId: 't2', laborCost: 50 }] },
      ],
      inspections: [
        { vehicleId: 'a', date: '2026-10-01', results: [{ label: 'Horn', pass: false }] },
        { vehicleId: 'b', date: '2026-10-01', results: [{ label: 'Lights', pass: false }] },
      ],
    };
    const north = { ...all, vehicles: [a] };
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect(R.expenseReport(north, range)).toEqual([{ id: 'Tolls', type: 'Tolls', count: 1, total: 1000, vehicles: 1 }]);
    expect(R.taskReport(north, range).map((r) => [r.id, r.count, r.total])).toEqual([['t1', 1, 100]]);
    expect(R.inspectionReport(north, range).topFailures).toEqual([{ label: 'Horn', count: 1 }]);
    expect(R.inspectionReport(north, range).total).toBe(1);
    expect(R.expenseReport(all, range).reduce((s, r) => s + r.total, 0)).toBe(6700);
  });
});

describe('service reminders', () => {
  it('counts a late completion as late even while the reminder was snoozed', () => {
    const rem = { interval: { every: 6, unit: 'months' }, meterInterval: null, lastDate: '2026-01-01', lastMeter: null, snoozedUntil: '2026-10-20', history: [] };
    expect(reminderState(rem, null, '2026-10-12', settings).status).toBe('snoozed');
    const done = completeReminder(rem, { date: '2026-10-12', meter: null }, null, settings);
    expect(done.history[0].onTime).toBe(false);
  });
});

describe('service entries and reminders', () => {
  async function setup() {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van', meter: 50000 });
    const rem = s.put('reminders', { vehicleId: v.id, taskId: 't1', interval: { every: 6, unit: 'months' }, meterInterval: 5000, lastDate: '2026-01-01', lastMeter: 40000, startDate: '2026-01-01', startMeter: 40000, history: [] });
    return { s, v, rem };
  }

  it('moves the reminder when the entry that completed it is corrected', async () => {
    const { s, v, rem } = await setup();
    const e = act.saveServiceEntry(s, { vehicleId: v.id, date: '2026-10-10', meter: 500000, lineItems: [{ taskId: 't1' }], reminderIds: [rem.id] }, settings);
    expect(s.get('reminders', rem.id).lastMeter).toBe(500000);
    act.saveServiceEntry(s, { ...s.get('serviceEntries', e.id), date: '2026-10-09', meter: 50000 }, settings);
    const r = s.get('reminders', rem.id);
    expect(r).toMatchObject({ lastDate: '2026-10-09', lastMeter: 50000 });
    expect(r.history).toHaveLength(1);
    expect(r.history[0]).toMatchObject({ date: '2026-10-09', meter: 50000, entryId: e.id });
  });

  it('undoes the completion when the reminder is taken off the entry', async () => {
    const { s, v, rem } = await setup();
    const e = act.saveServiceEntry(s, { vehicleId: v.id, date: '2026-10-10', meter: 50100, lineItems: [{ taskId: 't1' }], reminderIds: [rem.id] }, settings);
    act.saveServiceEntry(s, { ...s.get('serviceEntries', e.id), reminderIds: [] }, settings);
    expect(s.get('reminders', rem.id)).toMatchObject({ lastDate: '2026-01-01', lastMeter: 40000, history: [] });
  });

  it('restarts reminders from the new date when a work order is completed again', async () => {
    const { s, v, rem } = await setup();
    const wo = s.put('workOrders', { number: 1, vehicleId: v.id, status: 'in_progress', lineItems: [{ taskId: 't1' }], reminderIds: [rem.id] });
    act.completeWorkOrder(s, wo, { date: '2026-10-01', meter: 50000 }, settings);
    act.reopenWorkOrder(s, s.get('workOrders', wo.id));
    act.completeWorkOrder(s, s.get('workOrders', wo.id), { date: '2026-10-12', meter: 50400 }, settings);
    expect(s.get('reminders', rem.id)).toMatchObject({ lastDate: '2026-10-12', lastMeter: 50400 });
    expect(s.get('reminders', rem.id).history).toHaveLength(1);
  });
});

describe('money rounding', () => {
  it('rounds half cents up despite floating point noise', () => {
    // 3 gal at $3.025 is $9.075, 0.41 hr at $95.50 is $39.155, 0.7 x $12.95 is $9.065.
    expect(fuelTotal(3, 3.025)).toBe(908);
    expect(fuelTotal(10.28, 4.125)).toBe(4241);
    expect(lineLabor({ laborHours: 0.41, laborRate: 9550 })).toBe(3916);
    expect(lineParts({ parts: [{ qty: 0.7, unitCost: 1295 }] })).toBe(907);
    expect(docTotals({ lineItems: [{ laborHours: 0.41, laborRate: 9550 }] }).total).toBe(3916);
    expect(roundCents(-906.5)).toBe(-907);
    expect(roundCents(906.4999999999999)).toBe(907);
  });
});

describe('parsing money', () => {
  it('reads decimal commas, thousands separators, and a minus after the symbol', () => {
    expect(parseMoney('12,50')).toBe(1250);
    expect(parseMoney('12,5')).toBe(1250);
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('1 234,56 €')).toBe(123456);
    expect(parseMoney('1,234.50')).toBe(123450);
    expect(parseMoney('1,234')).toBe(123400);
    expect(parseMoney('1,234,567')).toBe(123456700);
    expect(parseMoney('$5')).toBe(500);
    expect(parseMoney('$-5')).toBe(-500);
    expect(parseMoney('-$5')).toBe(-500);
    expect(parseMoney('(5.25)')).toBe(-525);
    expect(parseMoney('0.005')).toBe(1);
    expect(parseMoney('')).toBe(null);
  });
});

describe('CSV', () => {
  it('keeps a quote inside an unquoted field as text', () => {
    expect(parseCSV('Part,Size,Qty\r\nWheel,16" alloy,4\r\nBlade,"22"" wiper",2\r\n')).toEqual([
      ['Part', 'Size', 'Qty'],
      ['Wheel', '16" alloy', '4'],
      ['Blade', '22" wiper', '2'],
    ]);
  });

  it('round-trips what it writes', () => {
    const rows = [['Name', 'Note'], ['Müller, A.', 'said "hi"\nthen left'], ['=1+1', '-5']];
    expect(parseCSV(toCSV(rows))).toEqual([['Name', 'Note'], ['Müller, A.', 'said "hi"\nthen left'], ["'=1+1", '-5']]);
  });
});

describe('renewals', () => {
  it('keeps a month-end due date at the month end as it repeats', () => {
    let r = { dueDate: '2026-01-31', repeat: { every: 1, unit: 'months' }, history: [] };
    const dues = [];
    for (let i = 0; i < 4; i++) {
      // The resolve dialog proposes the next date and passes it back.
      const proposed = completeRenewal(r, { date: r.dueDate }).dueDate;
      r = completeRenewal(r, { date: r.dueDate, nextDue: proposed });
      dues.push(r.dueDate);
    }
    expect(dues).toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('repeats from a due date that was changed by hand', () => {
    let r = { dueDate: '2026-01-31', repeat: { every: 1, unit: 'months' }, history: [] };
    r = completeRenewal(r, { date: '2026-01-31' });
    r = { ...r, dueDate: '2026-03-15' };
    r = completeRenewal(r, { date: '2026-03-15' });
    expect(r.dueDate).toBe('2026-04-15');
    r = completeRenewal(r, { date: '2026-04-15', nextDue: '2026-06-30' });
    expect(completeRenewal(r, { date: '2026-06-30' }).dueDate).toBe('2026-07-30');
  });

  it('keeps a leap day renewal on Feb 29 in leap years', () => {
    let r = { dueDate: '2028-02-29', repeat: { every: 1, unit: 'years' }, history: [] };
    const dues = [];
    for (let i = 0; i < 4; i++) dues.push((r = completeRenewal(r, { date: r.dueDate })).dueDate);
    expect(dues).toEqual(['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });
});

describe('back-dated service', () => {
  it('records an older service without moving the schedule back', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van', meter: 52000 });
    const rem = s.put('reminders', { vehicleId: v.id, taskId: 't1', interval: { every: 6, unit: 'months' }, meterInterval: 5000, lastDate: '2026-01-01', lastMeter: 40000, startDate: '2026-01-01', startMeter: 40000, history: [] });
    const recent = act.saveServiceEntry(s, { vehicleId: v.id, date: '2026-09-01', meter: 50000, lineItems: [{ taskId: 't1' }], reminderIds: [rem.id] }, settings);
    // Typing in last spring's paper record afterwards.
    const old = act.saveServiceEntry(s, { vehicleId: v.id, date: '2026-04-01', meter: 45000, lineItems: [{ taskId: 't1' }], reminderIds: [rem.id] }, settings);
    let r = s.get('reminders', rem.id);
    expect(r).toMatchObject({ lastDate: '2026-09-01', lastMeter: 50000 });
    expect(r.history.map((h) => h.entryId)).toEqual([old.id, recent.id]);
    expect(reminderState(r, s.get('vehicles', v.id), '2026-10-12', settings).status).toBe('upcoming');
    // Deleting the newer entry falls back to the older one.
    act.deleteServiceEntry(s, recent.id);
    r = s.get('reminders', rem.id);
    expect(r).toMatchObject({ lastDate: '2026-04-01', lastMeter: 45000 });
  });
});

describe('global search', () => {
  it('finds issues and work orders by a vehicle name changed after the first search', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van 101' });
    s.put('issues', { number: 1, vehicleId: v.id, summary: 'Brakes squeal', status: 'open' });
    s.put('workOrders', { number: 1, vehicleId: v.id });
    const search = createSearchIndex(s);
    expect(search('van 101').map((g) => g.coll)).toEqual(['vehicles', 'issues', 'workOrders']);
    s.patch('vehicles', v.id, { name: 'Truck 7' });
    expect(search('truck 7').map((g) => g.coll)).toEqual(['vehicles', 'issues', 'workOrders']);
    expect(search('van 101')).toEqual([]);
  });
});

describe('global search ranking', () => {
  it('puts an exact issue number first even when newer issues share its digits', async () => {
    let t = 0;
    const store = createStore({ backend: createMemoryBackend(undefined, { bucketOf }), flushDelay: 0, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, t++)).toISOString() });
    await store.init();
    const v = store.put('vehicles', { name: 'Van' });
    for (let n = 1; n <= 60; n++) store.put('issues', { number: n, vehicleId: v.id, summary: `Issue ${n}`, status: 'open' });
    const search = createSearchIndex(store);
    expect(search('#5').find((g) => g.coll === 'issues').items[0].title).toBe('#5 Issue 5');
    expect(search('ford').length).toBe(0);
  });
});

describe('voided meter readings', () => {
  it('stay void when the fuel entry they came from is edited', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van' });
    act.saveFuel(s, { vehicleId: v.id, date: '2026-10-01', meter: 50000, volume: 10, total: 3000 });
    const f = act.saveFuel(s, { vehicleId: v.id, date: '2026-10-05', meter: 95000, volume: 10, total: 3000 });
    const bad = s.all('meters').find((m) => m.source?.id === f.id);
    s.put('meters', { ...bad, void: true });
    act.recomputeVehicleMeter(s, v.id);
    expect(s.get('vehicles', v.id).meter).toBe(50000);
    // Fixing the price leaves the voided reading alone.
    act.saveFuel(s, { ...s.get('fuel', f.id), total: 3100 });
    expect(s.get('meters', bad.id).void).toBe(true);
    expect(s.get('vehicles', v.id).meter).toBe(50000);
    // Correcting the odometer brings the reading back.
    act.saveFuel(s, { ...s.get('fuel', f.id), meter: 50300 });
    expect(s.get('meters', bad.id).void).toBe(false);
    expect(s.get('vehicles', v.id).meter).toBe(50300);
  });
});

describe('stock locations', () => {
  it('puts stock at the chosen location even when the part has none there yet', async () => {
    const s = await open();
    const part = s.put('parts', { number: 'P', locations: [{ location: 'Main shop', qty: 3, aisle: 'A1', reorderPoint: 1 }] });
    const po = s.put('purchaseOrders', { number: 1, status: 'ordered', location: 'North depot', items: [{ id: 'i1', partId: part.id, qty: 4, unitCost: 500, received: 0 }] });
    act.receivePurchaseOrder(s, po, { i1: 4 }, '2026-10-12');
    act.adjustStock(s, part.id, 'South depot', 2);
    expect(s.get('parts', part.id).locations.map((l) => [l.location, l.qty])).toEqual([['Main shop', 3], ['North depot', 4], ['South depot', 2]]);
    // Work orders take parts from the first location.
    act.adjustStock(s, part.id, null, -1);
    expect(s.get('parts', part.id).locations[0].qty).toBe(2);
  });
});

describe('scheduled inspections', () => {
  it('flags a vehicle never inspected since the schedule began as overdue', () => {
    const form = { id: 'f', schedule: { every: 1, unit: 'weeks' }, createdAt: '2026-08-01T12:00:00.000Z' };
    const old = { id: 'old', createdAt: '2026-01-01T12:00:00.000Z' };
    const added = { id: 'new', createdAt: '2026-10-12T12:00:00.000Z' };
    const due = inspectionsDue([form], [old, added], [], '2026-10-12', addInterval);
    expect(due.map((d) => [d.vehicle.id, d.dueDate, d.overdue])).toEqual([
      ['old', '2026-08-01', true],
      ['new', '2026-10-12', false],
    ]);
  });
});

describe('totals with credits', () => {
  it('never turns a discount into a charge or wipes out a credit', () => {
    // A warranty credit larger than the work: the discount has nothing to take off.
    const credit = { lineItems: [{ laborCost: 5000 }, { laborCost: -15000 }], discount: { type: 'percent', value: 10 }, taxPercent: 0 };
    expect(docTotals(credit)).toMatchObject({ subtotal: -10000, discount: 0, total: -10000 });
    const amount = { lineItems: [{ laborCost: -2000 }], discount: { type: 'amount', value: 500 } };
    expect(docTotals(amount)).toMatchObject({ subtotal: -2000, discount: 0, total: -2000 });
  });
});

describe('recall lookup', () => {
  it('retries without the trailing trim or size when the full model finds nothing', async () => {
    // NHTSA lists "TRANSIT", not "Transit 250", but does list "Model Y".
    const known = { TRANSIT: [{ NHTSACampaignNumber: '22V001000', ReportReceivedDate: '05/01/2022' }], 'MODEL Y': [{ NHTSACampaignNumber: '23V002000' }] };
    const asked = [];
    const fetchFn = async (url) => {
      const model = new URL(url).searchParams.get('model');
      asked.push(model);
      return { ok: true, json: async () => ({ results: known[model.toUpperCase()] || [] }) };
    };
    expect((await fetchRecalls({ year: 2022, make: 'Ford', model: 'Transit 250' }, fetchFn)).map((r) => r.campaign)).toEqual(['22V001000']);
    expect(asked).toEqual(['Transit 250', 'Transit']);
    asked.length = 0;
    expect(await fetchRecalls({ year: 2024, make: 'Tesla', model: 'Model Y' }, fetchFn)).toHaveLength(1);
    expect(asked).toEqual(['Model Y']);
    asked.length = 0;
    expect(await fetchRecalls({ year: 2019, make: 'Isuzu', model: 'NPR-HD' }, fetchFn)).toEqual([]);
    expect(asked).toEqual(['NPR-HD']);
  });
});

describe('reminders without a last completion', () => {
  it('count the time interval from when the reminder was added', () => {
    const rem = { interval: { every: 6, unit: 'months' }, meterInterval: null, lastDate: null, lastMeter: null, createdAt: '2026-01-15T12:00:00.000Z', history: [] };
    expect(reminderState(rem, null, '2026-10-12', settings)).toMatchObject({ status: 'overdue', nextDate: '2026-07-15' });
    expect(reminderState({ ...rem, createdAt: undefined }, null, '2026-10-12', settings)).toMatchObject({ status: 'upcoming', nextDate: null });
  });
});

describe('meter warnings', () => {
  it('compares with the lowest of several later readings on the same day', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van' });
    act.recordMeter(s, { vehicleId: v.id, value: 1000, date: '2026-10-01' });
    act.recordMeter(s, { vehicleId: v.id, value: 1600, date: '2026-10-10' });
    act.recordMeter(s, { vehicleId: v.id, value: 1500, date: '2026-10-10' });
    expect(act.meterWarnings(s, { vehicleId: v.id, value: 1550, date: '2026-10-05' })).toEqual(['This is higher than the later reading of 1,500 mi on Oct 10, 2026.']);
    expect(act.meterWarnings(s, { vehicleId: v.id, value: 1200, date: '2026-10-05' })).toEqual([]);
  });
});

describe('fuel warnings', () => {
  it('compares with fill-ups earlier in the day, not later ones', () => {
    const morning = { id: 'a', vehicleId: 'v', date: '2026-10-12', time: '07:30', meter: 50000, volume: 100 };
    const evening = { id: 'b', vehicleId: 'v', date: '2026-10-12', time: '18:45', meter: 50600, volume: 100 };
    expect(fuelWarnings(morning, null, [morning, evening])).toEqual([]);
    expect(fuelWarnings({ ...evening, meter: 49900 }, null, [morning, evening])).toHaveLength(1);
    // Without times, the same day still counts as earlier.
    expect(fuelWarnings({ ...morning, time: '' }, null, [{ ...evening, time: '' }])).toHaveLength(1);
  });
});

describe('fuel economy with a fill-up missing its odometer', () => {
  it('still counts the fuel it added toward the next measurement', () => {
    const entries = [
      { id: 'a', date: '2026-10-01', time: '08:00', meter: 1000, volume: 10 },
      { id: 'b', date: '2026-10-02', time: '08:00', meter: '', volume: 10 },
      { id: 'c', date: '2026-10-03', time: '08:00', meter: 1600, volume: 10 },
      { id: 'd', date: '2026-10-04', time: '08:00', meter: 1900, volume: 10 },
    ];
    const d = fuelDerived(entries, 'mi', 'gal');
    expect(d.get('c').economy).toBeCloseTo(30);
    expect(d.get('c').measured).toEqual({ distance: 600, volume: 20 });
    expect(d.get('d').economy).toBeCloseTo(30);
    expect(d.get('b')).toEqual({ usage: null, economy: null, costPerMeter: null, measured: null });
  });
});
