import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { openFormDialog } from '../ui/form.js';
import { app, lookup, canEdit } from '../app.js';
import { vehicleName, contactName } from '../core/format.js';
import { formatDate, diffDays } from '../core/dates.js';
import { assignVehicle, syncOperator, recordMeter, recomputeVehicleMeter } from '../core/actions.js';
import { toast } from '../ui/toast.js';
import { pill } from '../ui/components.js';
import { vehicleCell, contactCell, options, dash, deleteWithUndo, meterText, meterUnitLabel } from './common.js';

export function render(ctx) {
  const editable = canEdit('assignments');
  const today = app.today();
  const current = (a) => a.start <= today && (!a.end || a.end >= today);
  // Days so far, or planned days for one that has not started (none if open-ended).
  const days = (a) => (a.start > today ? (a.end ? diffDays(a.start, a.end) + 1 : null) : diffDays(a.start, a.end && a.end < today ? a.end : today) + 1);
  return renderList(ctx, {
    key: 'assignments',
    title: 'Vehicle assignments',
    intro: 'Who drives what, and when.',
    coll: 'assignments',
    watch: ['vehicles', 'contacts'],
    csvName: 'assignments',
    actions: editable ? [h('button.btn.primary', { type: 'button', onClick: () => openAssignmentDialog({}) }, icon('user-plus', 16), 'Add assignment')] : [],
    tabs: [
      { id: 'current', label: 'Current', filter: current },
      { id: 'upcoming', label: 'Upcoming', filter: (a) => a.start > today },
      { id: 'past', label: 'Past', filter: (a) => a.end && a.end < today },
      { id: 'all', label: 'All' },
    ],
    filters: [fieldFilter('vehicle', 'Vehicle', 'vehicleId', options.vehicles({ includeArchived: true })), fieldFilter('contact', 'Operator', 'contactId', options.contacts())],
    defaultSort: { id: 'start', dir: 'desc' },
    search: (a) => [vehicleName(lookup.vehicle(a.vehicleId)), contactName(lookup.contact(a.contactId)), a.notes].join(' '),
    columns: [
      { id: 'vehicle', label: 'Vehicle', render: (a) => vehicleCell(a.vehicleId), sort: (a) => vehicleName(lookup.vehicle(a.vehicleId)), csv: (a) => vehicleName(lookup.vehicle(a.vehicleId)) },
      { id: 'contact', label: 'Operator', render: (a) => contactCell(a.contactId), sort: (a) => contactName(lookup.contact(a.contactId)), csv: (a) => contactName(lookup.contact(a.contactId)) },
      { id: 'start', label: 'Start', render: (a) => formatDate(a.start), sort: (a) => a.start },
      { id: 'end', label: 'End', render: (a) => (a.end ? formatDate(a.end) : current(a) ? pill('Current', 'green') : dash()), sort: (a) => a.end || '9999-12-31' },
      { id: 'duration', label: 'Duration', render: (a) => (days(a) === null ? dash() : `${days(a)} day${days(a) === 1 ? '' : 's'}`), sort: days },
      { id: 'meters', label: 'Meter', render: (a) => [a.startMeter != null ? meterText(a.startMeter, lookup.vehicle(a.vehicleId)) : '', a.endMeter != null ? meterText(a.endMeter, lookup.vehicle(a.vehicleId)) : ''].filter(Boolean).join(' to ') || dash() },
      editable ? { id: 'edit', label: '', srLabel: 'Actions', fixed: true, render: (a) => h('button.link-btn', { type: 'button', onClick: () => openAssignmentDialog(a) }, 'Edit') } : null,
    ].filter(Boolean),
    // On a phone the table is hidden, so the card opens the assignment.
    rowClick: editable ? (a) => openAssignmentDialog(a) : null,
    mobile: (a) => h('div.grow', h('strong', vehicleName(lookup.vehicle(a.vehicleId))), h('div.subtle', `${contactName(lookup.contact(a.contactId))} · ${formatDate(a.start)}${a.end ? ` to ${formatDate(a.end)}` : ''}`)),
    empty: { icon: 'user-plus', title: 'No assignments', text: 'Assign vehicles to operators to know who is responsible for each one.' },
  });
}

/** The readings an assignment recorded at its start and end. */
const meterSources = (id) => [`${id}-start`, `${id}-end`];

/** Meter readings recorded by any of these assignments. */
export function assignmentReadings(store, ids) {
  const sources = new Set(ids.flatMap(meterSources));
  return store.all('meters').filter((m) => m.source?.type === 'assignment' && sources.has(m.source.id));
}

/** Another assignment of the same vehicle whose dates overlap these, if any. */
function overlapping(store, vals, existing) {
  if (!vals.vehicleId || !vals.start) return null;
  // Dates saved before overlaps were refused may stay as they are.
  if (existing && vals.vehicleId === existing.vehicleId && vals.start === existing.start && (vals.end || null) === (existing.end || null)) return null;
  const end = vals.end || '9999-12-31';
  return (
    store.all('assignments').find(
      (x) =>
        x.vehicleId === vals.vehicleId &&
        x.id !== existing?.id &&
        x.start <= end &&
        (x.end || '9999-12-31') >= vals.start &&
        // A new assignment ends the open one that started before it.
        !(!existing && !x.end && x.start < vals.start),
    ) || null
  );
}

export function openAssignmentDialog(rec = {}) {
  const store = app.store;
  const existing = rec.id ? store.get('assignments', rec.id) : null;
  const unit = (vals) => meterUnitLabel(lookup.vehicle(vals?.vehicleId ?? rec.vehicleId));
  return openFormDialog({
    title: existing ? 'Edit assignment' : 'Assign vehicle',
    intro: existing ? null : 'Any open assignment of this vehicle that started earlier ends the day before this one starts.',
    record: { start: app.today(), ...rec },
    fields: [
      { id: 'vehicleId', label: 'Vehicle', type: 'picker', required: true, options: options.vehicles({ keep: rec.vehicleId }), span: 2 },
      { id: 'contactId', label: 'Operator', type: 'picker', required: true, options: options.contacts(null, rec.contactId), span: 2 },
      {
        id: 'start',
        label: 'Start date',
        type: 'date',
        required: true,
        validate: (v, vals) => {
          const o = overlapping(store, vals, existing);
          return o ? `This overlaps the assignment to ${contactName(lookup.contact(o.contactId)) || 'another operator'} from ${formatDate(o.start)}${o.end ? ` to ${formatDate(o.end)}` : ''}.` : null;
        },
      },
      { id: 'end', label: 'End date', type: 'date', validate: (v, vals) => (v && v < vals.start ? 'The end must be on or after the start.' : null) },
      // Readings take the assignment's dates; a future one would become the vehicle's meter.
      { id: 'startMeter', label: 'Starting meter', type: 'number', min: 0, unit, validate: (v, vals) => (v !== null && vals.start > app.today() ? 'Enter the starting meter once the assignment has started.' : null) },
      { id: 'endMeter', label: 'Ending meter', type: 'number', min: 0, unit, validate: (v, vals) => (v !== null && vals.end && vals.end > app.today() ? 'Enter the ending meter once the assignment has ended.' : null) },
      { id: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 2 },
    ],
    extraFooter: existing
      ? ({ close }) =>
          h(
            'button.btn.subtle-danger',
            {
              type: 'button',
              onClick: async () => {
                const done = await deleteWithUndo('assignments', existing, {
                  label: 'assignment',
                  // Its readings go too: with no assignment they could not be edited or voided.
                  extra: () => {
                    const readings = assignmentReadings(store, [existing.id]);
                    for (const m of readings) store.remove('meters', m.id);
                    recomputeVehicleMeter(store, existing.vehicleId);
                    syncOperator(store, existing.vehicleId, app.today());
                    return readings;
                  },
                  onUndo: (a, readings) => {
                    for (const m of readings) store.restore('meters', m);
                    recomputeVehicleMeter(store, a.vehicleId);
                    syncOperator(store, a.vehicleId, app.today());
                  },
                });
                if (done) close();
              },
            },
            icon('trash', 15),
            'Delete',
          )
      : null,
    onSave: (v) => {
      const today = app.today();
      const rec2 = assignVehicle(store, { ...(existing || {}), ...v, end: v.end || null }, today);
      if (existing && existing.vehicleId !== v.vehicleId) syncOperator(store, existing.vehicleId, today);
      // A cleared meter (or end date) removes the reading recorded earlier.
      const [startId, endId] = meterSources(rec2.id);
      recordMeter(store, { vehicleId: v.vehicleId, value: v.startMeter, date: v.start, source: { type: 'assignment', id: startId } });
      recordMeter(store, { vehicleId: v.vehicleId, value: v.end ? v.endMeter : null, date: v.end, source: { type: 'assignment', id: endId } });
      toast(existing ? 'Assignment saved' : `${vehicleName(lookup.vehicle(v.vehicleId))} assigned to ${contactName(lookup.contact(v.contactId))}`);
    },
  });
}
