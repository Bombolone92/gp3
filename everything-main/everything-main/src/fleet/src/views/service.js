import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { app, lookup, canEdit } from '../app.js';
import { vehicleName } from '../core/format.js';
import { formatDate } from '../core/dates.js';
import { docTotals } from '../core/totals.js';
import { REPAIR_CLASSES, statusMeta } from '../core/status.js';
import { statusPill } from '../ui/components.js';
import { vehicleCell, vendorCell, money, options, meterText, dash } from './common.js';

export function render(ctx) {
  const store = app.store;
  const tasksOf = (e) => (e.lineItems || []).map((li) => lookup.taskName(li.taskId) || li.description).filter(Boolean);
  const editable = canEdit('serviceEntries');
  return renderList(ctx, {
    key: 'service',
    title: 'Service history',
    coll: 'serviceEntries',
    watch: ['vehicles', 'vendors', 'serviceTasks', 'workOrders'],
    csvName: 'service-history',
    actions: editable ? [h('a.btn.primary', { href: '#/service/new' }, icon('plus', 16), 'Add service entry')] : [],
    filters: [
      fieldFilter('vehicle', 'Vehicle', 'vehicleId', options.vehicles({ includeArchived: true })),
      fieldFilter('vendor', 'Vendor', (e) => e.vendorId || '', () => [{ value: '', label: 'In-house' }, ...options.vendors()()]),
      { id: 'task', label: 'Service task', options: options.tasks(), match: (e, vals) => (e.lineItems || []).some((li) => vals.has(String(li.taskId))) },
      fieldFilter('class', 'Repair class', 'repairClass', () => REPAIR_CLASSES.map((c) => ({ value: c.id, label: c.label }))),
      fieldFilter('group', 'Vehicle group', (e) => lookup.vehicle(e.vehicleId)?.groupId || '', () => (app.settings().groups || []).map((g) => ({ value: g.id, label: g.name }))),
    ],
    defaultSort: { id: 'date', dir: 'desc' },
    search: (e) => [vehicleName(lookup.vehicle(e.vehicleId)), ...tasksOf(e), e.reference, e.notes, lookup.vendorName(e.vendorId)].join(' '),
    rowHref: (e) => `#/service/${e.id}`,
    summary: (rows) => {
      const t = rows.reduce((a, e) => {
        const x = docTotals(e);
        return { labor: a.labor + x.labor, parts: a.parts + x.parts, total: a.total + x.total };
      }, { labor: 0, parts: 0, total: 0 });
      return h('div.summary-stats', stat('Entries', rows.length), stat('Labor', money(t.labor)), stat('Parts', money(t.parts)), stat('Total', money(t.total)));
    },
    columns: [
      { id: 'vehicle', label: 'Vehicle', render: (e) => vehicleCell(e.vehicleId, { sub: false }), sort: (e) => vehicleName(lookup.vehicle(e.vehicleId)), csv: (e) => vehicleName(lookup.vehicle(e.vehicleId)) },
      { id: 'date', label: 'Completed', render: (e) => formatDate(e.date), sort: (e) => e.date },
      { id: 'meter', label: 'Meter', align: 'r', render: (e) => (e.meter != null ? h('span.num', meterText(e.meter, lookup.vehicle(e.vehicleId))) : dash()), sort: (e) => (e.meter == null ? null : Number(e.meter)) },
      { id: 'tasks', label: 'Service tasks', render: (e) => { const t = tasksOf(e); return t.length ? h('span', h('span.truncate', t[0]), t.length > 1 ? h('span.subtle', ` +${t.length - 1} more`) : null) : dash(); }, sort: (e) => tasksOf(e).join(', '), csv: (e) => tasksOf(e).join('; ') },
      { id: 'vendor', label: 'Vendor', render: (e) => (e.vendorId ? vendorCell(e.vendorId) : h('span.subtle', 'In-house')), sort: (e) => lookup.vendorName(e.vendorId) },
      { id: 'class', label: 'Repair class', render: (e) => statusPill('repair', e.repairClass), sort: (e) => e.repairClass, csv: (e) => statusMeta('repair', e.repairClass).label },
      { id: 'wo', label: 'Work order', render: (e) => (store.get('workOrders', e.workOrderId) ? h('a', { href: `#/work-orders/${e.workOrderId}` }, `#${store.get('workOrders', e.workOrderId).number}`) : dash()), sort: (e) => store.get('workOrders', e.workOrderId)?.number || 0 },
      { id: 'reference', label: 'Reference', hidden: true, render: (e) => e.reference || dash(), sort: (e) => e.reference || '' },
      { id: 'total', label: 'Total', align: 'r', render: (e) => h('span.money', money(docTotals(e).total)), sort: (e) => docTotals(e).total, csv: (e) => (docTotals(e).total / 100).toFixed(2) },
    ],
    mobile: (e) => h('div.grow', h('div.row', h('strong.grow.truncate', vehicleName(lookup.vehicle(e.vehicleId))), h('span.money', money(docTotals(e).total))), h('div.subtle.truncate', `${formatDate(e.date)} · ${tasksOf(e).join(', ')}`)),
    empty: { icon: 'wrench', title: 'No service recorded', text: 'Log maintenance and repairs to keep a complete history and see what each vehicle costs to maintain.', action: () => h('a.btn.primary', { href: '#/service/new' }, icon('plus', 16), 'Add service entry') },
  });
}

/** A summary figure; the value may be text, a number, or a node (a unit in <small>). */
export function stat(label, value) {
  return h('div.summary-stat', h('span.label', label), h('span.value', value instanceof Node ? value : String(value)));
}
