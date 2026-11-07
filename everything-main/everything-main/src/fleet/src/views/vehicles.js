import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { app, lookup, canEdit } from '../app.js';
import { vehicleName, contactName, formatNumber } from '../core/format.js';
import { vehicleStatusMeta, OWNERSHIP } from '../core/status.js';
import { vehicleCell, vehicleStatusPill, meterText, contactCell, dash, vehicleThumb, operatorOf, archiveBulk } from './common.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { importVehicles } from './importers.js';

export function render(ctx) {
  const store = app.store;
  const settings = () => app.settings();
  const openIssues = () => {
    const m = new Map();
    for (const i of store.all('issues')) if (i.status === 'open') m.set(i.vehicleId, (m.get(i.vehicleId) || 0) + 1);
    return m;
  };
  let issueCounts = openIssues();
  ctx.onDispose(store.subscribe((c) => c.has('issues') && (issueCounts = openIssues())));

  const editable = canEdit('vehicles');
  const list = renderList(ctx, {
    key: 'vehicles',
    title: 'Vehicles',
    coll: 'vehicles',
    watch: ['contacts', 'issues', 'assignments'],
    csvName: 'vehicles',
    actions: editable ? [h('a.btn.primary', { href: '#/vehicles/new' }, icon('plus', 16), 'Add vehicle')] : [],
    more: editable ? [{ label: 'Import from CSV', icon: 'upload', run: () => importVehicles() }] : [],
    tabs: [
      { id: 'all', label: 'All', filter: (v) => !v.archived },
      { id: 'assigned', label: 'Assigned', filter: (v) => !v.archived && operatorOf(v) },
      { id: 'unassigned', label: 'Unassigned', filter: (v) => !v.archived && !operatorOf(v) },
      { id: 'archived', label: 'Archived', filter: (v) => v.archived },
    ],
    filters: [
      fieldFilter('type', 'Type', 'type', () => settings().vehicleTypes.map((t) => ({ value: t, label: t }))),
      fieldFilter('status', 'Status', 'status', () => settings().vehicleStatuses.map((s) => ({ value: s.id, label: s.label, dot: s.color }))),
      fieldFilter('group', 'Group', 'groupId', () => (settings().groups || []).map((g) => ({ value: g.id, label: g.name }))),
      fieldFilter('fuel', 'Fuel type', 'fuelType', () => settings().fuelTypes.map((t) => ({ value: t, label: t }))),
      {
        id: 'label',
        label: 'Labels',
        options: () => [...new Set(store.all('vehicles').flatMap((v) => v.labels || []))].sort().map((l) => ({ value: l, label: l })),
        match: (v, vals) => (v.labels || []).some((l) => vals.has(l)),
      },
    ],
    defaultSort: { id: 'name', dir: 'asc' },
    search: (v) => [vehicleName(v), v.vin, v.plate, v.make, v.model, v.year, v.type, ...(v.labels || []), contactName(lookup.contact(operatorOf(v)))].join(' '),
    rowHref: (v) => `#/vehicles/${v.id}`,
    columns: [
      { id: 'name', label: 'Name', fixed: true, render: (v) => h('span.cell-vehicle', vehicleThumb(v, 'sm'), h('span.cell-text', h('span.cell-title', vehicleName(v)), (v.labels || []).length ? h('span.cell-labels', v.labels.map((l) => h('span.mini-tag', l))) : null)), sort: (v) => vehicleName(v) },
      { id: 'year', label: 'Year', render: (v) => v.year || dash(), sort: (v) => Number(v.year) || null },
      { id: 'make', label: 'Make', render: (v) => v.make || dash(), sort: (v) => v.make || '' },
      { id: 'model', label: 'Model', render: (v) => v.model || dash(), sort: (v) => v.model || '' },
      { id: 'vin', label: 'VIN/SN', cls: 'mono', render: (v) => v.vin || dash(), sort: (v) => v.vin || '' },
      { id: 'status', label: 'Status', render: (v) => vehicleStatusPill(v.status, { dot: true }), sort: (v) => vehicleStatusMeta(settings(), v.status).label, csv: (v) => vehicleStatusMeta(settings(), v.status).label },
      { id: 'type', label: 'Type', render: (v) => v.type || dash(), sort: (v) => v.type || '' },
      { id: 'group', label: 'Group', render: (v) => lookup.groupName(v.groupId) || dash(), sort: (v) => lookup.groupName(v.groupId) },
      { id: 'meter', label: 'Current meter', align: 'r', render: (v) => (v.meter != null ? h('span.num', meterText(v.meter, v)) : dash()), sort: (v) => (v.meter == null ? null : Number(v.meter)) },
      { id: 'plate', label: 'License plate', render: (v) => v.plate || dash(), sort: (v) => v.plate || '' },
      { id: 'operator', label: 'Operator', render: (v) => (operatorOf(v) ? contactCell(operatorOf(v)) : h('span.subtle', 'Unassigned')), sort: (v) => contactName(lookup.contact(operatorOf(v))) },
      { id: 'issues', label: 'Open issues', align: 'r', render: (v) => (issueCounts.get(v.id) ? h('a.count-link', { href: `#/issues?f_vehicle=${v.id}` }, String(issueCounts.get(v.id))) : dash()), sort: (v) => issueCounts.get(v.id) || 0 },
      { id: 'fuelType', label: 'Fuel type', hidden: true, render: (v) => v.fuelType || dash(), sort: (v) => v.fuelType || '' },
      { id: 'ownership', label: 'Ownership', hidden: true, render: (v) => OWNERSHIP.find((o) => o.id === v.ownership)?.label || dash(), sort: (v) => v.ownership || '', csv: (v) => OWNERSHIP.find((o) => o.id === v.ownership)?.label || '' },
      { id: 'color', label: 'Color', hidden: true, render: (v) => v.color || dash(), sort: (v) => v.color || '' },
      { id: 'registration', label: 'Registration', hidden: true, render: (v) => v.registrationState || dash(), sort: (v) => v.registrationState || '' },
    ],
    mobile: (v) =>
      h(
        'div.vehicle-card',
        vehicleThumb(v, 'md'),
        h('div.grow', h('div.row', h('strong.truncate.grow', vehicleName(v)), vehicleStatusPill(v.status, { dot: true })), h('div.subtle.truncate', [v.year, v.make, v.model].filter(Boolean).join(' ')), h('div.subtle.truncate', [meterText(v.meter, v), operatorOf(v) ? contactName(lookup.contact(operatorOf(v))) : 'Unassigned'].filter(Boolean).join(' · '))),
      ),
    bulk: editable
      ? [
          { label: 'Change status', icon: 'circle-dot', run: (rows, btn) => bulkSet(rows, 'status', 'status', btn) },
          { label: 'Change group', icon: 'layers', run: (rows, btn) => bulkSet(rows, 'groupId', 'group', btn) },
          archiveBulk('vehicles', 'vehicle'),
        ]
      : null,
    empty: {
      icon: 'truck',
      title: 'Add your first vehicle',
      text: 'Vehicles are at the center of everything: inspections, issues, service, fuel, and costs all attach to one.',
      action: editable ? () => h('a.btn.primary', { href: '#/vehicles/new' }, icon('plus', 16), 'Add vehicle') : null,
    },
  });

  function bulkSet(rows, field, kind, btn) {
    return new Promise((resolve) => {
      const items =
        kind === 'status'
          ? settings().vehicleStatuses.map((s) => ({ label: s.label, run: () => apply(s.id, s.label) }))
          : [{ label: 'No group', run: () => apply(null, 'No group') }, ...(settings().groups || []).map((g) => ({ label: g.name, run: () => apply(g.id, g.name) }))];
      function apply(value, label) {
        for (const v of rows) store.patch('vehicles', v.id, { [field]: value });
        toast(`${rows.length} vehicle${rows.length === 1 ? '' : 's'} set to ${label}`);
        resolve(true);
      }
      openMenu(btn, items, { label: kind === 'status' ? 'Set status' : 'Set group' });
    });
  }

  return list;
}

export async function confirmArchive(v) {
  return confirmDialog({
    title: v.archived ? 'Restore vehicle?' : 'Archive vehicle?',
    message: v.archived ? `${vehicleName(v)} will show in lists and reminders again.` : `${vehicleName(v)} will be hidden from lists, reminders, and the dashboard. Its history is kept.`,
    confirmLabel: v.archived ? 'Restore' : 'Archive',
  });
}

export { formatNumber };
