/** Wave 2 review of cross-record actions, reports, and team sync. */
import { describe, it, expect } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { bucketOf } from '../src/core/schema.js';
import { defaultSettings } from '../src/core/settings.js';
import * as act from '../src/core/actions.js';

async function open(seed = { settings: defaultSettings() }) {
  const store = createStore({ backend: createMemoryBackend(seed, { bucketOf }), flushDelay: 0 });
  await store.init();
  return store;
}

describe('meter warnings', () => {
  it('name the earlier reading with its unit and a readable date', async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Import truck', meterUnit: 'km' });
    act.recordMeter(s, { vehicleId: v.id, value: 12000, date: '2026-10-01' });
    act.recordMeter(s, { vehicleId: v.id, value: 13000, date: '2026-10-10' });
    expect(act.meterWarnings(s, { vehicleId: v.id, value: 11000, date: '2026-10-05' })).toEqual(['This is lower than the reading of 12,000 km on Oct 1, 2026.']);
    expect(act.meterWarnings(s, { vehicleId: v.id, value: 13500, date: '2026-10-05' })).toEqual(['This is higher than the later reading of 13,000 km on Oct 10, 2026.']);
    expect(act.meterWarnings(s, { vehicleId: v.id, value: 19000, date: '2026-10-12' })).toEqual(['This is 6,000 km more than the previous reading. Check for a typo.']);
  });

  it('use the fleet distance unit for a vehicle without its own', async () => {
    const s = await open({ settings: { ...defaultSettings(), units: { ...defaultSettings().units, distance: 'km' } } });
    const v = s.put('vehicles', { name: 'Van' });
    act.recordMeter(s, { vehicleId: v.id, value: 1000, date: '2026-10-01' });
    expect(act.meterWarnings(s, { vehicleId: v.id, value: 900, date: '2026-10-02' })[0]).toContain('1,000 km');
  });
});

describe('fuel summary report', () => {
  const R = () => import('../src/core/reports.js');
  const phev = { id: 'p1', name: 'Plug-in', fuelType: 'Plug-in hybrid', meterUnit: 'mi' };
  const entries = [
    { id: 'f1', vehicleId: 'p1', kind: 'fuel', date: '2026-10-01', meter: 1000, volume: 10, total: 4000 },
    { id: 'c1', vehicleId: 'p1', kind: 'charge', date: '2026-10-03', meter: 1100, volume: 20, total: 300 },
    { id: 'f2', vehicleId: 'p1', kind: 'fuel', date: '2026-10-05', meter: 1300, volume: 8, total: 3200 },
  ];
  const data = { vehicles: [phev], fuel: entries };

  it("counts a plug-in hybrid's charging in its fuel cost", async () => {
    const { fuelReport, costReport } = await R();
    const [row] = fuelReport(data, { from: '2026-10-01', to: '2026-10-12' }, 'gal');
    // The same total the operating cost report shows for fuel.
    const [costs] = costReport({ ...data, serviceEntries: [], expenses: [], meters: [] }, { from: '2026-10-01', to: '2026-10-12' });
    expect(row.cost).toBe(7500);
    expect(row.cost).toBe(costs.fuel);
    expect(row.entries).toBe(3);
    // Volume, price and economy stay in gallons, from the fill-ups only.
    expect(row.volume).toBe(18);
    expect(row.avgPrice).toBeCloseTo(4);
    expect(row.economy).toBeCloseTo(300 / 8);
    // All energy over the distance driven: $75.00 over 300 miles.
    expect(row.costPerMeter).toBe(25);
  });
});

describe('completing a work order without a meter', () => {
  it("records no reading instead of the meter from when the work order was opened", async () => {
    const s = await open();
    const v = s.put('vehicles', { name: 'Van', meterUnit: 'mi' });
    act.recordMeter(s, { vehicleId: v.id, value: 1000, date: '2026-10-01' });
    const wo = s.put('workOrders', { number: 1, vehicleId: v.id, status: 'in_progress', meter: 1000, lineItems: [] });
    act.recordMeter(s, { vehicleId: v.id, value: 1800, date: '2026-10-08' });
    // The meter field was cleared in the Complete dialog.
    const entry = act.completeWorkOrder(s, wo, { date: '2026-10-12', meter: null }, defaultSettings());
    expect(entry.meter).toBe(null);
    expect(s.get('vehicles', v.id).meter).toBe(1800);
    expect(s.all('meters').map((m) => m.value).sort()).toEqual([1000, 1800]);
  });
});
