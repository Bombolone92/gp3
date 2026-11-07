import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { openFormDialog } from '../ui/form.js';
import { app, lookup, canEdit, canDelete } from '../app.js';
import { vehicleName } from '../core/format.js';
import { formatDate } from '../core/dates.js';
import { recordMeter, meterWarnings, recomputeVehicleMeter } from '../core/actions.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { pill } from '../ui/components.js';
import { vehicleCell, meterText, options, dash, meterUnitLabel, sourceLink } from './common.js';

export function render(ctx) {
  const store = app.store;
  const editable = canEdit('meters');
  const list = renderList(ctx, {
    key: 'meters',
    title: 'Meter history',
    coll: 'meters',
    watch: ['vehicles'],
    csvName: 'meter-history',
    actions: editable ? [h('button.btn.primary', { type: 'button', onClick: () => openMeterDialog({}) }, icon('plus', 16), 'Add reading')] : [],
    tabs: [
      { id: 'all', label: 'All', filter: (m) => !m.void },
      { id: 'manual', label: 'Manual', filter: (m) => !m.void && !m.source },
      { id: 'void', label: 'Void', filter: (m) => m.void },
    ],
    filters: [
      fieldFilter('vehicle', 'Vehicle', 'vehicleId', options.vehicles({ includeArchived: true })),
      fieldFilter('source', 'Source', (m) => m.source?.type || 'manual', () => [
        { value: 'manual', label: 'Manual' },
        { value: 'fuel', label: 'Fuel entry' },
        { value: 'service', label: 'Service entry' },
        { value: 'inspection', label: 'Inspection' },
        { value: 'assignment', label: 'Assignment' },
      ]),
    ],
    defaultSort: { id: 'date', dir: 'desc' },
    search: (m) => [vehicleName(lookup.vehicle(m.vehicleId)), m.value, m.note].join(' '),
    columns: [
      { id: 'vehicle', label: 'Vehicle', render: (m) => vehicleCell(m.vehicleId), sort: (m) => vehicleName(lookup.vehicle(m.vehicleId)), csv: (m) => vehicleName(lookup.vehicle(m.vehicleId)) },
      { id: 'date', label: 'Date', render: (m) => formatDate(m.date), sort: (m) => `${m.date}${String(m.value).padStart(12, '0')}`, csv: (m) => m.date },
      { id: 'value', label: 'Reading', align: 'r', render: (m) => h(`span.num${m.void ? '.struck' : ''}`, meterText(m.value, lookup.vehicle(m.vehicleId))), sort: (m) => Number(m.value) },
      { id: 'source', label: 'Source', render: (m) => sourceLink(m), sort: (m) => m.source?.type || 'manual' },
      { id: 'note', label: 'Note', render: (m) => (m.void ? pill('Void', 'gray') : m.note || dash()), sort: (m) => m.note || '' },
      editable ? { id: 'actions', label: '', srLabel: 'Actions', fixed: true, render: (m) => (!m.source ? h('button.link-btn', { type: 'button', onClick: () => openMeterDialog(m) }, 'Edit') : '') } : null,
    ].filter(Boolean),
    mobile: (m) => h('div.grow', h('div.row', h('strong.grow.truncate', vehicleName(lookup.vehicle(m.vehicleId))), h('span.num', meterText(m.value, lookup.vehicle(m.vehicleId)))), h('div.subtle', `${formatDate(m.date)} · ${sourceLink(m).textContent ?? sourceLink(m)}`)),
    empty: { icon: 'gauge', title: 'No meter readings yet', text: 'Readings come from fuel entries, service, and inspections, or you can add them here.' },
  });
  if (ctx.query.new && editable) setTimeout(() => openMeterDialog({ vehicleId: ctx.query.vehicle || null }));
  return list;
}

/** Add or edit a manual meter reading. */
export function openMeterDialog(rec = {}) {
  const store = app.store;
  const existing = rec.id ? store.get('meters', rec.id) : null;
  // Follows the vehicle picked in the form (an hour meter reads "hr").
  const unit = (vals) => meterUnitLabel(lookup.vehicle(vals?.vehicleId ?? rec.vehicleId));
  const warn = h('div.form-warning', { role: 'status', 'aria-live': 'polite' });
  return openFormDialog({
    title: existing ? 'Edit meter reading' : 'Add meter reading',
    record: { date: app.today(), ...rec },
    fields: [
      { id: 'vehicleId', label: 'Vehicle', type: 'picker', required: true, options: options.vehicles({ keep: rec.vehicleId }), span: 2 },
      { id: 'value', label: 'Reading', type: 'number', required: true, min: 0, unit },
      // A future date would make the reading the vehicle's meter until that day.
      { id: 'date', label: 'Date', type: 'date', required: true, validate: (v) => (v > app.today() ? 'The date cannot be in the future.' : null) },
      { id: 'note', label: 'Note', span: 2 },
      existing ? { id: 'void', label: 'Void', type: 'checkbox', checkLabel: 'Void this reading (keeps it, but ignores it)', span: 2 } : null,
    ].filter(Boolean),
    onChange: (vals) => {
      const w = meterWarnings(store, { vehicleId: vals.vehicleId, value: vals.value, date: vals.date, ignoreId: existing?.id });
      warn.replaceChildren(...w.map((t) => h('p', icon('warning', 15), t)));
    },
    extraFooter: existing && canDelete('meters')
      ? ({ close }) =>
          h(
            'button.btn.subtle-danger',
            {
              type: 'button',
              onClick: async () => {
                if (!(await confirmDialog({ title: 'Delete reading?', message: 'The vehicle meter is recalculated from its other readings.', confirmLabel: 'Delete', danger: true }))) return;
                store.remove('meters', existing.id);
                recomputeVehicleMeter(store, existing.vehicleId);
                close();
                toast('Reading deleted');
              },
            },
            icon('trash', 15),
            'Delete',
          )
      : null,
    after: warn,
    onSave: (v) => {
      if (existing) {
        store.put('meters', { ...existing, vehicleId: v.vehicleId, value: v.value, date: v.date, note: v.note, void: v.void });
        recomputeVehicleMeter(store, v.vehicleId);
        if (existing.vehicleId !== v.vehicleId) recomputeVehicleMeter(store, existing.vehicleId);
      } else {
        recordMeter(store, { vehicleId: v.vehicleId, value: v.value, date: v.date, note: v.note });
      }
      toast(existing ? 'Reading saved' : 'Reading added');
    },
  });
}
