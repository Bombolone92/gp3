/** Edit one visit of a job (date, time, crew, notes, done). */
import { h } from '../ui/dom.js';
import { app } from '../app.js';
import { openDialog, confirmDialog } from '../ui/dialog.js';
import { field, textInput, textarea } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { assigneePicker } from './common.js';
import { newId } from '../core/ids.js';
import { minutesToTime, timeToMinutes } from '../core/dates.js';

/**
 * visitId null = add a new visit to the job.
 * defaults: { date, start, end } for new visits (e.g. from a calendar click).
 */
export function visitDialog(jobId, visitId = null, defaults = {}) {
  const store = app.store;
  const job = store.get('jobs', jobId);
  if (!job) return;
  const existing = visitId ? job.visits.find((v) => v.id === visitId) : null;
  const v = existing
    ? // Scheduling an undated visit (from the Unscheduled list): start on the day in view.
      { ...structuredClone(existing), date: existing.date || defaults.date || null }
    : {
        id: newId(),
        date: defaults.date || app.today(),
        start: defaults.start ?? job.schedule?.startTime ?? '09:00',
        end: defaults.end ?? job.schedule?.endTime ?? '10:00',
        assignees: [...(job.assignees || [])],
        completedAt: null,
        notes: '',
      };
  const date = textInput({ type: 'date', value: v.date || '' });
  const start = textInput({ type: 'time', value: v.start || '', step: 900 });
  const end = textInput({ type: 'time', value: v.end || '', step: 900 });
  start.addEventListener('input', () => {
    const len = (timeToMinutes(v.end) ?? 0) - (timeToMinutes(v.start) ?? 0);
    v.start = start.value;
    if (len > 0 && start.value) end.value = v.end = minutesToTime(timeToMinutes(start.value) + len);
  });
  end.addEventListener('input', () => (v.end = end.value));
  const notes = textarea({ value: v.notes || '', rows: 3, placeholder: 'Anything specific to this visit' });
  const done = h('input', { type: 'checkbox', checked: !!v.completedAt });
  const team = assigneePicker(v.assignees, () => {});

  openDialog({
    title: existing ? `Visit for job #${job.number}` : `Add a visit to job #${job.number}`,
    body: h(
      'div.stack',
      h('p.muted', job.title || ''),
      h('div.form-grid.three', field('Date', date), field('Start', start), field('End', end)),
      h('div.field', h('span.field-label', 'Team'), team),
      field('Visit notes', notes),
      h('label.check', done, 'Completed'),
    ),
    footer: ({ close }) => [
      existing
        ? h(
            'button.btn.ghost.subtle-danger',
            {
              type: 'button',
              onClick: async () => {
                close();
                if (!(await confirmDialog({ title: 'Delete this visit?', message: 'The visit is removed from the job and the schedule.', confirmLabel: 'Delete visit', danger: true }))) return;
                const before = structuredClone(store.get('jobs', jobId));
                store.patch('jobs', jobId, (j) => ((j.visits = j.visits.filter((x) => x.id !== v.id)), j));
                toast('Visit deleted', { action: { label: 'Undo', run: () => store.put('jobs', before) } });
              },
            },
            'Delete',
          )
        : null,
      h('div.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'),
      h(
        'button.btn.primary',
        {
          type: 'button',
          onClick: () => {
            if (!date.value) {
              date.setAttribute('aria-invalid', 'true');
              date.focus();
              return;
            }
            if (start.value && end.value && end.value <= start.value) {
              end.setAttribute('aria-invalid', 'true');
              end.focus();
              toast('The end time must be after the start time.', { type: 'error' });
              return;
            }
            store.patch('jobs', jobId, (j) => {
              // On top of the visit as it is now: it may have been invoiced
              // (or changed otherwise) on another device while this was open.
              const cur = (j.visits || []).find((x) => x.id === v.id) || v;
              const next = {
                ...cur,
                date: date.value,
                start: start.value,
                end: end.value,
                assignees: v.assignees,
                notes: notes.value,
                completedAt: done.checked ? cur.completedAt || v.completedAt || new Date().toISOString() : null,
              };
              // An open, dated visit schedules the job: its undated placeholder goes.
              const others = (j.visits || []).filter((x) => x.id !== v.id && (x.date || x.completedAt || next.completedAt));
              j.visits = [...others, next].sort((a, b) => (a.date || '9').localeCompare(b.date || '9'));
              return j;
            });
            toast(existing ? 'Visit updated' : 'Visit added');
            close();
          },
        },
        existing ? 'Save visit' : 'Add visit',
      ),
    ],
  });
}
