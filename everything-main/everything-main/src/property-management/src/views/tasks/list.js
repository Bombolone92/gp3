/**
 * Tasks: incoming resident, owner and contact requests, the signed-in
 * person's tasks, and everything open or done, with filters.
 */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, searchBox, chips, dataTable, emptyState, statusPill, select, avatar } from '../../ui/components.js';
import { setQuery } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { formatDate, relativeDay } from '../../core/dates.js';
import { displayName, matches, personName, pluralize } from '../../core/format.js';
import { PRIORITIES, TASK_KINDS, isOverdue, statusLabel, taskKindLabel } from '../../core/status.js';
import { INCOMING_KINDS } from '../../core/counts.js';
import { memberSelect, propertySelect, rememberSort, saveSort, exportCSV } from '../common.js';

const DONE = new Set(['completed', 'closed', 'deferred']);

/** The team member record for the signed-in person, if one matches. */
export function currentMember(store = app.store) {
  const u = String(app.user?.username || '').toLowerCase();
  if (!u) return null;
  return (
    store.all('team').find((m) => {
      const name = String(m.name || '').toLowerCase();
      const email = String(m.email || '').toLowerCase();
      return m.username?.toLowerCase() === u || name === u || email === u || email.split('@')[0] === u;
    }) || null
  );
}

export const TASK_VIEWS = [
  { id: 'incoming', label: 'Incoming requests', match: (t) => INCOMING_KINDS.has(t.kind) && t.status === 'new' },
  { id: 'mine', label: 'My tasks', match: (t, me) => !DONE.has(t.status) && (!me || t.assigneeId === me.id) },
  { id: 'open', label: 'All open', match: (t) => !DONE.has(t.status) },
  { id: 'done', label: 'Completed', match: (t) => DONE.has(t.status) },
  { id: 'all', label: 'All', match: () => true },
];

/** "Maple Court · 2C · Maya Alvarez", whatever the task is about. */
export function relatedText(t, store = app.store) {
  const parts = [];
  if (t.unitId) parts.push(lookup.unitLabel(t.unitId));
  else if (t.propertyId) parts.push(store.get('properties', t.propertyId)?.name || '');
  const tenant = t.tenantId ? store.get('tenants', t.tenantId) : null;
  if (tenant) parts.push(personName(tenant));
  const owner = t.ownerId ? store.get('owners', t.ownerId) : null;
  if (owner) parts.push(displayName(owner));
  if (t.contact?.name) parts.push(t.contact.name);
  return parts.filter(Boolean).join(' · ');
}

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

export function render(ctx) {
  const store = app.store;
  const me = currentMember();
  const defaultView = store.all('tasks').some(TASK_VIEWS[0].match) ? 'incoming' : 'open';
  const state = {
    view: TASK_VIEWS.some((v) => v.id === ctx.query.view) ? ctx.query.view : defaultView,
    q: ctx.query.q || '',
    propertyId: ctx.query.property || '',
    assigneeId: ctx.query.assignee || '',
    category: ctx.query.category || '',
    priority: ctx.query.priority || '',
    sort: rememberSort('tasks', { id: 'due', dir: 'asc' }),
  };

  const header = pageHeader({
    title: 'Tasks',
    subtitle: 'Requests from residents and owners, and your team to-dos',
    actions: [
      h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Export tasks as CSV', title: 'Export CSV', onClick: () => doExport() }, icon('download')),
      h('a.btn.primary', { href: '#/tasks/new' }, icon('plus', 16), 'New task'),
    ],
  });

  const search = searchBox({
    value: state.q,
    placeholder: 'Search tasks',
    label: 'Search tasks',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      results.redraw();
    },
  });

  const bind = (el, key, param) => {
    el.addEventListener('change', () => {
      state[key] = el.value;
      setQuery({ [param]: el.value });
      results.redraw();
    });
    return el;
  };
  const filters = h(
    'div.task-filters',
    bind(propertySelect({ value: state.propertyId, empty: 'All properties', 'aria-label': 'Property' }), 'propertyId', 'property'),
    bind(memberSelect({ value: state.assigneeId, empty: 'Anyone', 'aria-label': 'Assigned to' }), 'assigneeId', 'assignee'),
    bind(select({ value: state.category, 'aria-label': 'Category', options: [{ value: '', label: 'All categories' }, ...(app.settings().lists?.taskCategories || []).map((c) => ({ value: c, label: c }))] }), 'category', 'category'),
    bind(select({ value: state.priority, 'aria-label': 'Priority', options: [{ value: '', label: 'Any priority' }, ...PRIORITIES.map((p) => ({ value: p, label: statusLabel(p) }))] }), 'priority', 'priority'),
  );

  const viewChips = h('div');
  function visible() {
    const v = TASK_VIEWS.find((x) => x.id === state.view);
    return store.all('tasks').filter(
      (t) =>
        v.match(t, me) &&
        (!state.propertyId || t.propertyId === state.propertyId) &&
        (!state.assigneeId || t.assigneeId === state.assigneeId) &&
        (!state.category || t.category === state.category) &&
        (!state.priority || t.priority === state.priority) &&
        (!state.q || matches(`tk-${t.number} ${t.title} ${t.description || ''} ${relatedText(t)} ${t.category || ''}`, state.q)),
    );
  }

  function accept(t) {
    store.patch('tasks', t.id, { status: 'in-progress', assigneeId: t.assigneeId || me?.id || null });
    toast(`Task ${t.number} accepted`);
  }

  const results = ctx.live(() => {
    const all = store.all('tasks');
    viewChips.replaceChildren(
      chips({
        label: 'Show',
        selected: state.view,
        onSelect: (id) => {
          state.view = id;
          setQuery({ view: id });
          results.redraw();
        },
        items: TASK_VIEWS.map((v) => ({ id: v.id, label: v.id === 'mine' && !me ? 'Assigned' : v.label, count: all.filter((t) => v.match(t, me)).length })),
      }),
    );
    const rows = visible();
    const today = app.today();
    return [
      h('div.sr-only', { role: 'status' }, pluralize(rows.length, 'task')),
      dataTable({
        caption: 'Tasks',
        rows,
        sort: state.sort,
        onSort: (s) => {
          state.sort = s;
          saveSort('tasks', s);
          results.redraw();
        },
        rowHref: (t) => `#/tasks/${t.id}`,
        columns: [
          { id: 'number', label: 'Task', sort: (t) => t.number || 0, render: (t) => h('span.subtle.nowrap', `TK-${t.number || ''}`) },
          {
            id: 'title',
            label: 'Title',
            sort: (t) => t.title || '',
            render: (t) => h('span.task-title-cell', h('span.primary-link', t.title || 'Untitled task'), t.category ? h('span.subtle', t.category) : null),
          },
          { id: 'kind', label: 'Type', sort: (t) => t.kind, render: (t) => taskKindLabel(t.kind) },
          { id: 'related', label: 'Related to', render: (t) => h('span.truncate.related-cell', relatedText(t) || h('span.subtle', 'General')) },
          {
            id: 'assignee',
            label: 'Assigned to',
            sort: (t) => lookup.member(t.assigneeId)?.name || '',
            render: (t) => {
              const m = lookup.member(t.assigneeId);
              return m ? h('span.row.nowrap', { style: { gap: '6px' } }, avatar(m.name, { color: m.color, size: 'sm' }), m.name) : h('span.subtle', 'Unassigned');
            },
          },
          {
            id: 'due',
            label: 'Due',
            sort: (t) => t.dueDate || '9999',
            render: (t) => (t.dueDate ? h(`span.nowrap${isOverdue(t, today) ? '.overdue' : ''}`, { title: formatDate(t.dueDate) }, isOverdue(t, today) ? icon('alert', 14) : null, relativeDay(t.dueDate, today)) : h('span.subtle', 'None')),
          },
          { id: 'priority', label: 'Priority', sort: (t) => PRIORITY_RANK[t.priority] ?? 2, render: (t) => (t.priority && t.priority !== 'normal' ? statusPill(t.priority) : h('span.subtle', 'Normal')) },
          {
            id: 'status',
            label: 'Status',
            sort: (t) => t.status,
            render: (t) =>
              state.view === 'incoming' && t.status === 'new'
                ? h('span.row.nowrap', { style: { gap: '8px' } }, statusPill(t.status), h('button.btn.sm', { type: 'button', onClick: () => accept(t) }, 'Accept'))
                : statusPill(t.status),
          },
        ],
        mobile: (t) =>
          h(
            'a.mobile-row',
            { href: `#/tasks/${t.id}` },
            h(
              'div.grow',
              { style: { minWidth: '0' } },
              h('div.m-title', t.title || 'Untitled task'),
              h('div.m-sub', [taskKindLabel(t.kind), relatedText(t)].filter(Boolean).join(' · ')),
            ),
            h('div.m-end', statusPill(t.status), t.dueDate ? h(`span.nowrap${isOverdue(t, today) ? '.overdue' : '.subtle'}`, { style: { fontSize: '12px' } }, relativeDay(t.dueDate, today)) : null),
          ),
        empty: all.length
          ? emptyState({ compact: true, icon: 'check-check', title: state.view === 'incoming' ? 'No new requests' : 'No matching tasks', text: state.view === 'incoming' ? 'New requests from residents and owners appear here.' : 'Try a different filter.', headingLevel: 3 })
          : emptyState({
              icon: 'list-checks',
              title: 'No tasks yet',
              text: 'Track resident requests, owner questions and your own to-dos in one place.',
              actions: [h('a.btn.primary', { href: '#/tasks/new' }, icon('plus', 16), 'New task')],
              headingLevel: 3,
            }),
      }),
    ];
  }, ['tasks', 'team', 'properties', 'units', 'tenants', 'owners']);

  function doExport() {
    const rows = visible();
    exportCSV(`tasks-${app.today()}`, [
      { label: 'Number', value: (t) => `TK-${t.number}` },
      { label: 'Title', value: (t) => t.title },
      { label: 'Type', value: (t) => taskKindLabel(t.kind) },
      { label: 'Status', value: (t) => statusLabel(t.status) },
      { label: 'Priority', value: (t) => statusLabel(t.priority || 'normal') },
      { label: 'Due', value: (t) => t.dueDate || '' },
      { label: 'Assigned to', value: (t) => lookup.member(t.assigneeId)?.name || '' },
      { label: 'Category', value: (t) => t.category || '' },
      { label: 'Related to', value: (t) => relatedText(t) },
    ], rows);
  }

  return {
    node: h('div.page', header, h('section.card.list-card', { 'aria-label': 'Task list' }, h('div.toolbar.task-toolbar', viewChips), h('div.toolbar', search, filters), results)),
    title: 'Tasks',
  };
}

export { TASK_KINDS };
