import { describe, it, expect } from 'vitest';
import { buildSampleData } from '../src/core/sample.js';
import * as R from '../src/core/reports.js';
import { costLines } from '../src/core/costs.js';

const data = buildSampleData('2026-10-12').collections;
const settings = buildSampleData('2026-10-12').settings;
const range = { from: '2026-07-01', to: '2026-10-12' };

describe('reports', () => {
  it('cost report adds up to the cost lines in range', () => {
    const rows = R.costReport(data, range);
    const total = rows.reduce((a, r) => a + r.total, 0);
    const lines = costLines(data).filter((l) => l.date >= range.from && l.date <= range.to);
    expect(total).toBe(lines.reduce((a, l) => a + l.amount, 0));
    for (const r of rows) expect(r.total).toBe(r.fuel + r.service + r.other);
    expect(rows.find((r) => r.distance > 0 && r.costPerMeter > 0)).toBeTruthy();
  });

  it('fuel report computes economy for vehicles with fill-ups', () => {
    const rows = R.fuelReport(data, range, 'gal');
    const van = rows.find((r) => r.vehicle.id === 'v101');
    expect(van.entries).toBeGreaterThan(3);
    expect(van.economy).toBeGreaterThan(12);
    expect(van.economy).toBeLessThan(25);
    expect(rows.find((r) => r.vehicle.id === 'v601').entries).toBe(0);
  });

  it('task report groups line items by task', () => {
    const rows = R.taskReport(data, { from: null, to: null });
    const oil = rows.find((r) => r.taskId === 't-oil');
    expect(oil.count).toBeGreaterThanOrEqual(3);
    expect(oil.total).toBe(oil.labor + oil.parts);
  });

  it('inspection report finds the most failed items', () => {
    const r = R.inspectionReport(data, { from: '2026-09-01', to: '2026-10-12' });
    expect(r.total).toBe(data.inspections.length);
    const totalFailed = r.byVehicle.reduce((a, x) => a + x.failedItems, 0);
    expect(r.topFailures.reduce((a, x) => a + x.count, 0)).toBeLessThanOrEqual(totalFailed);
  });

  it('compliance, issues, utilization, TCO, and inventory reports run', () => {
    expect(R.complianceReport(data, '2026-10-12', settings).some((r) => r.overdue > 0)).toBe(true);
    const issues = R.issueReport(data, { from: null, to: null });
    expect(issues.reduce((a, r) => a + r.reported, 0)).toBe(data.issues.length);
    expect(R.utilizationReport(data, range).find((r) => r.vehicle.id === 'v101').usage).toBeGreaterThan(0);
    const tco = R.tcoReport(data).find((r) => r.vehicle.id === 'v101');
    expect(tco.total).toBe(tco.purchase + tco.operating - tco.resale);
    const inv = R.inventoryReport(data.parts);
    expect(inv.reduce((a, r) => a + r.parts, 0)).toBe(data.parts.length);
  });
});
