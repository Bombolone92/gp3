import { formPage } from '../ui/form.js';
import { app, lookup } from '../app.js';
import { navigate, back } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { INTERVAL_UNITS } from '../core/dates.js';
import { vehicleName } from '../core/format.js';
import { options, emptyPage } from './common.js';
import { quickTask } from './line-items.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('reminders', ctx.params.id) : null;
  if (ctx.params.id && !existing) return emptyPage('Reminder not found', 'It may have been deleted.');
  const s = app.settings();
  const v0 = lookup.vehicle(existing?.vehicleId || ctx.query.vehicle);
  const rec = existing
    ? { ...existing, every: existing.interval?.every ?? null, unit: existing.interval?.unit || 'months', byTime: Boolean(existing.interval?.every), byMeter: Boolean(existing.meterInterval) }
    : { vehicleIds: ctx.query.vehicle ? [ctx.query.vehicle] : [], every: 6, unit: 'months', byTime: true, byMeter: true, meterInterval: 5000, lastDate: app.today(), lastMeter: v0?.meter ?? null };
  let meterTouched = false;
  // Counted by meter alone, a reminder with no meter to count from never
  // comes due.
  const startMeterError = (m, all) => {
    if (!all.byMeter || all.byTime) return null;
    if (existing) return m == null ? 'Enter the meter this was last done at.' : null;
    if (m != null && meterTouched) return null;
    const none = (all.vehicleIds || []).map((vid) => lookup.vehicle(vid)).find((veh) => veh && (veh.meter == null || veh.meter === ''));
    return none ? `${vehicleName(none)} has no meter reading yet. Enter the meter this was last done at.` : null;
  };
  const page = formPage({
    title: existing ? 'Edit service reminder' : 'New service reminder',
    crumbs: [{ label: 'Service reminders', href: '#/reminders' }, { label: existing ? lookup.taskName(existing.taskId) || 'Reminder' : 'New' }],
    record: rec,
    saveLabel: existing ? 'Save reminder' : 'Add reminder',
    sections: [
      {
        id: 'what',
        title: 'Vehicle and task',
        fields: [
          existing ? { id: 'vehicleId', label: 'Vehicle', type: 'picker', required: true, options: options.vehicles({ keep: rec.vehicleId }), span: 2 } : { id: 'vehicleIds', label: 'Vehicles', type: 'multipicker', required: true, options: options.vehicles({ keep: rec.vehicleIds }), span: 2, hint: 'Add several vehicles to create one reminder for each.' },
          { id: 'taskId', label: 'Service task', type: 'picker', required: true, options: options.tasks(rec.taskId), span: 2, create: { label: (q) => (q ? `Create task "${q}"` : 'Create a new service task'), run: (q, done) => quickTask(q).then((t) => t && done(t.id)) } },
        ],
      },
      {
        id: 'schedule',
        title: 'Schedule',
        intro: 'Due when either the time or the meter interval is reached, whichever comes first.',
        fields: [
          { id: 'byTime', label: 'By time', type: 'switch', checkLabel: 'Repeat on a time interval', span: 2 },
          { id: 'every', label: 'Every', type: 'number', min: 1, show: (v) => v.byTime, validate: (v, all) => (all.byTime && !v ? 'Enter how often.' : null) },
          { id: 'unit', label: 'Unit', type: 'select', required: true, options: () => INTERVAL_UNITS.map((u) => ({ value: u.id, label: u.label })), show: (v) => v.byTime },
          { id: 'byMeter', label: 'By meter', type: 'switch', checkLabel: 'Repeat on a meter interval', span: 2, validate: (v, all) => (!v && !all.byTime ? 'Turn on a time interval, a meter interval, or both.' : null) },
          { id: 'meterInterval', label: 'Every', type: 'number', min: 1, unit: 'mi, km, or hr', show: (v) => v.byMeter, validate: (v, all) => (all.byMeter && !v ? 'Enter the meter interval.' : null) },
        ],
      },
      {
        id: 'start',
        title: 'Last completed',
        intro: 'The schedule counts from the last time this was done. Use today and the current meter if you do not know.',
        fields: [
          { id: 'lastDate', label: 'Last completed on', type: 'date' },
          { id: 'lastMeter', label: 'At meter', type: 'number', min: 0, hint: existing ? null : "Leave empty to use each vehicle's current meter.", validate: startMeterError },
        ],
      },
      {
        id: 'alerts',
        title: 'Due soon threshold',
        fields: [
          { id: 'dueSoonDays', label: 'Days before', type: 'number', min: 0, placeholder: String(s.dueSoon.days), hint: 'Leave empty to use the fleet default.' },
          { id: 'dueSoonMeter', label: 'Meter before', type: 'number', min: 0, placeholder: String(s.dueSoon.meter) },
        ],
      },
    ],
    onChange: (v, fid) => {
      if (fid === 'lastMeter') meterTouched = true;
    },
    onCancel: () => back(existing ? `/reminders/${existing.id}` : '/reminders'),
    onSave: (v) => {
      const base = {
        taskId: v.taskId,
        interval: v.byTime && v.every ? { every: v.every, unit: v.unit } : null,
        meterInterval: v.byMeter ? v.meterInterval : null,
        lastDate: v.lastDate || null,
        lastMeter: v.lastMeter,
        dueSoonDays: v.dueSoonDays,
        dueSoonMeter: v.dueSoonMeter,
      };
      if (existing) {
        // Build on the stored reminder: a service entry may have completed
        // it while the form was open.
        const cur = store.get('reminders', existing.id);
        if (!cur) {
          toast('This reminder was deleted, so the changes were not saved.', { type: 'error' });
          return false;
        }
        // A one-time next due override stays unless the schedule it overrides changed.
        const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
        const startKept = same(base.lastDate, existing.lastDate || null) && same(base.lastMeter, existing.lastMeter);
        const keep = v.vehicleId === existing.vehicleId && same(base.interval, existing.interval?.every ? existing.interval : null) && same(base.meterInterval, existing.meterInterval || null) && startKept;
        // Unless the last completion was edited here, keep the one recorded meanwhile.
        if (startKept) Object.assign(base, { lastDate: cur.lastDate ?? null, lastMeter: cur.lastMeter ?? null });
        store.put('reminders', { ...cur, ...base, vehicleId: v.vehicleId, nextDate: keep ? cur.nextDate ?? null : null, nextMeter: keep ? cur.nextMeter ?? null : null });
        page.form.markClean();
        toast('Reminder saved');
        navigate(`/reminders/${existing.id}`);
        return;
      }
      // The prefilled meter is the first vehicle's; unless one was typed,
      // each vehicle counts from its own current meter.
      const meterOf = (vid) => (meterTouched && v.lastMeter != null ? v.lastMeter : (lookup.vehicle(vid)?.meter ?? null));
      const made = v.vehicleIds.map((vid) => store.put('reminders', { ...base, vehicleId: vid, programId: null, history: [], lastMeter: meterOf(vid), startDate: base.lastDate, startMeter: meterOf(vid) }));
      page.form.markClean();
      toast(made.length === 1 ? `Reminder added for ${vehicleName(lookup.vehicle(made[0].vehicleId))}` : `${made.length} reminders added`);
      navigate(made.length === 1 ? `/reminders/${made[0].id}` : '/reminders', { replace: true });
    },
  });
  return { node: page.node, title: existing ? 'Edit reminder' : 'New reminder', dirty: () => page.form.dirty() };
}
