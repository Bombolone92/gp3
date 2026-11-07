import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList } from '../ui/grid.js';
import { app, lookup, canEdit } from '../app.js';
import { formatInterval } from '../core/dates.js';

export function render(ctx) {
  const store = app.store;
  const editable = canEdit('servicePrograms');
  return renderList(ctx, {
    key: 'service-programs',
    title: 'Service programs',
    intro: 'A program is a maintenance schedule you apply to many vehicles at once. Each vehicle gets a reminder for every task.',
    coll: 'servicePrograms',
    watch: ['vehicles', 'serviceTasks'],
    actions: editable ? [h('a.btn.primary', { href: '#/service-programs/new' }, icon('plus', 16), 'Add program')] : [],
    defaultSort: { id: 'name', dir: 'asc' },
    search: (p) => [p.name, p.description].join(' '),
    rowHref: (p) => `#/service-programs/${p.id}`,
    columns: [
      { id: 'name', label: 'Name', fixed: true, render: (p) => h('span.cell-text', h('span.cell-title', p.name), p.description ? h('span.cell-sub', p.description) : null), sort: (p) => p.name },
      { id: 'tasks', label: 'Schedules', render: (p) => h('span.truncate', (p.schedules || []).map((s) => `${lookup.taskName(s.taskId)} (${[formatInterval(s.interval).replace('Every ', ''), s.meterInterval ? `${s.meterInterval.toLocaleString()}` : ''].filter(Boolean).join(' or ')})`).join(', ')) },
      { id: 'count', label: 'Tasks', align: 'r', render: (p) => String((p.schedules || []).length), sort: (p) => (p.schedules || []).length },
      { id: 'vehicles', label: 'Vehicles', align: 'r', render: (p) => String((p.vehicleIds || []).filter((id) => store.get('vehicles', id)).length), sort: (p) => (p.vehicleIds || []).length },
    ],
    mobile: (p) => h('div.grow', h('strong', p.name), h('div.subtle', `${(p.schedules || []).length} tasks · ${(p.vehicleIds || []).length} vehicles`)),
    empty: { icon: 'layers', title: 'No service programs', text: 'Create a program like "Light duty maintenance" with its tasks and intervals, then add vehicles to it.', action: () => h('a.btn.primary', { href: '#/service-programs/new' }, icon('plus', 16), 'Add program') },
  });
}
