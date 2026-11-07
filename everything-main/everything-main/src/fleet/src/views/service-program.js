import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { formPage, picker, multiPicker } from '../ui/form.js';
import { app, lookup, canEdit } from '../app.js';
import { navigate, back } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { newId } from '../core/ids.js';
import { INTERVAL_UNITS } from '../core/dates.js';
import { parseDecimal } from '../core/money.js';
import { syncProgramReminders, removeProgram } from '../core/actions.js';
import { options, emptyPage } from './common.js';
import { quickTask } from './line-items.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('servicePrograms', ctx.params.id) : null;
  if (ctx.params.id && !existing) return emptyPage('Program not found', 'It may have been deleted.');
  let schedules = structuredClone(existing?.schedules || [{ id: newId(), taskId: null, interval: { every: 6, unit: 'months' }, meterInterval: 5000 }]);

  const list = h('div.sched-list');
  function draw() {
    list.replaceChildren(
      ...schedules.map((s, i) => {
        const task = picker({ label: `Task ${i + 1}`, placeholder: 'Choose a service task', items: options.tasks(), value: s.taskId, allowClear: false, create: { label: (q) => (q ? `Create task "${q}"` : 'Create a new task'), run: (q, done) => quickTask(q).then((t) => t && ((s.taskId = t.id), done(t.id))) }, onChange: (v) => (s.taskId = v) });
        const every = h('input.input.sm.num', { type: 'text', inputmode: 'numeric', value: s.interval?.every ?? '', 'aria-label': `Time interval for task ${i + 1}`, placeholder: 'None' });
        const unit = h('select.select.sm', { 'aria-label': `Interval unit for task ${i + 1}` }, INTERVAL_UNITS.map((u) => h('option', { value: u.id }, u.label)));
        unit.value = s.interval?.unit || 'months';
        const meter = h('input.input.sm.num', { type: 'text', inputmode: 'numeric', value: s.meterInterval ?? '', 'aria-label': `Meter interval for task ${i + 1}`, placeholder: 'None' });
        // Intervals are whole numbers above zero; anything else means none.
        const whole = (el) => {
          const n = parseDecimal(el.value);
          const ok = Number.isInteger(n) && n > 0;
          ok || !el.value.trim() ? el.removeAttribute('aria-invalid') : el.setAttribute('aria-invalid', 'true');
          return ok ? n : null;
        };
        const upd = () => {
          const n = whole(every);
          s.interval = n ? { every: n, unit: unit.value } : null;
          s.meterInterval = whole(meter);
        };
        every.addEventListener('input', upd);
        unit.addEventListener('change', upd);
        meter.addEventListener('input', upd);
        return h(
          'div.sched-row',
          h('div.sched-task', task),
          h('div.sched-int', h('span.subtle', 'Every'), every, unit),
          h('div.sched-int', h('span.subtle', 'or every'), meter, h('span.subtle', 'mi / km / hr')),
          h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove task ${i + 1}`, onClick: () => (schedules.splice(i, 1), draw()) }, icon('trash', 15)),
        );
      }),
      h('button.btn.sm', { type: 'button', onClick: () => (schedules.push({ id: newId(), taskId: null, interval: { every: 12, unit: 'months' }, meterInterval: null }), draw()) }, icon('plus', 15), 'Add task'),
    );
  }
  draw();
  // Archived vehicles already in the program keep their name; new ones come from the active list.
  const inProgram = new Set(existing?.vehicleIds || []);
  const vehicleItems = () => options.vehicles({ includeArchived: true })().filter((o) => !lookup.vehicle(o.value)?.archived || inProgram.has(o.value));
  const vehicles = multiPicker({ items: vehicleItems, value: existing?.vehicleIds || [], label: 'Vehicles', placeholder: 'Add vehicle' });
  const page = formPage({
    title: existing ? existing.name : 'New service program',
    crumbs: [{ label: 'Service programs', href: '#/service-programs' }, { label: existing ? existing.name : 'New' }],
    record: existing || {},
    saveLabel: existing ? 'Save program' : 'Create program',
    extraActions: existing && canEdit('servicePrograms')
      ? h('button.btn.subtle-danger', {
          type: 'button',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Delete program?', message: 'Its reminders are removed from every vehicle. Completed service history is kept.', confirmLabel: 'Delete program', danger: true }))) return;
            removeProgram(store, existing, app.today());
            page.form.markClean();
            toast('Program deleted');
            navigate('/service-programs');
          },
        }, icon('trash', 15), 'Delete')
      : null,
    sections: [
      { id: 'about', title: 'Program', fields: [{ id: 'name', label: 'Name', required: true, span: 2, placeholder: 'e.g. Light duty maintenance' }, { id: 'description', label: 'Description', type: 'textarea', rows: 2, span: 2 }] },
      { id: 'schedules', title: 'Schedules', intro: 'Each task is due by time, by meter, or whichever comes first.', fields: [{ id: 'sched', label: 'Schedules', type: 'custom', noLabel: true, span: 2, render: () => Object.defineProperty(list, 'value', { get: () => JSON.stringify(schedules), configurable: true }) }] },
      { id: 'vehicles', title: 'Vehicles', intro: 'Every vehicle here gets a reminder for each task, counted from today and its current meter.', fields: [{ id: 'veh', label: 'Vehicles', type: 'custom', noLabel: true, span: 2, render: () => vehicles }] },
    ],
    onCancel: () => back('/service-programs'),
    onSave: (v) => {
      // Build on the stored record, not the one the form opened with: files
      // and other changes may have arrived meanwhile.
      const cur = existing && store.get('servicePrograms', existing.id);
      if (existing && !cur) {
        toast('This program was deleted, so the changes were not saved.', { type: 'error' });
        return false;
      }
      const valid = schedules.filter((s) => s.taskId && (s.interval?.every || s.meterInterval));
      if (!valid.length) {
        toast('Add at least one task with an interval.', { type: 'error' });
        return false;
      }
      const program = store.put('servicePrograms', { ...(cur || { archived: false }), name: v.name, description: v.description, schedules: valid, vehicleIds: vehicles.value });
      syncProgramReminders(store, program, app.today());
      page.form.markClean();
      toast(existing ? 'Program saved. Reminders updated.' : `Program created with ${valid.length * vehicles.value.length} reminders`);
      navigate('/service-programs');
    },
  });
  return { node: page.node, title: existing ? existing.name : 'New program', dirty: () => page.form.dirty() };
}

export { lookup };
