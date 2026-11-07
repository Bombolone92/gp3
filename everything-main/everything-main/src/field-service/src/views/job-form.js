/** New and edit job, including one-off and recurring scheduling. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, field, textInput, textarea, select, segmented, emptyState } from '../ui/components.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { clientPicker, propertySelect, lineItemsEditor, totalsBlock, assigneePicker } from './common.js';
import { createJob, buildVisits, defaultTaxRate, applyEdits } from '../core/workflow.js';
import { describeSchedule, generateVisitDates } from '../core/recurrence.js';
import { formatDate, timeToMinutes, minutesToTime, isISODate, isTime } from '../core/dates.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('jobs', ctx.params.id) : null;
  if (ctx.params.id && !existing) return h('div.page', emptyState({ icon: 'hammer', title: 'Job not found', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/jobs' }, 'Back to jobs')] }));

  const s = app.settings();
  const client0 = ctx.query.client ? store.get('clients', ctx.query.client) : null;
  const draft = existing
    ? structuredClone(existing)
    : {
        clientId: client0?.id || null,
        propertyId: client0?.properties?.[0]?.id || null,
        title: '',
        instructions: '',
        schedule: { start: isISODate(ctx.query.date) ? ctx.query.date : app.today(), repeat: 'none', startTime: isTime(ctx.query.time) ? ctx.query.time : '09:00', endTime: isTime(ctx.query.time) ? minutesToTime(timeToMinutes(ctx.query.time) + 120) : '11:00', anytime: false, interval: 1, weekdays: [], monthlyBy: 'day', end: { type: 'count', count: 12 } },
        assignees: ctx.query.member ? [ctx.query.member] : [],
        items: [],
        taxRate: defaultTaxRate(s),
        discount: null,
        billing: s.jobs?.defaultBilling || 'on_completion',
        notes: '',
      };
  draft.schedule ??= { start: null, repeat: 'none' };
  const sch = draft.schedule;
  sch.interval ??= 1;
  sch.weekdays ??= [];
  sch.monthlyBy ??= 'day';
  sch.end ??= { type: 'count', count: 12 };
  // A one-off job's visit may have been moved on the schedule since it was
  // booked: show where it is now, so saving does not move it back.
  const openOnes = existing && (sch.repeat || 'none') === 'none' ? (existing.visits || []).filter((v) => !v.completedAt && !v.invoiceId) : [];
  if (openOnes.length === 1 && openOnes[0].date) {
    const v = openOnes[0];
    Object.assign(sch, { start: v.date, anytime: !v.start }, v.start ? { startTime: v.start, endTime: v.end || '' } : {});
  }
  let unscheduled = !sch.start;
  if (unscheduled && ctx.query.schedule) {
    // Arrived here to schedule this job (after converting a quote or request).
    unscheduled = false;
    sch.start = app.today();
    sch.startTime ||= '09:00';
    sch.endTime ||= '11:00';
  }
  if (unscheduled) sch.start = null;
  let saved = false;

  // ---- Client and description ------------------------------------------------
  const propWrap = h('div');
  const drawProperty = () => {
    const sel = propertySelect(lookup.client(draft.clientId), draft.propertyId, (v) => (draft.propertyId = v));
    propWrap.replaceChildren(...(sel ? [field('Property', sel)] : []));
  };
  const clientError = h('span.error-text', { role: 'alert', hidden: true }, 'Choose the client for this job.');
  const picker = clientPicker({
    value: draft.clientId,
    autofocus: !existing && !draft.clientId,
    onChange: (c) => {
      draft.clientId = c?.id || null;
      draft.propertyId = c?.properties?.[0]?.id || null;
      clientError.hidden = true;
      drawProperty();
    },
  });
  drawProperty();
  const title = textInput({ value: draft.title, placeholder: 'e.g. Weekly lawn maintenance' });
  title.addEventListener('input', () => (draft.title = title.value));
  const instructions = textarea({ value: draft.instructions, rows: 3, placeholder: 'What the crew needs to know on site' });
  instructions.addEventListener('input', () => (draft.instructions = instructions.value));

  const clientCard = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Client and job')),
    h('div.card-body.stack', h('div.field', h('span.field-label', 'Client'), picker, clientError), propWrap, field('Job title', title), field('Instructions', instructions, { hint: 'Shown on every visit' })),
  );

  // ---- Details -------------------------------------------------------------
  const billing = select({
    value: draft.billing,
    options: [
      { value: 'on_completion', label: 'When the job is complete' },
      { value: 'per_visit', label: 'After each visit' },
      { value: 'none', label: 'Do not remind me' },
    ],
  });
  billing.addEventListener('change', () => (draft.billing = billing.value));
  const team = assigneePicker(draft.assignees, () => {});
  const detailsCard = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Job details')),
    h(
      'div.card-body.stack',
      h('dl.kv', h('dt', 'Job number'), h('dd', draft.number ? `#${draft.number}` : 'Assigned when saved')),
      h('div.field', h('span.field-label', 'Team'), team),
      field('Invoice reminder', billing, { hint: 'Jobs show as "Requires invoicing" at this point' }),
    ),
  );

  // ---- Schedule ------------------------------------------------------------
  const scheduleBody = h('div.schedule-builder');
  const preview = h('div.schedule-preview', { 'aria-live': 'polite' });

  function updatePreview() {
    if (unscheduled) {
      preview.textContent = 'This job will appear in the unscheduled list until you pick a date.';
      return;
    }
    const dates = generateVisitDates(sch);
    const kept = (existing?.visits || []).filter((v) => v.completedAt).length;
    if (sch.repeat === 'none') preview.textContent = `One visit on ${formatDate(sch.start, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`;
    else preview.textContent = `${describeSchedule(sch)}. ${dates.length} visit${dates.length === 1 ? '' : 's'}${dates.length ? `, ${formatDate(dates[0])} to ${formatDate(dates.at(-1))}` : ''}.${kept ? ` ${kept} completed visit${kept === 1 ? '' : 's'} stay as they are.` : ''}`;
  }

  function drawSchedule() {
    const type = segmented({
      label: 'Job type',
      value: sch.repeat === 'none' ? 'one' : 'recurring',
      items: [
        { value: 'one', label: 'One-off job', icon: 'calendar' },
        { value: 'recurring', label: 'Recurring job', icon: 'repeat' },
      ],
      onChange: (v) => {
        sch.repeat = v === 'one' ? 'none' : sch.repeat === 'none' ? 'weekly' : sch.repeat;
        if (v === 'recurring') unscheduled = false;
        if (!sch.start) sch.start = app.today();
        drawSchedule();
      },
    });

    const start = textInput({ type: 'date', value: sch.start || '', disabled: unscheduled || null });
    start.addEventListener('input', () => {
      sch.start = start.value || null;
      updatePreview();
    });
    const anytime = h('input', { type: 'checkbox', checked: !!sch.anytime });
    const startTime = textInput({ type: 'time', value: sch.startTime || '', disabled: sch.anytime || unscheduled || null, step: 900 });
    const endTime = textInput({ type: 'time', value: sch.endTime || '', disabled: sch.anytime || unscheduled || null, step: 900 });
    startTime.addEventListener('input', () => {
      const prevLen = (timeToMinutes(sch.endTime) ?? 0) - (timeToMinutes(sch.startTime) ?? 0);
      sch.startTime = startTime.value;
      // Keep the visit length when moving the start.
      if (prevLen > 0 && startTime.value) {
        sch.endTime = minutesToTime(timeToMinutes(startTime.value) + prevLen);
        endTime.value = sch.endTime;
      }
    });
    endTime.addEventListener('input', () => (sch.endTime = endTime.value));
    anytime.addEventListener('change', () => {
      sch.anytime = anytime.checked;
      startTime.disabled = endTime.disabled = anytime.checked;
    });

    const nodes = [type];
    if (sch.repeat === 'none') {
      const later = h('input', { type: 'checkbox', checked: unscheduled });
      later.addEventListener('change', () => {
        unscheduled = later.checked;
        if (!unscheduled && !sch.start) sch.start = app.today();
        drawSchedule();
      });
      nodes.push(h('label.check', later, 'Schedule later'));
    }
    nodes.push(
      h(
        'div.form-grid.three',
        field(sch.repeat === 'none' ? 'Date' : 'First visit', start),
        field('Start time', startTime),
        field('End time', endTime),
      ),
      h('label.check', anytime, 'Anytime that day (no set time)'),
    );

    if (sch.repeat !== 'none') {
      const freq = select({
        value: sch.repeat,
        options: [
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
          { value: 'yearly', label: 'Yearly' },
        ],
      });
      freq.addEventListener('change', () => {
        sch.repeat = freq.value;
        drawSchedule();
      });
      const interval = textInput({ type: 'number', min: 1, max: 52, value: String(sch.interval || 1), cls: 'num' });
      interval.addEventListener('input', () => {
        sch.interval = Math.max(1, Number(interval.value) || 1);
        updatePreview();
      });
      const unit = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }[sch.repeat];
      const intervalField = field('Repeat every', interval);
      const affix = h('div.input-affix.end-only');
      interval.replaceWith(affix);
      affix.append(interval, h('span.affix-end', unit));
      nodes.push(h('div.form-grid.three', field('Repeats', freq), intervalField));

      if (sch.repeat === 'weekly') {
        const wd = sch.weekdays.length ? sch.weekdays : sch.start ? [new Date(sch.start + 'T12:00').getDay()] : [1];
        sch.weekdays = [...wd];
        nodes.push(
          h(
            'div.field',
            h('span.field-label#wd-label', 'On these days'),
            h(
              'div.weekday-picker',
              { role: 'group', 'aria-labelledby': 'wd-label' },
              WEEKDAYS.map((d, i) =>
                h(
                  'button',
                  {
                    type: 'button',
                    'aria-pressed': String(sch.weekdays.includes(i)),
                    'aria-label': WEEKDAYS_LONG[i],
                    onClick: (e) => {
                      const on = sch.weekdays.includes(i);
                      if (on && sch.weekdays.length === 1) return;
                      sch.weekdays = on ? sch.weekdays.filter((x) => x !== i) : [...sch.weekdays, i].sort();
                      e.currentTarget.setAttribute('aria-pressed', String(!on));
                      updatePreview();
                    },
                  },
                  d,
                ),
              ),
            ),
          ),
        );
      }
      if (sch.repeat === 'monthly') {
        const by = select({
          value: sch.monthlyBy,
          options: [
            { value: 'day', label: 'On the same date each month' },
            { value: 'weekday', label: 'On the same weekday (e.g. second Tuesday)' },
          ],
        });
        by.addEventListener('change', () => {
          sch.monthlyBy = by.value;
          updatePreview();
        });
        nodes.push(field('Monthly on', by));
      }

      const endType = select({
        value: sch.end.type,
        options: [
          { value: 'count', label: 'After a number of visits' },
          { value: 'until', label: 'On a date' },
        ],
      });
      const count = textInput({ type: 'number', min: 1, max: 400, value: String(sch.end.count || 12), cls: 'num' });
      const until = textInput({ type: 'date', value: sch.end.date || '' });
      const endInput = h('div', sch.end.type === 'count' ? field('Number of visits', count) : field('Last date', until));
      endType.addEventListener('change', () => {
        sch.end = endType.value === 'count' ? { type: 'count', count: Number(count.value) || 12 } : { type: 'until', date: until.value || null };
        drawSchedule();
      });
      count.addEventListener('input', () => {
        sch.end = { type: 'count', count: Math.max(1, Math.min(400, Number(count.value) || 1)) };
        updatePreview();
      });
      until.addEventListener('input', () => {
        sch.end = { type: 'until', date: until.value };
        updatePreview();
      });
      nodes.push(h('div.form-grid', field('Ends', endType), endInput));
    }
    nodes.push(h('div.notice', icon('calendar-days'), preview));
    scheduleBody.replaceChildren(...nodes);
    updatePreview();
  }
  drawSchedule();

  const scheduleCard = h('section.card', h('div.card-head', h('h2.grow', 'Schedule')), h('div.card-body', scheduleBody));

  // ---- Items ---------------------------------------------------------------
  const totals = totalsBlock(draft, { editable: true });
  const items = lineItemsEditor(draft, { onChange: () => totals.refresh() });
  const itemsCard = h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Products and services'), h('span.subtle', { style: { fontSize: '13px' } }, draft.billing === 'per_visit' ? 'Billed per visit' : 'Billed once for the job')),
    h('div.card-body.flush', items, h('hr.divider'), totals),
  );
  billing.addEventListener('change', () => (itemsCard.querySelector('.card-head .subtle').textContent = draft.billing === 'per_visit' ? 'Billed per visit' : 'Billed once for the job'));

  const notes = textarea({ value: draft.notes || '', rows: 3, placeholder: 'Only visible to your team' });
  notes.addEventListener('input', () => (draft.notes = notes.value));
  const notesCard = h('section.card', h('div.card-head', h('h2.grow', 'Internal notes')), h('div.card-body', field('Notes', notes)));

  const saveBtn = h('button.btn.primary', { type: 'submit' }, existing ? 'Save changes' : 'Save job');
  const form = h(
    'form.doc-form',
    { novalidate: true },
    h('div.doc-top', clientCard, h('div.stack', { style: { gap: '16px' } }, detailsCard)),
    scheduleCard,
    itemsCard,
    notesCard,
    h('div.form-actions', h('div.spacer'), h('a.btn', { href: existing ? `#/jobs/${existing.id}` : '#/jobs' }, 'Cancel'), saveBtn),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!draft.clientId) {
      clientError.hidden = false;
      picker.querySelector('input')?.focus();
      return;
    }
    if (!unscheduled && !sch.start) {
      toast('Pick a date, or tick "Schedule later".', { type: 'error' });
      return;
    }
    if (!unscheduled && !sch.anytime && sch.startTime && sch.endTime && sch.endTime <= sch.startTime) {
      toast('The end time must be after the start time.', { type: 'error' });
      return;
    }
    if (sch.repeat !== 'none' && sch.end.type === 'until' && (!sch.end.date || sch.end.date < sch.start)) {
      toast('The end date must be after the first visit.', { type: 'error' });
      return;
    }
    if (unscheduled) sch.start = null;
    draft.items = draft.items.filter((it) => it.name?.trim() || it.unitPrice);
    saveBtn.disabled = true;
    try {
      let rec;
      if (existing) {
        // Visits as they are now: one may have been completed while the form was open.
        const visits = store.get('jobs', existing.id)?.visits || existing.visits || [];
        // Only a new schedule regenerates visits; otherwise visits moved,
        // added or reassigned one by one stay as they are.
        if (JSON.stringify(sch) !== initialSchedule) draft.visits = buildVisits(sch.start ? sch : null, draft.assignees, visits);
        else if (JSON.stringify(draft.assignees) !== initialAssignees) draft.visits = visits.map((v) => (v.completedAt || v.invoiceId ? v : { ...v, assignees: [...draft.assignees] }));
        else draft.visits = visits;
        rec = store.put('jobs', applyEdits(store.get('jobs', existing.id) || existing, JSON.parse(initial), draft));
        toast('Job updated');
      } else {
        rec = await createJob(store, draft);
        toast(`Job #${rec.number} created`);
      }
      saved = true;
      navigate(`/jobs/${rec.id}`);
    } finally {
      saveBtn.disabled = false;
    }
  });

  const header = pageHeader({
    title: existing ? `Edit job #${existing.number}` : 'New job',
    crumbs: [{ label: 'Jobs', href: '#/jobs' }, ...(existing ? [{ label: `#${existing.number}`, href: `#/jobs/${existing.id}` }] : [])],
  });
  // Snapshot after the form is built: building it may normalize the draft.
  const initial = JSON.stringify(draft);
  const initialSchedule = JSON.stringify(sch);
  const initialAssignees = JSON.stringify(draft.assignees);
  return { node: h('div.page', header, form), title: existing ? `Edit job #${existing.number}` : 'New job', dirty: () => !saved && JSON.stringify(draft) !== initial };
}
