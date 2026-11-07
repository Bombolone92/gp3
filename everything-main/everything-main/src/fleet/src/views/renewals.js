import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { openFormDialog } from '../ui/form.js';
import { app, lookup, canEdit } from '../app.js';
import { vehicleName, contactName } from '../core/format.js';
import { formatDate, relativeDays, formatInterval, INTERVAL_UNITS, addDays } from '../core/dates.js';
import { renewalState, completeRenewal } from '../core/reminders.js';
import { statusPill, pill } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { vehicleCell, contactCell, options, dash, deleteWithUndo, money } from './common.js';

export function render(ctx) {
  const kind = ctx.route.path.startsWith('/contact-renewals') ? 'contact' : 'vehicle';
  const editable = canEdit('renewals');
  const today = app.today();
  const st = (r) => (r.done ? 'done' : renewalState(r, today, app.settings()).status);
  // Renewals of archived or deleted vehicles and contacts are not due: as
  // on the dashboard and in Needs attention, they stay out of the open tabs.
  const activeOwner = (r) => {
    const o = kind === 'contact' ? lookup.contact(r.contactId) : lookup.vehicle(r.vehicleId);
    return Boolean(o) && !o.archived;
  };
  const ownerName = (r) => (kind === 'contact' ? contactName(lookup.contact(r.contactId)) : vehicleName(lookup.vehicle(r.vehicleId)));
  const types = () => (kind === 'contact' ? app.settings().contactRenewalTypes : app.settings().vehicleRenewalTypes);
  const list = renderList(ctx, {
    key: `renewals-${kind}`,
    title: kind === 'contact' ? 'Contact renewals' : 'Vehicle renewals',
    intro: kind === 'contact' ? 'Driver licenses, medical cards, and certifications that expire.' : 'Registration, insurance, emission tests, and other dated obligations.',
    rows: () => app.store.all('renewals').filter((r) => (r.kind || 'vehicle') === kind),
    coll: 'renewals',
    watch: ['vehicles', 'contacts'],
    csvName: `${kind}-renewals`,
    actions: editable ? [h('button.btn.primary', { type: 'button', onClick: () => openRenewalDialog({ kind }) }, icon('plus', 16), 'Add renewal')] : [],
    tabs: [
      { id: 'open', label: 'All open', filter: (r) => !r.done && activeOwner(r) },
      { id: 'overdue', label: 'Overdue', dot: 'red', filter: (r) => activeOwner(r) && st(r) === 'overdue' },
      { id: 'due_soon', label: 'Due soon', dot: 'orange', filter: (r) => activeOwner(r) && st(r) === 'due_soon' },
      { id: 'done', label: 'Completed', filter: (r) => r.done },
    ],
    filters: [
      kind === 'contact' ? fieldFilter('contact', 'Contact', 'contactId', options.contacts()) : fieldFilter('vehicle', 'Vehicle', 'vehicleId', options.vehicles({ includeArchived: true })),
      fieldFilter('type', 'Type', 'type', () => types().map((t) => ({ value: t, label: t }))),
    ],
    defaultSort: { id: 'due', dir: 'asc' },
    search: (r) => [ownerName(r), r.type, r.notes].join(' '),
    columns: [
      kind === 'contact'
        ? { id: 'owner', label: 'Contact', render: (r) => contactCell(r.contactId), sort: ownerName, csv: ownerName }
        : { id: 'owner', label: 'Vehicle', render: (r) => vehicleCell(r.vehicleId), sort: ownerName, csv: ownerName },
      { id: 'type', label: 'Renewal type', render: (r) => (editable ? h('button.link-btn', { type: 'button', onClick: () => openRenewalDialog(r) }, r.type) : r.type), sort: (r) => r.type },
      { id: 'status', label: 'Status', render: (r) => (r.done ? pill('Completed', 'green') : statusPill('reminder', st(r))), sort: (r) => ['overdue', 'due_soon', 'snoozed', 'upcoming', 'done'].indexOf(st(r)) },
      { id: 'due', label: 'Due date', render: (r) => (r.dueDate ? h('span', formatDate(r.dueDate), h('span.cell-sub', relativeDays(r.dueDate, today))) : dash()), sort: (r) => r.dueDate || '9999' },
      { id: 'repeat', label: 'Repeats', render: (r) => formatInterval(r.repeat) || 'One time' },
      { id: 'last', label: 'Last completed', render: (r) => (r.history?.length ? formatDate(r.history.at(-1).date) : dash()), sort: (r) => r.history?.at(-1)?.date || '' },
      editable ? { id: 'act', label: '', srLabel: 'Actions', fixed: true, render: (r) => (r.done ? '' : h('button.btn.sm', { type: 'button', onClick: () => resolveRenewal(r) }, icon('check', 14), 'Resolve')) } : null,
    ].filter(Boolean),
    // On a phone the table is hidden, so the card opens the renewal.
    rowClick: editable ? (r) => openRenewalDialog(r) : null,
    mobile: (r) => h('div.grow', h('div.row', h('strong.grow.truncate', `${r.type}: ${ownerName(r)}`), r.done ? pill('Done', 'green') : statusPill('reminder', st(r))), h('div.subtle', r.dueDate ? `${formatDate(r.dueDate)}, ${relativeDays(r.dueDate, today)}` : '')),
    empty: { icon: 'calendar-clock', title: 'No renewals tracked', text: kind === 'contact' ? 'Add license and certification expirations to get reminded before they lapse.' : 'Add registration and insurance dates to get reminded before they lapse.' },
  });
  if (ctx.query.new && editable) setTimeout(() => openRenewalDialog({ kind, vehicleId: ctx.query.vehicle || null }));
  return list;
}

/** Mark done: rolls forward by the repeat interval, or asks for the next date. */
export function resolveRenewal(r) {
  const next = r.repeat?.every ? completeRenewal(r, { date: app.today() }).dueDate : null;
  return openFormDialog({
    title: `Resolve ${r.type}`,
    intro: next ? `The next due date moves forward by the repeat interval. Change it if the new expiry differs.` : 'Enter the new expiry date, or leave it empty if this does not come back.',
    record: { date: app.today(), nextDue: next },
    fields: [
      { id: 'date', label: 'Completed on', type: 'date', required: true },
      { id: 'cost', label: 'Cost', type: 'money', hint: 'Recorded as an expense on the vehicle.', show: () => r.kind !== 'contact' },
      { id: 'nextDue', label: 'Next due date', type: 'date' },
    ],
    saveLabel: 'Resolve',
    onSave: (v) => {
      const current = app.store.get('renewals', r.id);
      if (!current) return toast('This renewal was deleted.', { type: 'error' });
      const done = completeRenewal(current, { date: v.date, nextDue: v.nextDue || null, cost: v.cost });
      if (!v.nextDue) {
        done.dueDate = null;
        done.done = true;
      }
      app.store.put('renewals', done);
      if (v.cost && r.kind !== 'contact') {
        const s = app.settings();
        const type = s.expenseTypes.find((t) => t.toLowerCase() === String(r.type).toLowerCase()) || s.expenseTypes.find((t) => t === 'Registration' && /regist/i.test(r.type)) || 'Other';
        app.store.put('expenses', { vehicleId: r.vehicleId, date: v.date, type, amount: v.cost, notes: `${r.type} renewal`, vendorId: null, attachments: [] });
      }
      toast(`${r.type} resolved${done.dueDate ? `, next due ${formatDate(done.dueDate)}` : ''}`);
    },
  });
}

export function openRenewalDialog(rec = {}) {
  const store = app.store;
  const existing = rec.id ? store.get('renewals', rec.id) : null;
  const kind = existing?.kind || rec.kind || 'vehicle';
  const s = app.settings();
  const types = kind === 'contact' ? s.contactRenewalTypes : s.vehicleRenewalTypes;
  return openFormDialog({
    title: existing ? `Edit ${existing.type}` : kind === 'contact' ? 'Add contact renewal' : 'Add vehicle renewal',
    record: { type: types[0], dueDate: addDays(app.today(), 30), repeatEvery: existing?.repeat?.every ?? 1, repeatUnit: existing?.repeat?.unit || 'years', repeats: existing ? Boolean(existing.repeat?.every) : true, ...rec },
    fields: [
      kind === 'contact' ? { id: 'contactId', label: 'Contact', type: 'picker', required: true, options: options.contacts(null, rec.contactId), span: 2 } : { id: 'vehicleId', label: 'Vehicle', type: 'picker', required: true, options: options.vehicles({ keep: rec.vehicleId }), span: 2 },
      { id: 'type', label: 'Renewal type', type: 'select', required: true, options: () => types },
      // A completed renewal has no due date; entering one reopens it.
      { id: 'dueDate', label: 'Due date', type: 'date', required: !existing?.done, hint: existing?.done ? 'Completed. Enter a date to open it again.' : null },
      { id: 'repeats', label: 'Repeats', type: 'switch', checkLabel: 'Repeats after each renewal', span: 2 },
      { id: 'repeatEvery', label: 'Every', type: 'number', min: 1, show: (v) => v.repeats },
      { id: 'repeatUnit', label: 'Unit', type: 'select', required: true, options: () => INTERVAL_UNITS.map((u) => ({ value: u.id, label: u.label })), show: (v) => v.repeats },
      { id: 'dueSoonDays', label: 'Remind me', type: 'number', min: 0, unit: 'days before', placeholder: String(s.dueSoon.days) },
      { id: 'notes', label: 'Notes', type: 'textarea', rows: 2, span: 2 },
    ],
    extraFooter: existing ? ({ close }) => h('button.btn.subtle-danger', { type: 'button', onClick: async () => (await deleteWithUndo('renewals', existing, { label: 'renewal reminder' })) && close() }, icon('trash', 15), 'Delete') : null,
    onSave: (v) => {
      store.put('renewals', {
        ...(existing || { history: [] }),
        kind,
        vehicleId: kind === 'vehicle' ? v.vehicleId : null,
        contactId: kind === 'contact' ? v.contactId : null,
        type: v.type,
        dueDate: v.dueDate || null,
        done: Boolean(existing?.done && !v.dueDate),
        repeat: v.repeats && v.repeatEvery ? { every: v.repeatEvery, unit: v.repeatUnit } : null,
        dueSoonDays: v.dueSoonDays,
        notes: v.notes,
      });
      toast(existing ? 'Renewal saved' : 'Renewal reminder added');
    },
  });
}

export { money };
