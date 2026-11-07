import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { openFormDialog } from '../ui/form.js';
import { app, lookup, canEdit } from '../app.js';
import { vehicleName } from '../core/format.js';
import { formatDate } from '../core/dates.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { vehicleCell, vendorCell, money, options, deleteWithUndo } from './common.js';

export function render(ctx) {
  const editable = canEdit('expenses');
  const s = () => app.settings();
  const list = renderList(ctx, {
    key: 'expenses',
    title: 'Expense history',
    intro: 'Costs other than fuel and service: insurance, registration, tolls, parking, payments.',
    coll: 'expenses',
    watch: ['vehicles', 'vendors'],
    csvName: 'expenses',
    actions: editable ? [h('button.btn.primary', { type: 'button', onClick: () => openExpenseDialog({}) }, icon('plus', 16), 'Add expense')] : [],
    filters: [
      fieldFilter('vehicle', 'Vehicle', 'vehicleId', options.vehicles({ includeArchived: true })),
      // Types renamed or removed in settings stay on older expenses.
      fieldFilter('type', 'Type', 'type', () => [...new Set([...s().expenseTypes, ...app.store.all('expenses').map((e) => e.type).filter(Boolean)])].map((t) => ({ value: t, label: t }))),
      fieldFilter('vendor', 'Vendor', 'vendorId', options.vendors()),
    ],
    defaultSort: { id: 'date', dir: 'desc' },
    search: (e) => [vehicleName(lookup.vehicle(e.vehicleId)), e.type, e.notes, lookup.vendorName(e.vendorId)].join(' '),
    summary: (rows) => h('div.grid-totals', h('span.subtle', 'Total'), h('strong.money', money(rows.reduce((a, e) => a + (Number(e.amount) || 0), 0)))),
    columns: [
      { id: 'vehicle', label: 'Vehicle', render: (e) => vehicleCell(e.vehicleId), sort: (e) => vehicleName(lookup.vehicle(e.vehicleId)), csv: (e) => vehicleName(lookup.vehicle(e.vehicleId)) },
      { id: 'date', label: 'Date', render: (e) => editable ? h('button.link-btn', { type: 'button', onClick: () => openExpenseDialog(e) }, formatDate(e.date)) : formatDate(e.date), sort: (e) => e.date },
      { id: 'type', label: 'Type', render: (e) => e.type, sort: (e) => e.type },
      { id: 'vendor', label: 'Vendor', render: (e) => vendorCell(e.vendorId), sort: (e) => lookup.vendorName(e.vendorId) },
      { id: 'notes', label: 'Notes', render: (e) => h('span.truncate.max-30', e.notes || ''), sort: (e) => e.notes || '' },
      { id: 'amount', label: 'Amount', align: 'r', render: (e) => h('span.money', money(e.amount)), sort: (e) => Number(e.amount) || 0, csv: (e) => (Number(e.amount) / 100).toFixed(2) },
    ],
    // On a phone the table is hidden, so the card opens the expense.
    rowClick: editable ? (e) => openExpenseDialog(e) : null,
    mobile: (e) => h('div.grow', h('div.row', h('strong.grow.truncate', e.type), h('span.money', money(e.amount))), h('div.subtle.truncate', `${vehicleName(lookup.vehicle(e.vehicleId))} · ${formatDate(e.date)}`)),
    bulk: editable
      ? [
          {
            label: 'Delete',
            icon: 'trash',
            danger: true,
            run: async (rows) => {
              if (!(await confirmDialog({ title: `Delete ${rows.length === 1 ? 'this expense' : `${rows.length} expenses`}?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return false;
              app.store.bulkRemove('expenses', rows.map((r) => r.id));
              toast(`${rows.length} expense${rows.length === 1 ? '' : 's'} deleted`);
            },
          },
        ]
      : null,
    empty: { icon: 'receipt', title: 'No expenses yet', text: 'Track insurance, registration, tolls, and other costs per vehicle to see the full cost of ownership.' },
  });
  if (ctx.query.new && editable) setTimeout(() => openExpenseDialog({ vehicleId: ctx.query.vehicle || null }));
  return list;
}

export function openExpenseDialog(rec = {}) {
  const store = app.store;
  const existing = rec.id ? store.get('expenses', rec.id) : null;
  const s = app.settings();
  return openFormDialog({
    title: existing ? 'Edit expense' : 'Add expense',
    record: { date: app.today(), type: s.expenseTypes[0], ...rec },
    fields: [
      { id: 'vehicleId', label: 'Vehicle', type: 'picker', required: true, options: options.vehicles({ keep: rec.vehicleId }), span: 2 },
      { id: 'type', label: 'Expense type', type: 'select', required: true, options: () => s.expenseTypes },
      { id: 'amount', label: 'Amount', type: 'money', required: true },
      { id: 'date', label: 'Date', type: 'date', required: true },
      { id: 'vendorId', label: 'Vendor', type: 'picker', options: options.vendors(null, rec.vendorId), placeholder: 'No vendor' },
      { id: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 2 },
    ],
    extraFooter: existing ? ({ close }) => h('button.btn.subtle-danger', { type: 'button', onClick: async () => (await deleteWithUndo('expenses', existing, { label: 'expense' })) && close() }, icon('trash', 15), 'Delete') : null,
    onSave: (v) => {
      store.put('expenses', { ...(existing || { attachments: [] }), ...v, vendorId: v.vendorId || null });
      toast(existing ? 'Expense saved' : 'Expense added');
    },
  });
}
