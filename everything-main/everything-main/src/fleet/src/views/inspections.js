import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { app, lookup, canEdit } from '../app.js';
import { vehicleName, formatDuration } from '../core/format.js';
import { formatDate, formatTime, addDays } from '../core/dates.js';
import { pill } from '../ui/components.js';
import { vehicleCell, options, dash } from './common.js';

export function render(ctx) {
  const store = app.store;
  const today = app.today();
  const dur = (s) => (s.startedAt && s.submittedAt ? (new Date(s.submittedAt) - new Date(s.startedAt)) / 1000 : null);
  return renderList(ctx, {
    key: 'inspections',
    title: 'Inspection history',
    coll: 'inspections',
    watch: ['vehicles', 'inspectionForms'],
    csvName: 'inspections',
    actions: [h('a.btn', { href: '#/inspection-forms' }, icon('clipboard', 15), 'Forms'), canEdit('inspections') ? h('a.btn.primary', { href: '#/inspections/start' }, icon('clipboard-check', 16), 'Start inspection') : null],
    tabs: [
      { id: 'all', label: 'All' },
      { id: 'failed', label: 'With failures', dot: 'red', filter: (s) => s.failed > 0 },
      { id: 'week', label: 'Last 7 days', filter: (s) => s.date >= addDays(today, -6) },
    ],
    filters: [
      fieldFilter('vehicle', 'Vehicle', 'vehicleId', options.vehicles({ includeArchived: true })),
      fieldFilter('form', 'Form', 'formId', () => store.all('inspectionForms').map((f) => ({ value: f.id, label: f.name }))),
      fieldFilter('by', 'Inspector', (s) => s.by || '', () => [...new Set(store.all('inspections').map((s) => s.by).filter(Boolean))].sort().map((b) => ({ value: b, label: b }))),
      fieldFilter('group', 'Vehicle group', (s) => lookup.vehicle(s.vehicleId)?.groupId || '', () => (app.settings().groups || []).map((g) => ({ value: g.id, label: g.name }))),
    ],
    defaultSort: { id: 'submitted', dir: 'desc' },
    search: (s) => [vehicleName(lookup.vehicle(s.vehicleId)), s.formName, s.by, ...(s.results || []).filter((r) => r.pass === false).map((r) => r.label)].join(' '),
    rowHref: (s) => `#/inspections/${s.id}`,
    columns: [
      { id: 'vehicle', label: 'Vehicle', render: (s) => vehicleCell(s.vehicleId, { sub: false }), sort: (s) => vehicleName(lookup.vehicle(s.vehicleId)), csv: (s) => vehicleName(lookup.vehicle(s.vehicleId)) },
      { id: 'submitted', label: 'Submitted', render: (s) => h('span', formatDate(s.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }), s.submittedAt ? h('span.cell-sub', formatTime(new Date(s.submittedAt).toTimeString().slice(0, 5))) : null), sort: (s) => s.submittedAt || s.date, csv: (s) => s.submittedAt || s.date },
      { id: 'form', label: 'Form', render: (s) => s.formName, sort: (s) => s.formName },
      { id: 'by', label: 'Inspector', render: (s) => s.by || dash(), sort: (s) => s.by || '' },
      { id: 'duration', label: 'Duration', render: (s) => (dur(s) ? formatDuration(dur(s)) : dash()), sort: dur },
      { id: 'failed', label: 'Failed items', render: (s) => (s.failed ? h('span.cell-text', pill(`${s.failed} failed`, 'red'), h('span.cell-sub.max-30', (s.results || []).filter((r) => r.pass === false).map((r) => r.label).join(', '))) : pill('Passed', 'green')), sort: (s) => s.failed || 0 },
    ],
    mobile: (s) => h('div.grow', h('div.row', h('strong.grow.truncate', vehicleName(lookup.vehicle(s.vehicleId))), s.failed ? pill(`${s.failed} failed`, 'red') : pill('Passed', 'green')), h('div.subtle.truncate', `${formatDate(s.date)} · ${s.formName}${s.by ? ` · ${s.by}` : ''}`)),
    empty: { icon: 'clipboard-check', title: 'No inspections yet', text: 'Drivers can run a pre-trip inspection from a phone in a couple of minutes. Failed items become issues automatically.', action: () => h('a.btn.primary', { href: '#/inspections/start' }, icon('clipboard-check', 16), 'Start inspection') },
  });
}
