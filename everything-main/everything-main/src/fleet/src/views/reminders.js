import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { openFormDialog } from '../ui/form.js';
import { app, lookup, canEdit } from '../app.js';
import { vehicleName } from '../core/format.js';
import { formatDate, addDays } from '../core/dates.js';
import { reminderState, describeSchedule, compliance } from '../core/reminders.js';
import { statusPill } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { vehicleCell, options, dash, meterText, dueText } from './common.js';

const ORDER = { overdue: 0, due_soon: 1, snoozed: 2, upcoming: 3 };

export function render(ctx) {
  const store = app.store;
  const today = app.today();
  const editable = canEdit('reminders');
  const cache = new Map();
  const st = (r) => {
    let x = cache.get(r);
    if (!x) cache.set(r, (x = reminderState(r, lookup.vehicle(r.vehicleId), today, app.settings())));
    return x;
  };
  const activeVehicle = (r) => lookup.vehicle(r.vehicleId) && !lookup.vehicle(r.vehicleId).archived && !r.archived;
  const list = renderList(ctx, {
    key: 'reminders',
    title: 'Service reminders',
    coll: 'reminders',
    watch: ['vehicles', 'serviceTasks', 'meters'],
    csvName: 'service-reminders',
    actions: editable ? [h('a.btn', { href: '#/service-programs' }, icon('layers', 15), 'Service programs'), h('a.btn.primary', { href: '#/reminders/new' }, icon('plus', 16), 'Add reminder')] : [],
    stats: () =>
      ctx.live(() => {
        const rows = store.all('reminders').filter(activeVehicle);
        const over = rows.filter((r) => st(r).status === 'overdue');
        const soon = rows.filter((r) => st(r).status === 'due_soon');
        const hist = rows.flatMap((r) => r.history || []);
        const comp = hist.length ? Math.round((hist.filter((x) => x.onTime).length / hist.length) * 100) : null;
        return h(
          'div.metric-row.card.stat-strip',
          metricBox('Overdue vehicles', new Set(over.map((r) => r.vehicleId)).size, 'red'),
          metricBox('Due soon vehicles', new Set(soon.map((r) => r.vehicleId)).size, 'orange'),
          metricBox('Snoozed', rows.filter((r) => st(r).status === 'snoozed').length),
          metricBox('On-time compliance', comp === null ? '-' : `${comp}%`),
        );
      }, ['reminders', 'vehicles']),
    tabs: [
      { id: 'all', label: 'All', filter: activeVehicle },
      { id: 'due_soon', label: 'Due soon', dot: 'orange', filter: (r) => activeVehicle(r) && st(r).status === 'due_soon' },
      { id: 'overdue', label: 'Overdue', dot: 'red', filter: (r) => activeVehicle(r) && st(r).status === 'overdue' },
      { id: 'snoozed', label: 'Snoozed', filter: (r) => activeVehicle(r) && st(r).status === 'snoozed' },
    ],
    filters: [
      fieldFilter('vehicle', 'Vehicle', 'vehicleId', options.vehicles()),
      fieldFilter('task', 'Service task', 'taskId', options.tasks()),
      fieldFilter('group', 'Vehicle group', (r) => lookup.vehicle(r.vehicleId)?.groupId || '', () => (app.settings().groups || []).map((g) => ({ value: g.id, label: g.name }))),
      fieldFilter('program', 'Program', (r) => r.programId || '', () => [{ value: '', label: 'No program' }, ...store.all('servicePrograms').map((p) => ({ value: p.id, label: p.name }))]),
    ],
    defaultSort: { id: 'status', dir: 'asc' },
    search: (r) => [vehicleName(lookup.vehicle(r.vehicleId)), lookup.taskName(r.taskId)].join(' '),
    rowHref: (r) => `#/reminders/${r.id}`,
    columns: [
      { id: 'vehicle', label: 'Vehicle', render: (r) => vehicleCell(r.vehicleId, { sub: false }), sort: (r) => vehicleName(lookup.vehicle(r.vehicleId)), csv: (r) => vehicleName(lookup.vehicle(r.vehicleId)) },
      { id: 'task', label: 'Service task', render: (r) => h('span.cell-text', h('span.cell-title', lookup.taskName(r.taskId) || 'Service'), h('span.cell-sub', describeSchedule(r, lookup.vehicle(r.vehicleId)?.meterUnit))), sort: (r) => lookup.taskName(r.taskId), csv: (r) => lookup.taskName(r.taskId) },
      { id: 'status', label: 'Status', render: (r) => statusPill('reminder', st(r).status), sort: (r) => ORDER[st(r).status] * 1e7 + (st(r).daysLeft ?? 1e6), csv: (r) => st(r).status },
      { id: 'next', label: 'Next due', render: (r) => { const s = st(r); const v = lookup.vehicle(r.vehicleId); return h('span.cell-text', h('span', [s.nextDate ? formatDate(s.nextDate) : '', s.nextMeter != null ? meterText(s.nextMeter, v) : ''].filter(Boolean).join(' or ') || '-'), h(`span.cell-sub${s.status === 'overdue' ? '.danger-text' : ''}`, dueText(s, v, today))); }, sort: (r) => st(r).nextDate || '' },
      { id: 'last', label: 'Last completed', render: (r) => (r.lastDate ? h('span.cell-text', h('span', formatDate(r.lastDate)), r.lastMeter != null ? h('span.cell-sub', meterText(r.lastMeter, lookup.vehicle(r.vehicleId))) : null) : dash()), sort: (r) => r.lastDate || '' },
      { id: 'compliance', label: 'Compliance', align: 'r', render: (r) => { const c = compliance(r); return c === null ? dash() : `${Math.round(c * 100)}%`; }, sort: (r) => compliance(r) },
      { id: 'program', label: 'Program', hidden: true, render: (r) => store.get('servicePrograms', r.programId)?.name || dash(), sort: (r) => store.get('servicePrograms', r.programId)?.name || '' },
      editable ? { id: 'act', label: '', srLabel: 'Actions', fixed: true, render: (r) => h('button.btn.sm', { type: 'button', onClick: () => resolveReminder(r) }, icon('check', 14), 'Resolve') } : null,
    ].filter(Boolean),
    mobile: (r) => h('div.grow', h('div.row', h('strong.grow.truncate', lookup.taskName(r.taskId) || 'Service'), statusPill('reminder', st(r).status)), h('div.subtle.truncate', `${vehicleName(lookup.vehicle(r.vehicleId))} · ${dueText(st(r), lookup.vehicle(r.vehicleId), today)}`)),
    bulk: editable
      ? [
          { label: 'Snooze 2 weeks', icon: 'bell-off', run: (rows) => (rows.forEach((r) => store.patch('reminders', r.id, { snoozedUntil: addDays(app.today(), 14) })), toast(`${rows.length} reminders snoozed`)) },
          {
            label: 'Delete',
            icon: 'trash',
            danger: true,
            run: (rows) => {
              const removed = rows.map((r) => store.get('reminders', r.id)).filter(Boolean);
              store.bulkRemove('reminders', removed.map((r) => r.id));
              toast(`${removed.length} reminder${removed.length === 1 ? '' : 's'} deleted`, { action: { label: 'Undo', run: () => removed.forEach((r) => store.restore('reminders', r)) } });
            },
          },
        ]
      : null,
    empty: { icon: 'bell', title: 'No service reminders', text: 'Reminders tell you when preventive maintenance is due by date, mileage, or hours.', action: () => h('a.btn.primary', { href: '#/reminders/new' }, icon('plus', 16), 'Add reminder') },
  });
  ctx.onDispose(store.subscribe(() => cache.clear()));
  return list;
}

function metricBox(label, value, tone) {
  return h(`div.metric${value && tone ? '.tone-' + tone : ''}`, h('span.metric-label', label), h('span.metric-value', String(value)));
}

/** Resolve: record the service (best), or just mark it done. */
export function resolveReminder(r) {
  const v = lookup.vehicle(r.vehicleId);
  openFormDialog({
    title: `Resolve ${lookup.taskName(r.taskId) || 'reminder'}`,
    intro: 'Record a service entry so the work and its cost are in the history, or mark the reminder done if it was handled elsewhere.',
    record: { how: canEdit('serviceEntries') ? 'service' : 'done', date: app.today(), meter: v?.meter ?? null },
    fields: [
      {
        id: 'how',
        label: 'How',
        type: 'select',
        required: true,
        span: 2,
        options: () => [canEdit('serviceEntries') ? { value: 'service', label: 'Add a service entry' } : null, canEdit('workOrders') ? { value: 'wo', label: 'Create a work order' } : null, { value: 'done', label: 'Mark as done without an entry' }].filter(Boolean),
      },
      { id: 'date', label: 'Completed on', type: 'date', required: true, show: (x) => x.how === 'done' },
      { id: 'meter', label: 'Meter', type: 'number', min: 0, show: (x) => x.how === 'done' },
    ],
    saveLabel: 'Continue',
    onSave: async (x) => {
      if (x.how === 'service') return navigate(`/service/new?vehicle=${r.vehicleId}&reminder=${r.id}`);
      if (x.how === 'wo') return navigate(`/work-orders/new?vehicle=${r.vehicleId}&reminder=${r.id}`);
      const { completeReminder } = await import('../core/reminders.js');
      const current = app.store.get('reminders', r.id);
      if (!current) return toast('This reminder was deleted.', { type: 'error' });
      app.store.put('reminders', completeReminder(current, { date: x.date, meter: x.meter }, v, app.settings()));
      toast('Reminder resolved');
    },
  });
}
