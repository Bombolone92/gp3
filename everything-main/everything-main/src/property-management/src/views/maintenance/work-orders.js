/** Work orders: filterable list or board by status. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { pageHeader, chips, dataTable, emptyState, searchBox, statusPill, stat } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { setQuery } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { date, rememberSort, saveSort, exportCSV, displayName } from '../common.js';
import { matches } from '../../core/format.js';
import { statusLabel, isOverdue, WORK_ORDER_STATUSES, PRIORITIES } from '../../core/status.js';
import { viewToggle, filterSelect, propertyOptions, vendorOptions, memberOptions, isOpenWorkOrder } from './shared.js';

const VIEW_KEY = 'pm.workOrders.view';
const BOARD = ['new', 'assigned', 'in-progress', 'waiting', 'completed'];
const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };

const FILTERS = [
  { id: 'open', label: 'Open', match: (w) => isOpenWorkOrder(w) },
  { id: 'new', label: 'New', match: (w) => w.status === 'new' },
  { id: 'in-progress', label: 'In progress', match: (w) => w.status === 'in-progress' || w.status === 'assigned' || w.status === 'waiting' },
  { id: 'completed', label: 'Completed', match: (w) => w.status === 'completed' || w.status === 'closed' },
  { id: 'all', label: 'All', match: () => true },
];

/** Status menu items for a work order (used on cards and the detail page). */
export function statusMenuItems(w) {
  return WORK_ORDER_STATUSES.map((s) => ({
    label: statusLabel(s),
    checked: w.status === s,
    run: () => setStatus(w, s),
  }));
}

export function setStatus(w, status) {
  if (w.status === status) return;
  const before = { status: w.status, completedOn: w.completedOn || null };
  const changes = { status };
  if (status === 'completed' && !w.completedOn) changes.completedOn = app.today();
  if (!['completed', 'closed'].includes(status)) changes.completedOn = null;
  if (status === 'assigned' && !w.vendorId && !w.assigneeId) toast('Tip: choose a vendor or team member for this work order.');
  app.store.patch('workOrders', w.id, changes);
  toast(`WO-${w.number} marked ${statusLabel(status).toLowerCase()}`, { action: { label: 'Undo', run: () => app.store.patch('workOrders', w.id, before) } });
}

export function priorityTag(p) {
  if (!p || p === 'normal') return null;
  return h(`span.prio.prio-${p}`, icon(p === 'urgent' ? 'flag' : p === 'high' ? 'arrow-up' : 'arrow-down', 12), statusLabel(p));
}

export function render(ctx) {
  const store = app.store;
  const state = {
    view: (() => {
      try {
        return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'list';
      } catch {
        return 'list';
      }
    })(),
    filter: FILTERS.some((f) => f.id === ctx.query.status) ? ctx.query.status : 'open',
    q: ctx.query.q || '',
    property: ctx.query.property || '',
    vendor: ctx.query.vendor || '',
    assignee: ctx.query.assignee || '',
    priority: ctx.query.priority || '',
    sort: rememberSort('workOrders', { id: 'due', dir: 'asc' }),
  };
  const search = searchBox({
    value: state.q,
    placeholder: 'Search number, title or unit',
    label: 'Search work orders',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      body.redraw();
    },
  });
  const set = (key) => (v) => {
    state[key] = v;
    setQuery({ [key]: v });
    body.redraw();
  };

  const body = ctx.live(() => {
    const today = app.today();
    const all = store.all('workOrders');
    const base = all.filter(
      (w) =>
        (!state.property || w.propertyId === state.property) &&
        (!state.vendor || w.vendorId === state.vendor) &&
        (!state.assignee || w.assigneeId === state.assignee) &&
        (!state.priority || w.priority === state.priority) &&
        (!state.q || matches(`wo-${w.number} ${w.number} ${w.title} ${lookup.unitLabel(w.unitId) || lookup.property(w.propertyId)?.name || ''}`, state.q)),
    );
    const open = all.filter(isOpenWorkOrder);
    const overdue = open.filter((w) => isOverdue(w, today));
    const urgent = open.filter((w) => w.priority === 'urgent');
    const toolbar = h(
      'div.toolbar',
      search,
      filterSelect({ label: 'Property', value: state.property, options: propertyOptions(), onChange: set('property') }),
      filterSelect({ label: 'Vendor', value: state.vendor, options: vendorOptions(), onChange: set('vendor') }),
      filterSelect({ label: 'Assigned to', value: state.assignee, options: memberOptions('Any assignee'), onChange: set('assignee') }),
      filterSelect({ label: 'Priority', value: state.priority, options: [{ value: '', label: 'Any priority' }, ...PRIORITIES.map((p) => ({ value: p, label: statusLabel(p) }))], onChange: set('priority') }),
      h('div.grow'),
      viewToggle({
        label: 'Layout',
        value: state.view,
        items: [
          { value: 'list', label: 'List', icon: 'list' },
          { value: 'board', label: 'Board', icon: 'grid' },
        ],
        onChange: (v) => {
          state.view = v;
          try {
            localStorage.setItem(VIEW_KEY, v);
          } catch {}
          body.redraw();
        },
      }),
    );
    const stats = h(
      'div.stats.list-stats',
      stat({ label: 'Open', value: String(open.length), sub: 'Not completed yet', onClick: () => setFilter('open') }),
      stat({ label: 'New', value: String(open.filter((w) => w.status === 'new').length), sub: 'Need a vendor or assignee', onClick: () => setFilter('new') }),
      stat({ label: 'Overdue', value: String(overdue.length), sub: 'Past their due date', tone: overdue.length ? 'danger' : null }),
      stat({ label: 'Urgent', value: String(urgent.length), sub: 'Open and urgent', tone: urgent.length ? 'warning' : null }),
    );
    if (!all.length) {
      return h(
        'section.card',
        emptyState({ icon: 'wrench', title: 'No work orders yet', text: 'Track repairs from request to completed, with vendor, cost and photos.', headingLevel: 2, actions: [h('a.btn.primary', { href: '#/work-orders/new' }, icon('plus', 16), 'New work order')] }),
      );
    }
    if (state.view === 'board') {
      return [stats, h('section.card.list-card', { 'aria-label': 'Filters' }, toolbar), board(base.filter((w) => w.status !== 'cancelled' && w.status !== 'closed'), today)];
    }
    const f = FILTERS.find((x) => x.id === state.filter) || FILTERS[0];
    const rows = base.filter(f.match);
    return [
      stats,
      h(
        'section.card.list-card',
        { 'aria-label': 'Work orders' },
        toolbar,
        h('div.toolbar.sub-toolbar', chips({ label: 'Status', selected: f.id, onSelect: setFilter, items: FILTERS.map((x) => ({ id: x.id, label: x.label, count: base.filter(x.match).length })) })),
        h('div.sr-only', { role: 'status' }, `${rows.length} work orders`),
        dataTable({
          caption: 'Work orders',
          rows,
          sort: state.sort,
          onSort: (s) => {
            state.sort = s;
            saveSort('workOrders', s);
            body.redraw();
          },
          rowHref: (w) => `#/work-orders/${w.id}`,
          columns: [
            { id: 'number', label: 'No.', sort: (w) => w.number || 0, render: (w) => h('span.nowrap.subtle', `WO-${w.number}`) },
            { id: 'title', label: 'Title', cls: 'primary-cell', sort: (w) => (w.title || '').toLowerCase(), render: (w) => h('span', h('span', w.title || 'Untitled'), priorityTag(w.priority)) },
            { id: 'unit', label: 'Unit', sort: (w) => lookup.unitLabel(w.unitId) || lookup.property(w.propertyId)?.name || '', render: (w) => (w.unitId ? lookup.unitLabel(w.unitId) : lookup.property(w.propertyId)?.name || h('span.subtle', 'None')) },
            { id: 'vendor', label: 'Vendor', sort: (w) => displayName(lookup.vendor(w.vendorId)) || '', render: (w) => (w.vendorId ? displayName(lookup.vendor(w.vendorId)) : h('span.subtle', 'None')) },
            { id: 'assignee', label: 'Assigned to', sort: (w) => lookup.member(w.assigneeId)?.name || '', render: (w) => lookup.member(w.assigneeId)?.name || h('span.subtle', 'Unassigned') },
            { id: 'priority', label: 'Priority', sort: (w) => PRIORITY_RANK[w.priority || 'normal'], render: (w) => statusPill(w.priority || 'normal') },
            { id: 'due', label: 'Due', sort: (w) => w.dueDate || '9999', render: (w) => dueCell(w, today) },
            { id: 'status', label: 'Status', sort: (w) => WORK_ORDER_STATUSES.indexOf(w.status), render: (w) => statusPill(w.status) },
          ],
          mobile: (w) =>
            h(
              'a.mobile-row',
              { href: `#/work-orders/${w.id}` },
              h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', `WO-${w.number} ${w.title || ''}`), h('div.m-sub', [w.unitId ? lookup.unitLabel(w.unitId) : lookup.property(w.propertyId)?.name, w.dueDate ? `due ${date(w.dueDate, { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · '))),
              h('div.m-end', statusPill(w.status), priorityTag(w.priority)),
            ),
          empty: emptyState({ compact: true, icon: 'search', title: 'No matching work orders', text: 'Try a different search or filter.', headingLevel: 3 }),
        }),
      ),
    ];
  }, ['workOrders', 'vendors', 'team', 'units', 'properties']);

  function setFilter(id) {
    state.filter = id;
    if (state.view !== 'list') state.view = 'list';
    setQuery({ status: id === 'open' ? '' : id });
    body.redraw();
  }

  const exportBtn = h(
    'button.icon-btn.bordered',
    {
      type: 'button',
      'aria-label': 'Export work orders to CSV',
      title: 'Export to CSV',
      onClick: () =>
        exportCSV('work-orders', [
          { label: 'Number', value: (w) => `WO-${w.number}` },
          { label: 'Title', value: (w) => w.title },
          { label: 'Property', value: (w) => lookup.property(w.propertyId)?.name || '' },
          { label: 'Unit', value: (w) => lookup.unit(w.unitId)?.name || '' },
          { label: 'Vendor', value: (w) => displayName(lookup.vendor(w.vendorId)) },
          { label: 'Assigned to', value: (w) => lookup.member(w.assigneeId)?.name || '' },
          { label: 'Priority', value: (w) => statusLabel(w.priority || 'normal') },
          { label: 'Due', value: (w) => w.dueDate || '' },
          { label: 'Status', value: (w) => statusLabel(w.status) },
          { label: 'Completed', value: (w) => w.completedOn || '' },
        ], store.all('workOrders').slice().sort((a, b) => a.number - b.number)),
    },
    icon('download'),
  );

  return {
    node: h('div.page', pageHeader({ title: 'Work orders', actions: [exportBtn, h('a.btn.primary', { href: '#/work-orders/new' }, icon('plus', 16), 'New work order')] }), body),
    title: 'Work orders',
  };
}

function dueCell(w, today) {
  if (!w.dueDate) return h('span.subtle', 'None');
  const late = isOverdue(w, today, ['completed', 'closed', 'cancelled']);
  return h(`span.nowrap${late ? '.overdue' : ''}`, late ? icon('alert', 13) : null, date(w.dueDate, { month: 'short', day: 'numeric', year: w.dueDate.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' }));
}

function board(list, today) {
  return h(
    'div.board.wo-board',
    { role: 'list', 'aria-label': 'Work orders by status' },
    BOARD.map((status) => {
      const items = list.filter((w) => w.status === status).sort((a, b) => PRIORITY_RANK[a.priority || 'normal'] - PRIORITY_RANK[b.priority || 'normal'] || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
      const shown = status === 'completed' ? items.sort((a, b) => ((a.completedOn || '') < (b.completedOn || '') ? 1 : -1)).slice(0, 8) : items;
      return h(
        'section.board-col',
        { role: 'listitem', 'aria-label': `${statusLabel(status)}, ${items.length}` },
        h('header.board-head', statusPill(status), h('span.board-count', String(items.length))),
        shown.length ? h('ul.board-list', shown.map((w) => h('li', woCard(w, today)))) : h('p.board-empty', 'None'),
        status === 'completed' && items.length > shown.length ? h('a.board-more', { href: '#/work-orders?status=completed' }, `View all ${items.length}`) : null,
      );
    }),
  );
}

function woCard(w, today) {
  return h(
    'article.board-card',
    h(
      'div.board-card-top',
      h('a.board-card-title', { href: `#/work-orders/${w.id}` }, h('span.subtle', `WO-${w.number} `), w.title || 'Untitled'),
      h('button.icon-btn.sm', { type: 'button', 'aria-label': `Change status of WO-${w.number}`, onClick: (e) => openMenu(e.currentTarget, statusMenuItems(w), { label: 'Status' }) }, icon('more', 16)),
    ),
    h('div.board-card-sub', w.unitId ? lookup.unitLabel(w.unitId) : lookup.property(w.propertyId)?.name || ''),
    h(
      'div.board-card-meta',
      priorityTag(w.priority),
      w.dueDate ? dueCell(w, today) : null,
      w.vendorId ? h('span', { title: 'Vendor' }, icon('truck', 13), displayName(lookup.vendor(w.vendorId))) : null,
    ),
  );
}
