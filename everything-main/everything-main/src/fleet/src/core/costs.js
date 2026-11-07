/**
 * Operating costs across fuel, service, and other expenses.
 * Pure functions over arrays of records; all money in cents.
 */
import { docTotals } from './totals.js';

export const COST_KINDS = [
  { id: 'fuel', label: 'Fuel' },
  { id: 'service', label: 'Service' },
  { id: 'other', label: 'Other' },
];

/** Every cost as { vehicleId, date, kind, amount, type } */
export function costLines({ fuel = [], serviceEntries = [], expenses = [] }) {
  const out = [];
  for (const f of fuel) out.push({ vehicleId: f.vehicleId, date: f.date, kind: 'fuel', amount: Number(f.total) || 0, type: f.kind === 'charge' ? 'Charging' : 'Fuel' });
  for (const s of serviceEntries) out.push({ vehicleId: s.vehicleId, date: s.date, kind: 'service', amount: docTotals(s).total, type: 'Service' });
  for (const e of expenses) out.push({ vehicleId: e.vehicleId, date: e.date, kind: 'other', amount: Number(e.amount) || 0, type: e.type || 'Other' });
  return out;
}

const inRange = (d, from, to) => d && (!from || d >= from) && (!to || d <= to);

/** Monthly totals per kind for the given month keys ("2026-10"). */
export function monthlyCosts(lines, months, { vehicleIds = null } = {}) {
  const idx = new Map(months.map((m, i) => [m, i]));
  const series = Object.fromEntries(COST_KINDS.map((k) => [k.id, months.map(() => 0)]));
  for (const l of lines) {
    if (vehicleIds && !vehicleIds.has(l.vehicleId)) continue;
    const i = idx.get(String(l.date).slice(0, 7));
    if (i === undefined) continue;
    series[l.kind][i] += l.amount;
  }
  return series;
}

/** Totals per vehicle over a date range: Map(vehicleId -> { fuel, service, other, total }) */
export function costsByVehicle(lines, from, to) {
  const out = new Map();
  for (const l of lines) {
    if (!inRange(l.date, from, to)) continue;
    let row = out.get(l.vehicleId);
    if (!row) out.set(l.vehicleId, (row = { fuel: 0, service: 0, other: 0, total: 0 }));
    row[l.kind] += l.amount;
    row.total += l.amount;
  }
  return out;
}

export function sumBy(lines, from, to, kind = null) {
  let s = 0;
  for (const l of lines) if ((!kind || l.kind === kind) && inRange(l.date, from, to)) s += l.amount;
  return s;
}

/**
 * Meter usage per vehicle over a range, from readings:
 * Map(vehicleId -> distance) using the lowest and highest readings in range
 * plus the last reading before it.
 */
export function usageByVehicle(readings, from, to) {
  const groups = new Map();
  for (const r of readings) {
    if (r.void || r.value === null || r.value === undefined || r.value === '') continue;
    if (!groups.has(r.vehicleId)) groups.set(r.vehicleId, []);
    groups.get(r.vehicleId).push(r);
  }
  const out = new Map();
  for (const [vid, list] of groups) {
    let start = null;
    let end = null;
    let before = null;
    for (const r of list) {
      const v = Number(r.value);
      if (from && r.date < from) {
        if (before === null || v > before) before = v;
      } else if (inRange(r.date, from, to)) {
        if (start === null || v < start) start = v;
        if (end === null || v > end) end = v;
      }
    }
    const base = before ?? start;
    if (base !== null && end !== null && end > base) out.set(vid, end - base);
  }
  return out;
}
