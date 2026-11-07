import { h } from '../ui/dom.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { app, lookup } from '../app.js';
import { vehicleName } from '../core/format.js';
import { formatDate } from '../core/dates.js';
import { statusPill, pill } from '../ui/components.js';
import { vehicleCell, options, dash } from './common.js';

export function render(ctx) {
  const store = app.store;
  let cacheKey = null;
  let rowsCache = [];
  const rows = () => {
    const subs = store.all('inspections');
    const issues = store.all('issues');
    if (cacheKey && cacheKey[0] === subs && cacheKey[1] === issues) return rowsCache;
    const out = [];
    for (const s of subs) {
      for (const r of s.results || []) {
        if (r.pass !== false) continue;
        const issue = (s.issueIds || []).map((id) => store.get('issues', id)).find((i) => i?.source?.itemId === r.itemId) || null;
        out.push({ id: `${s.id}:${r.itemId}`, sub: s, r, issue, vehicleId: s.vehicleId, date: s.date });
      }
    }
    cacheKey = [subs, issues];
    rowsCache = out;
    return out;
  };
  const needsAction = (x) => !x.issue || x.issue.status === 'open';
  return renderList(ctx, {
    key: 'failures',
    title: 'Inspection item failures',
    intro: 'Every item that failed an inspection, and whether its issue has been fixed.',
    rows,
    watch: ['inspections', 'issues', 'vehicles'],
    csvName: 'inspection-failures',
    tabs: [
      { id: 'open', label: 'Needs action', dot: 'red', filter: needsAction },
      { id: 'resolved', label: 'Resolved', filter: (x) => !needsAction(x) },
      { id: 'all', label: 'All' },
    ],
    filters: [fieldFilter('vehicle', 'Vehicle', 'vehicleId', options.vehicles({ includeArchived: true })), fieldFilter('item', 'Item', (x) => x.r.label, () => [...new Set(rows().map((x) => x.r.label))].sort().map((l) => ({ value: l, label: l })))],
    defaultSort: { id: 'date', dir: 'desc' },
    search: (x) => [vehicleName(lookup.vehicle(x.vehicleId)), x.r.label, x.r.note, x.sub.by].join(' '),
    rowHref: (x) => `#/inspections/${x.sub.id}`,
    columns: [
      { id: 'item', label: 'Failed item', render: (x) => h('span.cell-text', h('span.cell-title', x.r.label), x.r.note ? h('span.cell-sub', x.r.note) : null), sort: (x) => x.r.label, csv: (x) => x.r.label },
      { id: 'vehicle', label: 'Vehicle', render: (x) => vehicleCell(x.vehicleId, { sub: false }), sort: (x) => vehicleName(lookup.vehicle(x.vehicleId)), csv: (x) => vehicleName(lookup.vehicle(x.vehicleId)) },
      { id: 'date', label: 'Inspected', render: (x) => formatDate(x.date), sort: (x) => x.sub.submittedAt || x.date },
      { id: 'by', label: 'Inspector', render: (x) => x.sub.by || dash(), sort: (x) => x.sub.by || '' },
      { id: 'issue', label: 'Issue', render: (x) => (x.issue ? h('a.row.gap-4', { href: `#/issues/${x.issue.id}` }, `#${x.issue.number}`, statusPill('issue', x.issue.status)) : pill('No issue', 'gray')), sort: (x) => x.issue?.status || '' },
    ],
    mobile: (x) => h('div.grow', h('strong', x.r.label), h('div.subtle', `${vehicleName(lookup.vehicle(x.vehicleId))} · ${formatDate(x.date)}`)),
    empty: { icon: 'circle-check', title: 'No failed items', text: 'When an inspection item fails, it shows here until its issue is resolved.' },
  });
}
