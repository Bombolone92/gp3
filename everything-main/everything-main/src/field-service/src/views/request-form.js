/** New and edit request (incoming work, optionally with an on-site assessment). */
import { h } from '../ui/dom.js';
import { app, lookup } from '../app.js';
import { pageHeader, field, textInput, textarea, select, emptyState } from '../ui/components.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { clientPicker, propertySelect, assigneePicker } from './common.js';
import { addDays } from '../core/dates.js';
import { applyEdits } from '../core/workflow.js';

const SOURCES = ['Phone', 'Email', 'Website', 'Walk-in', 'Referral', 'Other'];
const TIMES = [
  ['any', 'Any time'],
  ['morning', 'Morning'],
  ['afternoon', 'Afternoon'],
  ['evening', 'Evening'],
];

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('requests', ctx.params.id) : null;
  if (ctx.params.id && !existing) return h('div.page', emptyState({ icon: 'inbox', title: 'Request not found', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/requests' }, 'Back to requests')] }));
  const client0 = ctx.query.client ? store.get('clients', ctx.query.client) : null;
  const draft = existing
    ? structuredClone(existing)
    : {
        clientId: client0?.id || null,
        propertyId: client0?.properties?.[0]?.id || null,
        title: '',
        details: '',
        source: 'Phone',
        availability: { dates: [], times: [] },
        assessment: null,
        notes: '',
      };
  draft.availability ??= { dates: [], times: [] };
  let saved = false;

  const propWrap = h('div');
  const drawProperty = () => {
    const sel = propertySelect(lookup.client(draft.clientId), draft.propertyId, (v) => (draft.propertyId = v));
    propWrap.replaceChildren(...(sel ? [field('Property', sel)] : []));
  };
  const clientError = h('span.error-text', { role: 'alert', hidden: true }, 'Choose who is asking for the work.');
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

  const bind = (key, input) => (input.addEventListener('input', () => (draft[key] = input.value)), input);
  const title = bind('title', textInput({ value: draft.title, placeholder: 'e.g. Leaky outdoor faucet' }));
  const details = bind('details', textarea({ value: draft.details, rows: 5, placeholder: 'What does the client need? Include anything that helps you quote accurately.' }));
  const source = select({ value: draft.source || 'Phone', options: SOURCES });
  source.addEventListener('change', () => (draft.source = source.value));

  const d1 = textInput({ type: 'date', value: draft.availability.dates[0] || '' });
  const d2 = textInput({ type: 'date', value: draft.availability.dates[1] || '' });
  const syncDates = () => (draft.availability.dates = [d1.value, d2.value].filter(Boolean));
  d1.addEventListener('input', syncDates);
  d2.addEventListener('input', syncDates);
  const times = h(
    'div.row',
    { style: { flexWrap: 'wrap', gap: '16px' } },
    TIMES.map(([id, label]) =>
      h(
        'label.check',
        h('input', {
          type: 'checkbox',
          checked: draft.availability.times.includes(id),
          onChange: (e) => {
            const set = new Set(draft.availability.times);
            e.target.checked ? set.add(id) : set.delete(id);
            draft.availability.times = [...set];
          },
        }),
        label,
      ),
    ),
  );

  // Assessment
  const wantAssessment = h('input', { type: 'checkbox', checked: !!draft.assessment });
  const a = draft.assessment || { date: addDays(app.today(), 1), start: '10:00', end: '11:00', assignees: [], instructions: '' };
  const aDate = textInput({ type: 'date', value: a.date || '' });
  const aStart = textInput({ type: 'time', value: a.start || '', step: 900 });
  const aEnd = textInput({ type: 'time', value: a.end || '', step: 900 });
  const aNotes = textarea({ value: a.instructions || '', rows: 2, placeholder: 'What to look at on site' });
  const aTeam = assigneePicker(a.assignees, () => {});
  const assessFields = h('div.stack', { hidden: !draft.assessment }, h('div.form-grid.three', field('Date', aDate), field('Start', aStart), field('End', aEnd)), h('div.field', h('span.field-label', 'Team'), aTeam), field('Instructions', aNotes));
  wantAssessment.addEventListener('change', () => (assessFields.hidden = !wantAssessment.checked));
  const readAssessment = () =>
    wantAssessment.checked
      ? { ...(draft.assessment || {}), date: aDate.value || null, start: aStart.value, end: aEnd.value, assignees: a.assignees, instructions: aNotes.value, completedAt: draft.assessment?.completedAt || null }
      : null;
  const saveBtn = h('button.btn.primary', { type: 'submit' }, existing ? 'Save changes' : 'Save request');

  const form = h(
    'form.doc-form',
    { novalidate: true },
    h(
      'div.doc-top',
      h('section.card', h('div.card-head', h('h2.grow', 'Client')), h('div.card-body.stack', h('div.field', h('span.field-label', 'Client'), picker, clientError), propWrap, h('div.form-grid', field('Request title', title), field('Source', source)))),
      h(
        'section.card',
        h('div.card-head', h('h2.grow', 'Availability')),
        h('div.card-body.stack', h('p.subtle', { style: { fontSize: '13px' } }, 'When would the client like the work done?'), h('div.form-grid', field('Preferred date', d1), field('Another date that works', d2)), h('div.field', h('span.field-label', 'Preferred times'), times)),
      ),
    ),
    h('section.card', h('div.card-head', h('h2.grow', 'Service details')), h('div.card-body', field('Details', details))),
    h('section.card', h('div.card-head', h('h2.grow', 'On-site assessment')), h('div.card-body.stack', h('label.check', wantAssessment, 'Visit the site before quoting'), assessFields)),
    h('div.form-actions', h('div.spacer'), h('a.btn', { href: existing ? `#/requests/${existing.id}` : '#/requests' }, 'Cancel'), saveBtn),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Getting a request number can take a moment; a second click must not save twice.
    if (saveBtn.disabled) return;
    if (!draft.clientId) {
      clientError.hidden = false;
      picker.querySelector('input')?.focus();
      return;
    }
    if (wantAssessment.checked && aStart.value && aEnd.value && aEnd.value <= aStart.value) {
      aEnd.setAttribute('aria-invalid', 'true');
      aEnd.focus();
      toast('The end time must be after the start time.', { type: 'error' });
      return;
    }
    draft.assessment = readAssessment();
    saveBtn.disabled = true;
    try {
      let rec;
      if (existing) {
        rec = store.put('requests', applyEdits(store.get('requests', existing.id) || existing, JSON.parse(initial), draft));
        toast('Request updated');
      } else {
        rec = store.put('requests', { ...draft, number: await store.nextNumber('requests') });
        toast(`Request #${rec.number} created`);
      }
      saved = true;
      navigate(`/requests/${rec.id}`);
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Snapshot after the form is built: building it may normalize the draft.
  // The assessment fields only reach the draft on save, so read them here too.
  const snapshot = () => JSON.stringify({ ...draft, assessment: readAssessment() });
  const initial = snapshot();
  return {
    node: h('div.page', pageHeader({ title: existing ? `Edit request #${existing.number}` : 'New request', crumbs: [{ label: 'Requests', href: '#/requests' }] }), form),
    title: existing ? `Edit request #${existing.number}` : 'New request',
    dirty: () => !saved && snapshot() !== initial,
  };
}
