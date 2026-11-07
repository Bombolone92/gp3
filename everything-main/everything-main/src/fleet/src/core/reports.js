/**
 * Report calculations. Each takes plain data ({ vehicles, fuel, ... }) and
 * a range { from, to }, and returns rows. Pure, so they are unit tested.
 */
import { docTotals, lineLabor, lineParts } from './totals.js';
import { roundCents } from './money.js';
import { costLines, usageByVehicle } from './costs.js';
import { fuelDerived, fuelSummary } from './fuel.js';
import { reminderState, renewalState } from './reminders.js';
import { diffDays } from './dates.js';
import { stockOnHand } from './actions.js';

const inRange = (d, { from, to }) => d && (!from || d >= from) && (!to || d <= to);

/** Ids of the vehicles a report covers (after the group and type filters). */
const vehicleSet = (data) => new Set(data.vehicles.map((v) => v.id));

/**
 * Records grouped by vehicle: Map(vehicleId -> records), so a report walks
 * each list once instead of once per vehicle.
 */
function byVehicle(list) {
  const out = new Map();
  for (const r of list || []) {
    const g = out.get(r.vehicleId);
    if (g) g.push(r);
    else out.set(r.vehicleId, [r]);
  }
  return out;
}
const NONE = [];

export function costReport(data, range) {
  const lines = byVehicle(costLines(data).filter((l) => inRange(l.date, range)));
  const usage = usageByVehicle(data.meters || [], range.from, range.to);
  return data.vehicles.map((v) => {
    const mine = lines.get(v.id) || NONE;
    const fuel = mine.filter((l) => l.kind === 'fuel').reduce((a, l) => a + l.amount, 0);
    const service = mine.filter((l) => l.kind === 'service').reduce((a, l) => a + l.amount, 0);
    const other = mine.filter((l) => l.kind === 'other').reduce((a, l) => a + l.amount, 0);
    const total = fuel + service + other;
    const distance = usage.get(v.id) || 0;
    return { id: v.id, vehicle: v, fuel, service, other, total, distance, costPerMeter: distance > 0 ? Math.round(total / distance) : null };
  });
}

export function fuelReport(data, range, volumeUnit) {
  const fuel = byVehicle(data.fuel);
  return data.vehicles.map((v) => {
    // Economy for the vehicle's main energy: charging for electric vehicles,
    // fuel for everything else (a plug-in hybrid's charging is not mixed in).
    const charge = v.fuelType === 'Electric';
    const mine = fuel.get(v.id) || NONE;
    const all = mine.filter((f) => (f.kind === 'charge') === charge);
    const unit = charge ? 'kWh' : volumeUnit;
    const derived = fuelDerived(all, v.meterUnit || 'mi', unit);
    const rows = all.filter((f) => inRange(f.date, range));
    const s = fuelSummary(rows, derived, { meterUnit: v.meterUnit || 'mi', volumeUnit: unit });
    // The other energy (a plug-in hybrid's charging) still costs money: it
    // counts in the cost and entries, as on the vehicle page and in the
    // operating cost report.
    const other = mine.filter((f) => (f.kind === 'charge') !== charge && inRange(f.date, range));
    const cost = s.cost + other.reduce((a, f) => a + (Number(f.total) || 0), 0);
    return { id: v.id, vehicle: v, unit, entries: s.count + other.length, volume: s.volume, cost, avgPrice: s.avgPrice, economy: s.avgEconomy, distance: s.distance, costPerMeter: s.distance > 0 ? Math.round(cost / s.distance) : null };
  });
}

export function serviceReport(data, range) {
  const entries = byVehicle(data.serviceEntries);
  return data.vehicles.map((v) => {
    const rows = (entries.get(v.id) || NONE).filter((e) => inRange(e.date, range));
    const t = rows.reduce((a, e) => {
      const x = docTotals(e);
      return { labor: a.labor + x.labor, parts: a.parts + x.parts, total: a.total + x.total };
    }, { labor: 0, parts: 0, total: 0 });
    const emergency = rows.filter((e) => e.repairClass === 'emergency' || e.repairClass === 'non_scheduled').length;
    return { id: v.id, vehicle: v, entries: rows.length, ...t, unscheduled: emergency };
  });
}

export function taskReport(data, range) {
  const ids = vehicleSet(data);
  const m = new Map();
  for (const e of data.serviceEntries) {
    if (!ids.has(e.vehicleId) || !inRange(e.date, range)) continue;
    for (const li of e.lineItems || []) {
      const key = li.taskId || `custom:${li.description || 'Other'}`;
      let row = m.get(key);
      if (!row) m.set(key, (row = { id: key, taskId: li.taskId || null, name: li.description || 'Custom work', count: 0, vehicles: new Set(), labor: 0, parts: 0 }));
      row.count++;
      row.vehicles.add(e.vehicleId);
      row.labor += lineLabor(li);
      row.parts += lineParts(li);
    }
  }
  return [...m.values()].map((r) => ({ ...r, vehicles: r.vehicles.size, total: r.labor + r.parts }));
}

export function expenseReport(data, range) {
  const ids = vehicleSet(data);
  const m = new Map();
  for (const e of data.expenses) {
    if (!ids.has(e.vehicleId) || !inRange(e.date, range)) continue;
    let row = m.get(e.type);
    if (!row) m.set(e.type, (row = { id: e.type, type: e.type, count: 0, total: 0, vehicles: new Set() }));
    row.count++;
    row.total += Number(e.amount) || 0;
    row.vehicles.add(e.vehicleId);
  }
  return [...m.values()].map((r) => ({ ...r, vehicles: r.vehicles.size }));
}

export function inspectionReport(data, range) {
  const ids = vehicleSet(data);
  const subs = data.inspections.filter((s) => ids.has(s.vehicleId) && inRange(s.date, range));
  const grouped = byVehicle(subs);
  const rows = data.vehicles.map((v) => {
    const mine = grouped.get(v.id) || NONE;
    const items = mine.flatMap((s) => (s.results || []).filter((r) => r.pass !== null));
    const failed = items.filter((r) => r.pass === false).length;
    return { id: v.id, vehicle: v, submissions: mine.length, withFailures: mine.filter((s) => s.failed > 0).length, failedItems: failed, passRate: items.length ? (items.length - failed) / items.length : null, last: mine.reduce((a, s) => (s.date > a ? s.date : a), '') || null };
  });
  const fails = new Map();
  for (const s of subs) for (const r of s.results || []) if (r.pass === false) fails.set(r.label, (fails.get(r.label) || 0) + 1);
  const topFailures = [...fails.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, count]) => ({ label, count }));
  return { byVehicle: rows, topFailures, total: subs.length };
}

export function issueReport(data, range) {
  const issues = byVehicle(data.issues);
  return data.vehicles.map((v) => {
    const reported = (issues.get(v.id) || NONE).filter((i) => inRange(i.reportedDate, range));
    const resolved = reported.filter((i) => i.status !== 'open' && i.resolvedAt);
    const days = resolved.map((i) => diffDays(i.reportedDate, i.resolvedAt)).filter((d) => d >= 0);
    return { id: v.id, vehicle: v, reported: reported.length, open: reported.filter((i) => i.status === 'open').length, resolved: resolved.length, avgDays: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null, critical: reported.filter((i) => i.priority === 'critical' || i.priority === 'high').length };
  });
}

export function complianceReport(data, today, settings) {
  const reminders = byVehicle(data.reminders);
  const renewals = byVehicle(data.renewals.filter((r) => r.kind === 'vehicle'));
  return data.vehicles.map((v) => {
    const rems = (reminders.get(v.id) || NONE).filter((r) => !r.archived);
    const st = rems.map((r) => reminderState(r, v, today, settings).status);
    const hist = rems.flatMap((r) => r.history || []);
    const rens = (renewals.get(v.id) || NONE).filter((r) => !r.done).map((r) => renewalState(r, today, settings).status);
    return { id: v.id, vehicle: v, reminders: rems.length, overdue: st.filter((s) => s === 'overdue').length, dueSoon: st.filter((s) => s === 'due_soon').length, onTime: hist.length ? hist.filter((h) => h.onTime).length / hist.length : null, renewalsOverdue: rens.filter((s) => s === 'overdue').length };
  });
}

export function utilizationReport(data, range) {
  const usage = usageByVehicle(data.meters || [], range.from, range.to);
  const days = range.from && range.to ? diffDays(range.from, range.to) + 1 : null;
  const meters = byVehicle(data.meters);
  return data.vehicles.map((v) => {
    const u = usage.get(v.id) || 0;
    const readings = (meters.get(v.id) || NONE).filter((m) => !m.void && inRange(m.date, range)).length;
    return { id: v.id, vehicle: v, usage: u, perDay: days ? u / days : null, readings };
  });
}

/** Lifetime cost of ownership: purchase, operating costs, minus resale. */
export function tcoReport(data) {
  const lines = byVehicle(costLines(data));
  return data.vehicles.map((v) => {
    const mine = lines.get(v.id) || NONE;
    const operating = mine.reduce((a, l) => a + l.amount, 0);
    const purchase = Number(v.purchase?.price) || 0;
    const resale = Number(v.estResaleValue) || 0;
    const total = purchase + operating - resale;
    const driven = v.meter != null ? Number(v.meter) - (Number(v.inServiceMeter) || 0) : null;
    return { id: v.id, vehicle: v, purchase, operating, resale, total, driven, costPerMeter: driven > 0 ? Math.round(total / driven) : null };
  });
}

export function inventoryReport(parts) {
  const m = new Map();
  for (const p of parts) {
    if (p.archived) continue;
    const cat = p.category || 'Uncategorized';
    let row = m.get(cat);
    if (!row) m.set(cat, (row = { id: cat, category: cat, parts: 0, units: 0, value: 0, low: 0 }));
    const on = stockOnHand(p);
    row.parts++;
    row.units += on;
    row.value += roundCents(on * (Number(p.unitCost) || 0));
    if ((p.locations || []).some((l) => l.reorderPoint != null && l.reorderPoint !== '' && (Number(l.qty) || 0) <= Number(l.reorderPoint))) row.low++;
  }
  return [...m.values()];
}
