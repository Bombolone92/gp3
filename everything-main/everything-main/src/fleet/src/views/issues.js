import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { app, lookup, canEdit } from '../app.js';
import { vehicleName, contactName } from '../core/format.js';
import { formatDate, relativeDays } from '../core/dates.js';
import { ISSUE_PRIORITIES, issueOverdue, priorityRank, statusMeta } from '../core/status.js';
import { statusPill, pill } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { vehicleCell, contactCell, options, dash } from './common.js';

export function render(ctx) {
  const store = app.store;
  const today = app.today();
  const editable = canEdit('issues');
  const late = (i) => issueOverdue(i, today, lookup.vehicle(i.vehicleId));
  return renderList(ctx, {
    key: 'issues',
    title: 'Issues',
    coll: 'issues',
    watch: ['vehicles', 'contacts'],
    csvName: 'issues',
    actions: editable ? [h('a.btn.primary', { href: '#/issues/new' }, icon('plus', 16), 'Add issue')] : [],
    tabs: [
      { id: 'open', label: 'Open', filter: (i) => i.status === 'open' },
      { id: 'overdue', label: 'Overdue', dot: 'red', filter: (i) => late(i) },
      { id: 'resolved', label: 'Resolved', filter: (i) => i.status === 'resolved' },
      { id: 'closed', label: 'Closed', filter: (i) => i.status === 'closed' },
      { id: 'all', label: 'All' },
    ],
    filters: [
      fieldFilter('vehicle', 'Vehicle', 'vehicleId', options.vehicles({ includeArchived: true })),
      fieldFilter('priority', 'Priority', 'priority', () => ISSUE_PRIORITIES.map((p) => ({ value: p.id, label: p.label, dot: p.tone }))),
      fieldFilter('assignee', 'Assigned to', (i) => i.assigneeId || '', () => [{ value: '', label: 'Unassigned' }, ...options.contacts()()]),
      fieldFilter('group', 'Vehicle group', (i) => lookup.vehicle(i.vehicleId)?.groupId || '', () => (app.settings().groups || []).map((g) => ({ value: g.id, label: g.name }))),
      fieldFilter('source', 'Source', (i) => i.source?.type || 'manual', () => [
        { value: 'manual', label: 'Reported' },
        { value: 'inspection', label: 'Inspection' },
      ]),
    ],
    defaultSort: { id: 'priority', dir: 'desc' },
    search: (i) => [`#${i.number}`, i.summary, i.description, vehicleName(lookup.vehicle(i.vehicleId)), i.reportedBy, ...(i.labels || [])].join(' '),
    rowHref: (i) => `#/issues/${i.id}`,
    columns: [
      { id: 'priority', label: 'Priority', render: (i) => statusPill('priority', i.priority), sort: (i) => priorityRank(i.priority) * 1e8 + (1e8 - Number(i.number || 0)), csv: (i) => statusMeta('priority', i.priority).label },
      { id: 'issue', label: 'Issue', fixed: true, render: (i) => h('span.cell-text', h('span.cell-title', h('span.subtle', `#${i.number} `), i.summary), i.description ? h('span.cell-sub.max-40', i.description) : null), sort: (i) => Number(i.number), csv: (i) => `#${i.number} ${i.summary}` },
      { id: 'vehicle', label: 'Vehicle', render: (i) => vehicleCell(i.vehicleId, { sub: false }), sort: (i) => vehicleName(lookup.vehicle(i.vehicleId)), csv: (i) => vehicleName(lookup.vehicle(i.vehicleId)) },
      { id: 'status', label: 'Status', render: (i) => (late(i) ? pill('Overdue', 'red') : statusPill('issue', i.status)), sort: (i) => (late(i) ? 'a' : i.status), csv: (i) => i.status },
      { id: 'reported', label: 'Reported', render: (i) => h('span', formatDate(i.reportedDate), h('span.cell-sub', i.reportedBy || '')), sort: (i) => i.reportedDate },
      { id: 'assignee', label: 'Assigned to', render: (i) => (i.assigneeId ? contactCell(i.assigneeId) : dash()), sort: (i) => contactName(lookup.contact(i.assigneeId)) },
      { id: 'due', label: 'Due', render: (i) => (i.dueDate ? h('span', formatDate(i.dueDate), i.status === 'open' ? h('span.cell-sub', relativeDays(i.dueDate, today)) : null) : dash()), sort: (i) => i.dueDate || '' },
      { id: 'source', label: 'Source', render: (i) => (i.source?.type === 'inspection' ? h('a', { href: `#/inspections/${i.source.id}` }, 'Inspection') : h('span.subtle', 'Reported')), sort: (i) => i.source?.type || '' },
      { id: 'labels', label: 'Labels', hidden: true, render: (i) => h('span.cell-labels', (i.labels || []).map((l) => h('span.mini-tag', l))), sort: (i) => (i.labels || []).join(',') },
    ],
    mobile: (i) => h('div.grow', h('div.row', h('strong.grow.truncate', `#${i.number} ${i.summary}`), statusPill('priority', i.priority)), h('div.subtle.truncate', `${vehicleName(lookup.vehicle(i.vehicleId))} · ${relativeDays(i.reportedDate, today)}`)),
    bulk: editable
      ? [
          { label: 'Resolve', icon: 'circle-check', run: (rows) => setStatus(rows, 'resolved') },
          { label: 'Close', icon: 'circle-x', run: (rows) => setStatus(rows, 'closed') },
          {
            label: 'Assign',
            icon: 'user-check',
            run: (rows, btn) =>
              new Promise((resolve) => {
                openMenu(btn, [{ label: 'Unassigned', run: () => apply(null) }, ...options.contacts()().map((c) => ({ label: c.label, run: () => apply(c.value) }))], { label: 'Assign to' });
                function apply(cid) {
                  for (const i of rows) store.patch('issues', i.id, { assigneeId: cid });
                  toast(`${rows.length} issue${rows.length === 1 ? '' : 's'} assigned`);
                  resolve(true);
                }
              }),
          },
        ]
      : null,
    empty: { icon: 'warning', title: 'No issues reported', text: 'Issues capture problems drivers and inspections find, so nothing slips through the cracks.', action: () => h('a.btn.primary', { href: '#/issues/new' }, icon('plus', 16), 'Add issue') },
  });

  function setStatus(rows, status) {
    const date = app.today();
    // Issues already resolved or closed keep how and when that happened.
    const open = rows.filter((i) => store.get('issues', i.id)?.status === 'open');
    for (const i of open) store.patch('issues', i.id, { status, resolvedAt: date, resolution: status === 'resolved' ? { type: 'note', note: '', date } : null });
    toast(`${open.length} issue${open.length === 1 ? '' : 's'} ${status}`);
  }
}
