import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit } from '../app.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { openFormDialog } from '../ui/form.js';
import { formatDate, addDays } from '../core/dates.js';
import { reminderState, reminderNextDue, describeSchedule, compliance } from '../core/reminders.js';
import { statusPill, pill } from '../ui/components.js';
import { detailHeader, kvList, sectionCard, vehicleCell, emptyPage, moreMenuButton, meterText, deleteWithUndo, simpleTable, dueText } from './common.js';
import { resolveReminder } from './reminders.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  if (!store.get('reminders', id)) return emptyPage('Reminder not found', 'It may have been deleted.');
  const get = () => store.get('reminders', id);
  const editable = canEdit('reminders');
  const node = ctx.live(() => {
    const r = get();
    if (!r) return null;
    const v = lookup.vehicle(r.vehicleId);
    const today = app.today();
    const st = reminderState(r, v, today, app.settings());
    const comp = compliance(r);
    const program = store.get('servicePrograms', r.programId);
    return h(
      'div',
      detailHeader({
        back: { label: 'Service reminders', href: '#/reminders' },
        title: lookup.taskName(r.taskId) || 'Service reminder',
        meta: [statusPill('reminder', st.status), vehicleCell(r.vehicleId, { sub: false }), h('span.subtle', describeSchedule(r, v?.meterUnit))],
        actions: editable
          ? [
              h('button.btn.primary', { type: 'button', onClick: () => resolveReminder(r) }, icon('circle-check', 16), 'Resolve'),
              h('a.btn', { href: `#/reminders/${id}/edit` }, icon('pencil', 15), 'Edit'),
              moreMenuButton([
                st.status === 'snoozed'
                  ? { label: 'Unsnooze', icon: 'bell', run: () => (store.patch('reminders', id, { snoozedUntil: null }), toast('Reminder unsnoozed')) }
                  : { label: 'Snooze', icon: 'bell-off', run: () => snooze(r) },
                { label: 'Change next due', icon: 'calendar', run: () => override(r, st) },
                { label: 'Delete reminder', icon: 'trash', danger: true, run: () => deleteWithUndo('reminders', r, { label: 'reminder', message: program ? `This reminder comes from the ${program.name} program. Deleting it here only removes it from this vehicle.` : null, onDeleted: () => navigate('/reminders') }) },
              ]),
            ]
          : [],
      }),
      h(
        'div.two-col',
        h(
          'div.col',
          sectionCard('Next due', kvList([
            ['Status', statusPill('reminder', st.status)],
            ['Due date', st.nextDate ? formatDate(st.nextDate) : null],
            ['Due meter', st.nextMeter != null ? meterText(st.nextMeter, v) : null],
            ['Remaining', dueText(st, v, today)],
            ['Current meter', v?.meter != null ? meterText(v.meter, v) : null],
            ['Snoozed until', r.snoozedUntil && r.snoozedUntil >= today ? formatDate(r.snoozedUntil) : null],
          ])),
          sectionCard('Schedule', kvList([
            ['Vehicle', vehicleCell(r.vehicleId)],
            ['Repeats', describeSchedule(r, v?.meterUnit)],
            ['Program', program ? h('a', { href: `#/service-programs/${program.id}` }, program.name) : 'None'],
            ['Last completed', r.lastDate ? `${formatDate(r.lastDate)}${r.lastMeter != null ? ` at ${meterText(r.lastMeter, v)}` : ''}` : null],
            ['Compliance', comp === null ? null : `${Math.round(comp * 100)}% on time`],
          ])),
        ),
        h(
          'div.col',
          h(
            'section.card.panel',
            h('div.card-head', h('h2.grow', 'Completion history')),
            h(
              'div.card-body.flush',
              simpleTable({
                rows: [...(r.history || [])].reverse(),
                caption: 'Completion history',
                empty: 'Not completed yet.',
                columns: [
                  { id: 'date', label: 'Completed', render: (x) => (store.get('serviceEntries', x.entryId) ? h('a', { href: `#/service/${x.entryId}` }, formatDate(x.date)) : formatDate(x.date)) },
                  { id: 'meter', label: 'Meter', align: 'r', render: (x) => (x.meter != null ? meterText(x.meter, v) : '-') },
                  { id: 'ontime', label: 'On time', render: (x) => (x.onTime ? pill('On time', 'green') : pill('Late', 'red')) },
                ],
              }),
            ),
          ),
        ),
      ),
    );
  }, ['reminders', 'vehicles', 'serviceTasks', 'servicePrograms', 'serviceEntries']);

  function snooze(r) {
    openFormDialog({
      title: 'Snooze reminder',
      intro: 'A snoozed reminder stays off the overdue and due soon lists until this date.',
      record: { until: addDays(app.today(), 14) },
      fields: [{ id: 'until', label: 'Snooze until', type: 'date', required: true, validate: (v) => (v <= app.today() ? 'Pick a date after today.' : null) }],
      saveLabel: 'Snooze',
      onSave: (v) => (store.patch('reminders', r.id, { snoozedUntil: v.until }), toast('Reminder snoozed')),
    });
  }

  function override(r, st) {
    openFormDialog({
      title: 'Change next due',
      intro: 'Sets the next due date or meter for this one time. After the next completion, the regular schedule applies again.',
      record: { nextDate: st.nextDate, nextMeter: st.nextMeter },
      fields: [
        { id: 'nextDate', label: 'Next due date', type: 'date' },
        { id: 'nextMeter', label: 'Next due meter', type: 'number', min: 0 },
      ],
      onSave: (v) => {
        // A value left at the regular schedule is not an override, so it keeps following the schedule.
        const regular = reminderNextDue({ ...r, nextDate: null, nextMeter: null });
        store.patch('reminders', r.id, { nextDate: !v.nextDate || v.nextDate === regular.nextDate ? null : v.nextDate, nextMeter: v.nextMeter == null || v.nextMeter === regular.nextMeter ? null : v.nextMeter });
        toast('Next due updated');
      },
    });
  }
  return { node: h('div.page.detail-page', node), title: lookup.taskName(get().taskId) || 'Reminder' };
}
