/** The standard reports: what each shows and how its table looks. */
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { vehicleName, formatDecimal, formatEconomy, METER_UNITS } from '../core/format.js';
import { formatDate } from '../core/dates.js';
import * as R from '../core/reports.js';
import { money, vehicleCell, meterText, dash } from './common.js';

const vcol = { id: 'vehicle', label: 'Vehicle', render: (r) => vehicleCell(r.vehicle, { sub: false }), sort: (r) => vehicleName(r.vehicle), csv: (r) => vehicleName(r.vehicle) };
const m = (id, label, get) => ({ id, label, align: 'r', render: (r) => h('span.money', money(get(r))), sort: get, csv: (r) => (get(r) / 100).toFixed(2) });
const n = (id, label, get, fmt = (x) => formatDecimal(x, 0)) => ({ id, label, align: 'r', render: (r) => (get(r) == null ? dash() : h('span.num', fmt(get(r)))), sort: get, csv: get });
const pct = (id, label, get) => n(id, label, get, (x) => `${formatDecimal(x * 100, 0)}%`);
const dist = () => app.settings().units.distance;
// Vehicles have their own meter (miles, kilometers or hours), so usage and
// cost per meter carry the vehicle's unit.
const usageCol = (id, label, get) => ({ id, label, align: 'r', render: (r) => (get(r) == null ? dash() : h('span.num', meterText(get(r), r.vehicle))), sort: get, csv: get });
const KM_PER_MI = 1.609344;
const inFleetUnit = (n, v) => {
  const from = v?.meterUnit || dist();
  const to = dist();
  return from === to ? n : from === 'km' && to === 'mi' ? n / KM_PER_MI : from === 'mi' && to === 'km' ? n * KM_PER_MI : n;
};
const perUnit = (cents, v) => `${money(cents)}/${METER_UNITS[v?.meterUnit || dist()]?.short || v?.meterUnit || dist()}`;

export const GROUPS = [
  { title: 'Costs', items: ['costs', 'tco', 'expenses'] },
  { title: 'Fuel and usage', items: ['fuel', 'utilization'] },
  { title: 'Maintenance', items: ['service', 'tasks', 'compliance'] },
  { title: 'Inspections and issues', items: ['inspections', 'issues'] },
  { title: 'Inventory', items: ['inventory'] },
];

export const REPORTS = {
  costs: {
    title: 'Operating costs',
    icon: 'cash',
    description: 'Fuel, service, and other costs per vehicle, with cost per mile or kilometer.',
    run: (d, range) => R.costReport(d, range),
    columns: () => [vcol, m('fuel', 'Fuel', (r) => r.fuel), m('service', 'Service', (r) => r.service), m('other', 'Other', (r) => r.other), m('total', 'Total', (r) => r.total), usageCol('distance', 'Usage', (r) => r.distance || null), { id: 'cpm', label: 'Cost per meter', align: 'r', render: (r) => (r.costPerMeter != null ? h('span.money', perUnit(r.costPerMeter, r.vehicle)) : dash()), sort: (r) => r.costPerMeter, csv: (r) => (r.costPerMeter != null ? (r.costPerMeter / 100).toFixed(2) : '') }],
    totals: (rows) => [['Total cost', money(rows.reduce((a, r) => a + r.total, 0))], ['Fuel', money(rows.reduce((a, r) => a + r.fuel, 0))], ['Service', money(rows.reduce((a, r) => a + r.service, 0))], ['Other', money(rows.reduce((a, r) => a + r.other, 0))]],
    chart: (rows) => rows.filter((r) => r.total).sort((a, b) => b.total - a.total).slice(0, 10).map((r) => ({ label: vehicleName(r.vehicle), value: r.total })),
    sort: { id: 'total', dir: 'desc' },
  },
  tco: {
    title: 'Total cost of ownership',
    icon: 'calculator',
    description: 'Purchase price plus every cost since, minus estimated resale value. Covers the whole life of each vehicle.',
    lifetime: true,
    run: (d) => R.tcoReport(d),
    columns: () => [vcol, m('purchase', 'Purchase', (r) => r.purchase), m('operating', 'Operating costs', (r) => r.operating), m('resale', 'Resale value', (r) => r.resale), m('total', 'Net cost', (r) => r.total), usageCol('driven', 'Driven', (r) => r.driven), { id: 'cpm', label: 'Cost per meter', align: 'r', render: (r) => (r.costPerMeter != null ? h('span.money', perUnit(r.costPerMeter, r.vehicle)) : dash()), sort: (r) => r.costPerMeter, csv: (r) => (r.costPerMeter != null ? (r.costPerMeter / 100).toFixed(2) : '') }],
    totals: (rows) => [['Net cost', money(rows.reduce((a, r) => a + r.total, 0))], ['Operating', money(rows.reduce((a, r) => a + r.operating, 0))]],
    sort: { id: 'total', dir: 'desc' },
  },
  expenses: {
    title: 'Expenses by type',
    icon: 'receipt',
    description: 'Insurance, registration, tolls, and other expenses grouped by type.',
    run: (d, range) => R.expenseReport(d, range),
    columns: () => [{ id: 'type', label: 'Type', render: (r) => r.type, sort: (r) => r.type, csv: (r) => r.type }, n('count', 'Entries', (r) => r.count), n('vehicles', 'Vehicles', (r) => r.vehicles), m('total', 'Total', (r) => r.total)],
    totals: (rows) => [['Total', money(rows.reduce((a, r) => a + r.total, 0))], ['Entries', String(rows.reduce((a, r) => a + r.count, 0))]],
    chart: (rows) => rows.sort((a, b) => b.total - a.total).map((r) => ({ label: r.type, value: r.total })),
    sort: { id: 'total', dir: 'desc' },
  },
  fuel: {
    title: 'Fuel summary',
    icon: 'fuel',
    description: 'Fuel and energy by vehicle: volume, spend, average price, and economy.',
    run: (d, range) => R.fuelReport(d, range, app.settings().units.volume),
    columns: () => [vcol, n('entries', 'Fill-ups', (r) => r.entries), { id: 'volume', label: 'Volume', align: 'r', render: (r) => (r.volume ? h('span.num', `${formatDecimal(r.volume, 1)} ${r.unit}`) : dash()), sort: (r) => r.volume || null, csv: (r) => r.volume || '' }, m('cost', 'Cost', (r) => r.cost), { id: 'price', label: 'Average price', align: 'r', render: (r) => (r.avgPrice ? `${money(Math.round(r.avgPrice * 100))}/${r.unit}` : dash()), sort: (r) => r.avgPrice, csv: (r) => r.avgPrice?.toFixed(3) ?? '' }, { id: 'economy', label: 'Economy', align: 'r', render: (r) => (r.economy ? formatEconomy(r.economy, r.vehicle.meterUnit || dist(), r.unit) : dash()), sort: (r) => r.economy, csv: (r) => r.economy?.toFixed(2) ?? '' }, { id: 'cpm', label: 'Fuel cost per meter', align: 'r', render: (r) => (r.costPerMeter != null ? h('span.money', perUnit(r.costPerMeter, r.vehicle)) : dash()), sort: (r) => r.costPerMeter, csv: (r) => (r.costPerMeter != null ? (r.costPerMeter / 100).toFixed(2) : '') }],
    totals: (rows) => [['Fuel cost', money(rows.reduce((a, r) => a + r.cost, 0))], ['Fill-ups', String(rows.reduce((a, r) => a + r.entries, 0))]],
    chart: (rows) => rows.filter((r) => r.cost).sort((a, b) => b.cost - a.cost).slice(0, 10).map((r) => ({ label: vehicleName(r.vehicle), value: r.cost })),
    sort: { id: 'cost', dir: 'desc' },
  },
  utilization: {
    title: 'Vehicle utilization',
    icon: 'gauge',
    description: 'How far each vehicle traveled (or how many hours it ran) in the period, from meter readings.',
    run: (d, range) => R.utilizationReport(d, range),
    columns: () => [vcol, { id: 'usage', label: 'Usage', align: 'r', render: (r) => (r.usage ? meterText(r.usage, r.vehicle) : dash()), sort: (r) => r.usage, csv: (r) => r.usage }, { id: 'perDay', label: 'Per day', align: 'r', render: (r) => (r.perDay ? `${formatDecimal(r.perDay, 1)} ${r.vehicle.meterUnit || dist()}` : dash()), sort: (r) => r.perDay, csv: (r) => r.perDay?.toFixed(1) ?? '' }, n('readings', 'Readings', (r) => r.readings)],
    // Bars compare distance in the fleet's unit, so kilometers and miles
    // line up; each still reads in its vehicle's own unit.
    chart: (rows) => rows.filter((r) => r.usage && r.vehicle.meterUnit !== 'hr').map((r) => ({ label: vehicleName(r.vehicle), value: inFleetUnit(r.usage, r.vehicle), text: meterText(r.usage, r.vehicle) })).sort((a, b) => b.value - a.value).slice(0, 10),
    sort: { id: 'usage', dir: 'desc' },
  },
  service: {
    title: 'Service costs by vehicle',
    icon: 'wrench',
    description: 'Maintenance and repair spending per vehicle, split into labor and parts.',
    run: (d, range) => R.serviceReport(d, range),
    columns: () => [vcol, n('entries', 'Service entries', (r) => r.entries), n('unscheduled', 'Unscheduled', (r) => r.unscheduled), m('labor', 'Labor', (r) => r.labor), m('parts', 'Parts', (r) => r.parts), m('total', 'Total', (r) => r.total)],
    totals: (rows) => [['Total', money(rows.reduce((a, r) => a + r.total, 0))], ['Labor', money(rows.reduce((a, r) => a + r.labor, 0))], ['Parts', money(rows.reduce((a, r) => a + r.parts, 0))]],
    chart: (rows) => rows.filter((r) => r.total).sort((a, b) => b.total - a.total).slice(0, 10).map((r) => ({ label: vehicleName(r.vehicle), value: r.total })),
    sort: { id: 'total', dir: 'desc' },
  },
  tasks: {
    title: 'Service by task',
    icon: 'list-checks',
    description: 'Which maintenance and repairs you do most, and what they cost.',
    run: (d, range) => R.taskReport(d, range),
    columns: (lookup) => [{ id: 'name', label: 'Service task', render: (r) => (r.taskId ? lookup.taskName(r.taskId) || 'Deleted task' : r.name), sort: (r) => (r.taskId ? lookup.taskName(r.taskId) : r.name), csv: (r) => (r.taskId ? lookup.taskName(r.taskId) : r.name) }, n('count', 'Times', (r) => r.count), n('vehicles', 'Vehicles', (r) => r.vehicles), m('labor', 'Labor', (r) => r.labor), m('parts', 'Parts', (r) => r.parts), m('total', 'Total', (r) => r.total)],
    sort: { id: 'count', dir: 'desc' },
  },
  compliance: {
    title: 'Maintenance compliance',
    icon: 'shield-check',
    description: 'Reminders overdue or due soon per vehicle today, and how often service was done on time.',
    lifetime: true,
    run: (d, range, today) => R.complianceReport(d, today, app.settings()),
    columns: () => [vcol, n('reminders', 'Reminders', (r) => r.reminders), n('overdue', 'Overdue', (r) => r.overdue), n('dueSoon', 'Due soon', (r) => r.dueSoon), pct('onTime', 'On time', (r) => r.onTime), n('renewals', 'Renewals overdue', (r) => r.renewalsOverdue)],
    totals: (rows) => [['Overdue reminders', String(rows.reduce((a, r) => a + r.overdue, 0))], ['Due soon', String(rows.reduce((a, r) => a + r.dueSoon, 0))]],
    sort: { id: 'overdue', dir: 'desc' },
  },
  inspections: {
    title: 'Inspection summary',
    icon: 'clipboard-check',
    description: 'Inspections per vehicle, failed items, and pass rate. The items that fail most are listed first.',
    run: (d, range) => R.inspectionReport(d, range).byVehicle,
    extra: (d, range) => R.inspectionReport(d, range).topFailures,
    columns: () => [vcol, n('submissions', 'Inspections', (r) => r.submissions), n('withFailures', 'With failures', (r) => r.withFailures), n('failedItems', 'Failed items', (r) => r.failedItems), pct('passRate', 'Item pass rate', (r) => r.passRate), { id: 'last', label: 'Last inspected', render: (r) => (r.last ? formatDate(r.last) : dash()), sort: (r) => r.last || '' }],
    totals: (rows) => [['Inspections', String(rows.reduce((a, r) => a + r.submissions, 0))], ['Failed items', String(rows.reduce((a, r) => a + r.failedItems, 0))]],
    sort: { id: 'submissions', dir: 'desc' },
  },
  issues: {
    title: 'Issues summary',
    icon: 'warning',
    description: 'Issues reported per vehicle, how many are still open, and how long fixes take.',
    run: (d, range) => R.issueReport(d, range),
    columns: () => [vcol, n('reported', 'Reported', (r) => r.reported), n('critical', 'High or critical', (r) => r.critical), n('open', 'Still open', (r) => r.open), n('resolved', 'Resolved', (r) => r.resolved), n('avgDays', 'Days to resolve', (r) => r.avgDays, (x) => formatDecimal(x, 1))],
    totals: (rows) => [['Reported', String(rows.reduce((a, r) => a + r.reported, 0))], ['Still open', String(rows.reduce((a, r) => a + r.open, 0))]],
    sort: { id: 'reported', dir: 'desc' },
  },
  inventory: {
    title: 'Inventory valuation',
    icon: 'boxes',
    description: 'Parts on hand and their value by category, with low stock counts.',
    lifetime: true,
    noVehicles: true,
    run: (d) => R.inventoryReport(d.parts),
    columns: () => [{ id: 'category', label: 'Category', render: (r) => r.category, sort: (r) => r.category, csv: (r) => r.category }, n('parts', 'Parts', (r) => r.parts), n('units', 'Units on hand', (r) => r.units, (x) => formatDecimal(x, 1)), n('low', 'Low stock', (r) => r.low), m('value', 'Value', (r) => r.value)],
    totals: (rows) => [['Inventory value', money(rows.reduce((a, r) => a + r.value, 0))], ['Low stock parts', String(rows.reduce((a, r) => a + r.low, 0))]],
    chart: (rows) => rows.sort((a, b) => b.value - a.value).map((r) => ({ label: r.category, value: r.value })),
    sort: { id: 'value', dir: 'desc' },
  },
};
