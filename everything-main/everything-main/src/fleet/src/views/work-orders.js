import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { app, lookup, canEdit } from '../app.js';
import { navigate, setQuery } from '../ui/router.js';
import { vehicleName, contactName, matches } from '../core/format.js';
import { formatDate, relativeDays } from '../core/dates.js';
import { docTotals } from '../core/totals.js';
import { WORK_ORDER_STATUSES, REPAIR_CLASSES, statusMeta } from '../core/status.js';
import { statusPill, pill, avatar, segmented } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { vehicleCell, contactCell, money, options, dash, vehicleThumb } from './common.js';
import { completeDialog } from './service-form.js';
import { colorFor } from '../core/format.js';

function viewToggle(current) {
  return segmented({
    label: 'View',
    value: current,
    items: [
      { value: 'list', icon: 'layout-list', label: 'List' },
      { value: 'board', icon: 'kanban', label: 'Board' },
    ],
    onChange: (id) => id !== current && navigate(`/work-orders${id === 'board' ? '?view=board' : ''}`),
  });
}

export function render(ctx) {
  const store = app.store;
  const today = app.today();
  const editable = canEdit('workOrders');
  const late = (w) => w.dueDate && w.dueDate < today && w.status !== 'completed' && w.status !== 'cancelled';
  const addBtn = editable ? h('a.btn.primary', { href: '#/work-orders/new' }, icon('plus', 16), 'Add work order') : null;
  if (ctx.query.view === 'board') return board(ctx, addBtn);
  return renderList(ctx, {
    key: 'work-orders',
    title: 'Work orders',
    coll: 'workOrders',
    watch: ['vehicles', 'contacts', 'vendors'],
    csvName: 'work-orders',
    actions: [viewToggle('list'), addBtn],
    tabs: [
      { id: 'active', label: 'Active', filter: (w) => w.status !== 'completed' && w.status !== 'cancelled' },
      { id: 'open', label: 'Open', dot: 'blue', filter: (w) => w.status === 'open' },
      { id: 'in_progress', label: 'In progress', filter: (w) => w.status === 'in_progress' },
      { id: 'on_hold', label: 'On hold', dot: 'orange', filter: (w) => w.status === 'on_hold' },
      { id: 'completed', label: 'Completed', filter: (w) => w.status === 'completed' },
      { id: 'all', label: 'All' },
    ],
    filters: [
      fieldFilter('vehicle', 'Vehicle', 'vehicleId', options.vehicles({ includeArchived: true })),
      fieldFilter('assignee', 'Assigned to', (w) => w.assigneeId || '', () => [{ value: '', label: 'Unassigned' }, ...options.contacts()()]),
      fieldFilter('vendor', 'Vendor', (w) => w.vendorId || '', () => [{ value: '', label: 'In-house' }, ...options.vendors()()]),
      fieldFilter('class', 'Repair class', 'repairClass', () => REPAIR_CLASSES.map((c) => ({ value: c.id, label: c.label }))),
    ],
    defaultSort: { id: 'number', dir: 'desc' },
    search: (w) => [`#${w.number}`, vehicleName(lookup.vehicle(w.vehicleId)), w.notes, contactName(lookup.contact(w.assigneeId)), ...(w.lineItems || []).map((li) => lookup.taskName(li.taskId) || li.description)].join(' '),
    rowHref: (w) => `#/work-orders/${w.id}`,
    columns: [
      { id: 'number', label: 'Number', render: (w) => h('strong', `#${w.number}`), sort: (w) => Number(w.number) },
      { id: 'vehicle', label: 'Vehicle', render: (w) => vehicleCell(w.vehicleId, { sub: false }), sort: (w) => vehicleName(lookup.vehicle(w.vehicleId)), csv: (w) => vehicleName(lookup.vehicle(w.vehicleId)) },
      { id: 'status', label: 'Status', render: (w) => h('span.row.gap-4', statusPill('workOrder', w.status), late(w) ? pill('Late', 'red') : null), sort: (w) => WORK_ORDER_STATUSES.findIndex((s) => s.id === w.status), csv: (w) => statusMeta('workOrder', w.status).label },
      { id: 'class', label: 'Repair class', render: (w) => statusPill('repair', w.repairClass), sort: (w) => w.repairClass, csv: (w) => statusMeta('repair', w.repairClass).label },
      { id: 'tasks', label: 'Service tasks', render: (w) => h('span.truncate', (w.lineItems || []).map((li) => lookup.taskName(li.taskId) || li.description).filter(Boolean).join(', ') || '-') },
      { id: 'issued', label: 'Issued', render: (w) => formatDate(w.issueDate), sort: (w) => w.issueDate },
      { id: 'due', label: 'Expected completion', render: (w) => (w.dueDate ? h('span', formatDate(w.dueDate), w.status !== 'completed' ? h('span.cell-sub', relativeDays(w.dueDate, today)) : null) : dash()), sort: (w) => w.dueDate || '' },
      { id: 'assignee', label: 'Assigned to', render: (w) => (w.assigneeId ? contactCell(w.assigneeId) : dash()), sort: (w) => contactName(lookup.contact(w.assigneeId)) },
      { id: 'vendor', label: 'Vendor', hidden: true, render: (w) => lookup.vendorName(w.vendorId) || 'In-house', sort: (w) => lookup.vendorName(w.vendorId) },
      { id: 'total', label: 'Total', align: 'r', render: (w) => h('span.money', money(docTotals(w).total)), sort: (w) => docTotals(w).total, csv: (w) => (docTotals(w).total / 100).toFixed(2) },
    ],
    mobile: (w) => h('div.grow', h('div.row', h('strong.grow.truncate', `#${w.number} ${vehicleName(lookup.vehicle(w.vehicleId))}`), statusPill('workOrder', w.status)), h('div.subtle.truncate', `${formatDate(w.issueDate)} · ${money(docTotals(w).total)}`)),
    empty: { icon: 'clipboard', title: 'No work orders', text: 'Plan repairs and maintenance, assign them to technicians, and track them to completion.', action: () => h('a.btn.primary', { href: '#/work-orders/new' }, icon('plus', 16), 'Add work order') },
  });
}

/** Kanban board by status. Drag a card, or use its menu, to change status. */
function board(ctx, addBtn) {
  const store = app.store;
  const editable = canEdit('workOrders');
  const COLS = ['open', 'in_progress', 'on_hold', 'completed'];
  let q = ctx.query.q || '';
  const search = h('input.input.sm', { type: 'search', value: q, placeholder: 'Search work orders', 'aria-label': 'Search work orders' });
  search.addEventListener('input', () => {
    q = search.value;
    setQuery({ q });
    boardNode.redraw();
  });

  function move(w, status) {
    if (w.status === status) return;
    if (status === 'completed') {
      completeDialog(w);
      return;
    }
    store.patch('workOrders', w.id, { status, completedDate: null });
    toast(`Work order #${w.number} moved to ${statusMeta('workOrder', status).label}`);
  }

  const boardNode = ctx.live(() => {
    const today = app.today();
    const all = store.all('workOrders').filter((w) => !q || matches(`#${w.number} ${vehicleName(lookup.vehicle(w.vehicleId))} ${w.notes || ''}`, q));
    return h(
      'div.board',
      COLS.map((st) => {
        let cards = all.filter((w) => w.status === st);
        if (st === 'completed') cards = cards.sort((a, b) => String(b.completedDate).localeCompare(String(a.completedDate))).slice(0, 15);
        else cards = cards.sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
        const meta = statusMeta('workOrder', st);
        const col = h(
          'section.board-col',
          { 'aria-label': meta.label, dataset: { status: st } },
          h('header.board-head', h(`span.dot-status.${meta.tone}`, meta.label), h('span.tab-count', String(all.filter((w) => w.status === st).length))),
          h(
            'ul.board-cards',
            cards.map((w) => {
              const late = w.dueDate && w.dueDate < today && st !== 'completed';
              const card = h(
                'li.board-card',
                { draggable: editable ? 'true' : null, dataset: { id: w.id } },
                h('div.row', vehicleThumb(lookup.vehicle(w.vehicleId), 'sm'), h('a.grow.truncate.board-title', { href: `#/work-orders/${w.id}` }, `#${w.number} ${vehicleName(lookup.vehicle(w.vehicleId))}`)),
                h('div.board-tasks.truncate', (w.lineItems || []).map((li) => lookup.taskName(li.taskId) || li.description).filter(Boolean).join(', ') || 'No tasks yet'),
                h(
                  'div.row.board-foot',
                  statusPill('repair', w.repairClass),
                  st === 'completed' ? (w.completedDate ? h('span.small.subtle', formatDate(w.completedDate)) : null) : w.dueDate ? h(`span.small${late ? '.danger-text' : '.subtle'}`, `Due ${relativeDays(w.dueDate, today)}`) : null,
                  h('span.grow'),
                  w.assigneeId ? avatar(contactName(lookup.contact(w.assigneeId)), { color: colorFor(w.assigneeId), size: 'sm', title: contactName(lookup.contact(w.assigneeId)) }) : null,
                  editable
                    ? h('button.icon-btn.sm', { type: 'button', 'aria-label': `Move work order ${w.number}`, onClick: (e) => openMenu(e.currentTarget, COLS.filter((c) => c !== st).map((c) => ({ label: `Move to ${statusMeta('workOrder', c).label}`, run: () => move(w, c) })), { align: 'end' }) }, icon('more', 15))
                    : null,
                ),
              );
              card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', w.id);
                e.dataTransfer.effectAllowed = 'move';
                card.classList.add('dragging');
              });
              card.addEventListener('dragend', () => card.classList.remove('dragging'));
              return card;
            }),
            cards.length ? null : h('li.board-empty', 'Nothing here'),
          ),
        );
        if (editable) {
          col.addEventListener('dragover', (e) => {
            e.preventDefault();
            col.classList.add('drop');
          });
          col.addEventListener('dragleave', (e) => !col.contains(e.relatedTarget) && col.classList.remove('drop'));
          col.addEventListener('drop', (e) => {
            e.preventDefault();
            col.classList.remove('drop');
            const w = store.get('workOrders', e.dataTransfer.getData('text/plain'));
            if (w) move(w, st);
          });
        }
        return col;
      }),
    );
  }, ['workOrders', 'vehicles', 'contacts']);

  return {
    node: h('div.page.board-page', h('header.page-header', h('div.titles', h('h1', 'Work orders')), h('div.actions', viewToggle('board'), addBtn)), h('div.board-toolbar', h('div.input-affix.search.grid-search', icon('search', 15), search)), boardNode),
    title: 'Work orders',
  };
}
