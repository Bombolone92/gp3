/**
 * Create or edit a matter: a sectioned, full-page form with a section index
 * on wide screens and a sticky action bar.
 */
import '../styles/matter.css';
import { h, uniqueId } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, meId } from '../app.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { field, textInput, textarea, select, moneyInput, checkbox, toggle, tagInput, choiceCards, emptyState } from '../ui/components.js';
import { contactPicker, userSelect, practiceAreaSelect } from './common.js';
import { customFieldInputs } from './custom-fields.js';
import { MATTER_STATUSES, stagesFor } from '../core/settings.js';
import { displayNumber, tasksFromList } from '../core/matters.js';
import { newId } from '../core/ids.js';
import { parseMoney } from '../core/money.js';

export function render(ctx) {
  const store = app.store;
  const s = app.settings();
  const existing = ctx.params.id ? store.get('matters', ctx.params.id) : null;
  if (ctx.params.id && !existing) {
    return h(
      'div.page',
      emptyState({ icon: 'search', title: 'Matter not found', text: 'It may have been deleted.', headingLevel: 1, actions: [h('a.btn', { href: '#/matters' }, 'Back to matters')] }),
    );
  }
  const m = existing || {};
  const b = m.billing || { billable: true, method: 'hourly' };
  const today = app.today();

  // ---- Controls ----
  const client = contactPicker({ name: 'clientId', value: m.clientId || ctx.query.client || '', required: true, label: 'Client', placeholder: 'Find or create a client' });
  const description = textInput({ name: 'description', value: m.description || '', placeholder: 'For example: Smith v. Jones, contract dispute' });
  const responsible = userSelect({ name: 'responsibleId', value: existing ? m.responsibleId || '' : meId() || '', allowNone: false, required: true });
  const originating = userSelect({ name: 'originatingId', value: existing ? m.originatingId || '' : meId() || '', noneLabel: 'None' });
  const staff = userSelect({ name: 'staffId', value: m.staffId || '', noneLabel: 'None' });
  const area = practiceAreaSelect({ value: m.practiceAreaId || '', required: true });
  const stageWrap = h('div.field-slot');
  let stage = null;
  const drawStage = () => {
    stage = select({ name: 'stageId', value: m.stageId || '', options: [{ value: '', label: 'No stage' }, ...stagesFor(s, area.value).map((x) => ({ value: x.id, label: x.name }))] });
    if (m.stageId && ![...stage.options].some((o) => o.value === m.stageId)) stage.value = '';
    stageWrap.replaceChildren(field('Matter stage', stage));
  };
  area.addEventListener('change', drawStage);
  drawStage();

  let status = m.status || 'open';
  const openDate = textInput({ name: 'openDate', type: 'date', value: m.openDate || today });
  const pendingDate = textInput({ name: 'pendingDate', type: 'date', value: m.pendingDate || today });
  const closedDate = textInput({ name: 'closedDate', type: 'date', value: m.closedDate || today });
  const pendingField = field('Pending date', pendingDate);
  const closedField = field('Closed date', closedDate);
  const syncStatus = () => {
    pendingField.hidden = status !== 'pending';
    closedField.hidden = status !== 'closed';
  };
  const statusCards = choiceCards({
    name: 'status',
    value: status,
    label: 'Matter status',
    options: MATTER_STATUSES.map((x) => ({ value: x.id, label: x.label })),
    onChange: (v) => ((status = v), syncStatus()),
  });
  syncStatus();

  const sol = textInput({ name: 'solDate', type: 'date', value: m.solDate || '' });
  const solDone = checkbox({ name: 'solSatisfied', label: 'Statute of limitations satisfied', checked: !!m.solSatisfied });
  const tags = tagInput({ name: 'tags', tags: m.tags || [], suggestions: [...new Set(store.all('matters').flatMap((x) => x.tags || []))] });
  const clientRef = textInput({ name: 'clientRef', value: m.clientRef || '' });
  const location = textInput({ name: 'location', value: m.location || '' });
  const notes = textarea({ name: 'notes', value: m.notes || '', rows: 3, placeholder: 'Internal notes about this matter' });

  // Related contacts
  let related = (m.related || []).map((r) => ({ ...r }));
  const relatedList = h('div.related-rows');
  function drawRelated() {
    relatedList.replaceChildren(
      ...related.map((r, i) => {
        const picker = contactPicker({ name: `rel_${r.id}`, value: r.contactId, label: `Related contact ${i + 1}`, onChange: (v) => (r.contactId = v) });
        const rel = select({
          name: `relType_${r.id}`,
          value: r.relationship || '',
          'aria-label': `Relationship ${i + 1}`,
          options: [{ value: '', label: 'Relationship' }, ...s.relationships.map((x) => ({ value: x, label: x }))],
        });
        rel.addEventListener('change', () => (r.relationship = rel.value));
        const billTo = checkbox({ name: `relBill_${r.id}`, label: 'Bill recipient', checked: !!r.billRecipient, onChange: (v) => (r.billRecipient = v) });
        return h(
          'div.related-row',
          h('div.grow', picker),
          rel,
          billTo,
          h('button.icon-btn', { type: 'button', 'aria-label': `Remove related contact ${i + 1}`, onClick: () => ((related = related.filter((x) => x !== r)), drawRelated(), addRelated.focus()) }, icon('trash', 16)),
        );
      }),
    );
  }
  drawRelated();
  const addRelated = h(
    'button.btn.sm',
    { type: 'button', onClick: () => (related.push({ id: newId(), contactId: '', relationship: '' }), drawRelated(), relatedList.lastElementChild?.querySelector('input[role=combobox]')?.focus()) },
    icon('plus', 15),
    'Add related contact',
  );

  // Billing
  const billable = toggle({ name: 'billable', label: 'This matter is billable', checked: b.billable !== false });
  let method = b.method || 'hourly';
  const methodCards = choiceCards({
    name: 'method',
    value: method,
    label: 'Billing method',
    options: [
      { value: 'hourly', label: 'Hourly', icon: 'clock' },
      { value: 'flat', label: 'Flat fee', icon: 'dollar' },
      { value: 'contingency', label: 'Contingency', icon: 'percent' },
    ],
    onChange: (v) => ((method = v), syncMethod()),
  });
  const rate = moneyInput({ name: 'rate', cents: b.rateCents || 0, placeholder: 'Use each user’s rate' });
  const flatFee = moneyInput({ name: 'flatFee', cents: b.flatFeeCents || 0 });
  const contingency = textInput({ name: 'contingencyPct', type: 'number', min: '0', max: '100', step: '0.5', value: b.contingencyPct ? String(b.contingencyPct) : '', cls: 'num' });
  const budget = moneyInput({ name: 'budget', cents: b.budgetCents || 0, placeholder: 'No budget' });
  const rateField = field('Custom hourly rate', rate, { hint: 'Leave empty to bill each person at their own rate.' });
  const flatField = field('Flat fee amount', flatFee);
  const contField = field('Contingency percentage', contingency, { hint: 'Percent of the recovery' });
  const syncMethod = () => {
    rateField.hidden = method !== 'hourly';
    flatField.hidden = method !== 'flat';
    contField.hidden = method !== 'contingency';
  };
  syncMethod();
  const trustMin = moneyInput({ name: 'trustMin', cents: m.trustMinimumCents || 0 });

  const custom = customFieldInputs('matter', m.custom);

  // Task lists (new matters only)
  const lists = store.all('taskLists');
  const listChecks = lists.map((l) => checkbox({ name: `list_${l.id}`, label: `${l.name} (${(l.items || []).length} tasks)` }));

  // ---- Sections ----
  const sections = [
    ['client', 'Client', [field('Client', client, { required: true }), h('div.subtle.small', 'Type a name to find an existing contact or create a new one.')]],
    [
      'details',
      'Matter details',
      [
        field('Matter description', description, { required: true }),
        h(
          'div.grid-2',
          field('Responsible lawyer', responsible, { required: true }),
          field('Originating lawyer', originating),
          field('Responsible staff', staff),
          field('Client reference number', clientRef),
          field('Practice area', area, { required: true }),
          stageWrap,
          field('Location', location),
        ),
        h('fieldset.field', h('legend', 'Matter status'), statusCards),
        h('div.grid-2', field('Open date', openDate), pendingField, closedField),
        h(
          'div.grid-2',
          field('Statute of limitations date', sol, { hint: 'Shown on the calendar and in alerts as it approaches.' }),
          h('div.field.sol-check', h('span.field-spacer', { 'aria-hidden': 'true' }), solDone),
        ),
        field('Tags', tags),
        field('Notes', notes),
      ],
    ],
    ['related', 'Related contacts', [h('p.subtle', 'Opposing parties, counsel, witnesses, and others. They are included in conflict checks.'), relatedList, h('div', addRelated)]],
    [
      'billing',
      'Billing preference',
      [
        billable,
        h('fieldset.field', h('legend', 'Billing method'), methodCards),
        h('div.grid-2', rateField, flatField, contField, field('Matter budget', budget, { hint: 'Get a warning as work approaches the budget.' })),
      ],
    ],
    ['trust', 'Trust', [h('div.grid-2', field('Minimum trust balance', trustMin, { hint: 'Alerts when funds held for this matter drop below this amount.' }))]],
    custom.count ? ['custom', 'Custom fields', [custom.node]] : null,
    !existing && lists.length ? ['tasks', 'Task lists', [h('p.subtle', 'Create tasks from templates when the matter is saved.'), h('div.stack-sm', listChecks)]] : null,
  ].filter(Boolean);

  const form = h('form.matter-form', { novalidate: true, id: uniqueId('mf') });
  const index = h(
    'nav.form-index',
    { 'aria-label': 'Form sections' },
    h('div.menu-label', 'Sections'),
    sections.map(([id, label]) =>
      h('a', { href: `#sec-${id}`, onClick: (e) => (e.preventDefault(), form.querySelector(`#sec-${id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })) }, label),
    ),
  );
  form.append(
    ...sections.map(([id, label, body]) => h('section.card.form-section', { id: `sec-${id}`, 'aria-labelledby': `sec-${id}-h` }, h('h2', { id: `sec-${id}-h` }, label), h('div.stack', body))),
  );

  const title = existing ? 'Edit matter' : 'New matter';
  const saveBtn = h('button.btn.primary', { type: 'submit', form: form.id }, existing ? 'Save matter' : 'Create matter');
  const bar = h(
    'header.form-bar',
    h(
      'div.titles',
      h(
        'nav.crumbs',
        { 'aria-label': 'Breadcrumb' },
        h('a', { href: '#/matters' }, 'Matters'),
        existing ? [icon('chevron-right', 14), h('a', { href: `#/matters/${existing.id}` }, existing.displayNumber)] : null,
      ),
      h('h1', title),
    ),
    h('div.actions', h('a.btn', { href: existing ? `#/matters/${existing.id}` : '#/matters', onClick: () => (saved = true) }, 'Cancel'), saveBtn),
  );

  let saved = false;
  const snapshot = () => JSON.stringify([...new FormData(form).entries(), client.value, related, tags.tags]);
  let initial = '';
  queueMicrotask(() => (initial = snapshot()));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    const missing = [];
    if (!client.value) missing.push(client.input);
    if (!description.value.trim()) missing.push(description);
    if (!area.value) missing.push(area);
    if (!responsible.value) missing.push(responsible);
    if (missing.length) {
      for (const el of missing) el.setAttribute('aria-invalid', 'true');
      missing[0].focus();
      toast('Fill in the required fields marked with an asterisk.', { type: 'error' });
      return;
    }
    const opened = openDate.value || today;
    const early = [status === 'pending' && pendingDate.value && pendingDate.value < opened ? pendingDate : null, status === 'closed' && closedDate.value && closedDate.value < opened ? closedDate : null].filter(Boolean);
    if (early.length) {
      for (const el of early) el.setAttribute('aria-invalid', 'true');
      early[0].focus();
      toast(`The ${early[0] === closedDate ? 'closed' : 'pending'} date cannot be before the open date.`, { type: 'error' });
      return;
    }
    const badMoney = (el) => !!el.value.trim() && !(parseMoney(el.value) >= 0);
    const pct = contingency.value.trim();
    const wrong = [
      method === 'hourly' && badMoney(rate) ? rate : null,
      method === 'flat' && badMoney(flatFee) ? flatFee : null,
      method === 'contingency' && pct && !(Number(pct) >= 0 && Number(pct) <= 100) ? contingency : null,
      badMoney(budget) ? budget : null,
      badMoney(trustMin) ? trustMin : null,
    ].filter(Boolean);
    if (wrong.length) {
      for (const el of wrong) el.setAttribute('aria-invalid', 'true');
      wrong[0].focus();
      toast(wrong[0] === contingency ? 'Enter a contingency percentage from 0 to 100.' : 'Enter amounts as zero or more, for example 1,500.00.', { type: 'error' });
      return;
    }
    saveBtn.disabled = true;
    try {
      const clientRec = lookup.contact(client.value);
      // Start from the stored record, so fields this form does not show
      // (changed elsewhere while it was open, like a billed flat fee) survive.
      const base = (existing && store.get('matters', existing.id)) || m;
      const baseBilling = base.billing || b;
      const rec = {
        ...base,
        clientId: client.value,
        description: description.value.trim(),
        responsibleId: responsible.value,
        originatingId: originating.value || null,
        staffId: staff.value || null,
        clientRef: clientRef.value.trim(),
        location: location.value.trim(),
        practiceAreaId: area.value,
        stageId: stage.value || null,
        status,
        openDate: openDate.value || today,
        pendingDate: status === 'pending' ? pendingDate.value || today : m.pendingDate || '',
        closedDate: status === 'closed' ? closedDate.value || today : '',
        solDate: sol.value || '',
        solSatisfied: !!solDone.querySelector('input').checked,
        tags: tags.tags,
        notes: notes.value.trim(),
        related: related.filter((r) => r.contactId),
        billing: {
          ...baseBilling,
          billable: billable.querySelector('input').checked,
          method,
          rateCents: method === 'hourly' && rate.cents > 0 ? rate.cents : null,
          flatFeeCents: method === 'flat' ? flatFee.cents : baseBilling.flatFeeCents || 0,
          contingencyPct: method === 'contingency' ? Number(contingency.value) || 0 : baseBilling.contingencyPct || 0,
          budgetCents: budget.cents || 0,
        },
        trustMinimumCents: trustMin.cents || 0,
        custom: custom.read(),
      };
      if (!existing) {
        rec.number = await store.nextNumber('matters');
        rec.displayNumber = displayNumber(rec.number, { format: s.numbering.format, client: clientRec, openDate: rec.openDate });
      } else if (existing.clientId !== rec.clientId && s.numbering.format === 'number-client') {
        rec.displayNumber = displayNumber(rec.number, { format: s.numbering.format, client: clientRec, openDate: rec.openDate });
      }
      const out = store.put('matters', rec);
      if (!existing) {
        const chosen = lists.filter((l, i) => listChecks[i].querySelector('input').checked);
        const tasks = chosen.flatMap((l) => tasksFromList(l, out, out.openDate, (id) => lookup.user(id)?.active !== false));
        if (tasks.length) store.bulkPut('tasks', tasks);
        toast(`Matter ${out.displayNumber} created${tasks.length ? ` with ${tasks.length} tasks` : ''}`);
      } else toast('Matter saved');
      saved = true;
      navigate(`/matters/${out.id}`);
    } finally {
      saveBtn.disabled = false;
    }
  });

  return {
    title,
    node: h('div.page.form-page', bar, h('div.form-layout', index, form)),
    dirty: () => !saved && initial && snapshot() !== initial,
  };
}
