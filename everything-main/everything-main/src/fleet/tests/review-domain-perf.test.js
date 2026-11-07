import { describe, it, expect } from 'vitest';
import * as R from '../src/core/reports.js';
import { addDays } from '../src/core/dates.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { bucketOf } from '../src/core/schema.js';
import { saveFuel } from '../src/core/actions.js';

// A large fleet: 600 vehicles with four years of fuel, meter readings,
// service, expenses, inspections, and issues.
function bigFleet() {
  const vehicles = Array.from({ length: 600 }, (_, i) => ({ id: `v${i}`, meter: 200000, inServiceMeter: 0, meterUnit: 'mi' }));
  const fuel = [];
  const meters = [];
  const expenses = [];
  const serviceEntries = [];
  const inspections = [];
  const issues = [];
  const reminders = [];
  const renewals = [];
  for (let i = 0; i < 100000; i++) {
    const vehicleId = `v${i % 600}`;
    const date = addDays('2023-01-01', Math.floor(i / 600) % 1400);
    fuel.push({ id: `f${i}`, vehicleId, date, meter: 1000 + i, volume: 10, total: 3500 });
    meters.push({ id: `m${i}`, vehicleId, date, value: 1000 + i });
  }
  for (let i = 0; i < 20000; i++) {
    const vehicleId = `v${i % 600}`;
    const date = addDays('2023-01-01', i % 1400);
    expenses.push({ vehicleId, date, type: 'Tolls', amount: 500 });
    serviceEntries.push({ vehicleId, date, lineItems: [{ laborCost: 10000 }] });
    inspections.push({ vehicleId, date, results: [{ label: 'Horn', pass: i % 7 !== 0 }], failed: i % 7 === 0 ? 1 : 0 });
    issues.push({ vehicleId, reportedDate: date, status: 'open' });
  }
  for (let i = 0; i < 3000; i++) {
    reminders.push({ vehicleId: `v${i % 600}`, interval: { every: 6, unit: 'months' }, lastDate: '2026-01-01', history: [] });
    renewals.push({ kind: 'vehicle', vehicleId: `v${i % 600}`, dueDate: '2026-12-01' });
  }
  return { vehicles, fuel, meters, expenses, serviceEntries, inspections, issues, reminders, renewals };
}

describe('report speed', () => {
  it('runs every per-vehicle report on a large fleet without scanning all records per vehicle', () => {
    const data = bigFleet();
    const range = { from: '2023-01-01', to: '2026-12-31' };
    const t = performance.now();
    const cost = R.costReport(data, range);
    R.fuelReport(data, range, 'gal');
    R.serviceReport(data, range);
    R.inspectionReport(data, range);
    R.issueReport(data, range);
    R.utilizationReport(data, range);
    R.complianceReport(data, '2026-10-12', {});
    const tco = R.tcoReport(data);
    const ms = performance.now() - t;
    expect(cost).toHaveLength(600);
    expect(cost.reduce((a, r) => a + r.total, 0)).toBe(100000 * 3500 + 20000 * 500 + 20000 * 10000);
    expect(tco.reduce((a, r) => a + r.operating, 0)).toBe(100000 * 3500 + 20000 * 500 + 20000 * 10000);
    expect(ms).toBeLessThan(1200);
  }, 30000);
});

describe('fuel import speed', () => {
  it('saves 20,000 fuel entries without searching every reading for each', async () => {
    const s = createStore({ backend: createMemoryBackend(undefined, { bucketOf }), flushDelay: 1e9 });
    await s.init();
    const vehicles = Array.from({ length: 50 }, (_, i) => s.put('vehicles', { name: `V${i}` }));
    const t = performance.now();
    for (let i = 0; i < 20000; i++) saveFuel(s, { vehicleId: vehicles[i % 50].id, date: addDays('2024-01-01', Math.floor(i / 50)), meter: 1000 + i * 10, volume: 10, total: 3000 });
    const ms = performance.now() - t;
    expect(s.all('meters')).toHaveLength(20000);
    expect(s.get('vehicles', vehicles[49].id).meter).toBe(1000 + 19999 * 10);
    expect(ms).toBeLessThan(3000);
  }, 60000);
});
