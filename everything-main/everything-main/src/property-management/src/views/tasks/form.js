/** New and edit task. Query parameters prefill a new task (kind, propertyId, unitId, tenantId, ownerId, leaseId, workOrderId, title). */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../app.js';
import { pageHeader, field, textInput, textarea, select, segmented, emptyState } from '../../ui/components.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { addDays } from '../../core/dates.js';
import { displayName, personName } from '../../core/format.js';
import { PRIORITIES, TASK_KINDS, statusLabel, TASK_STATUSES } from '../../core/status.js';
import { leaseStatus } from '../../core/leases.js';
import { memberSelect, propertyUnitFields } from '../common.js';
import { currentMember } from './list.js';

/** Tenants on the unit (or property) chosen, current and future leases first. */
export function tenantsFor(store, { propertyId, unitId }, today) {
  if (!propertyId && !unitId) return store.all('tenants');
  const ids = new Set();
  for (const l of store.all('leases')) {
    if (l.draft) continue;
    if (unitId ? l.unitId !== unitId : l.propertyId !== propertyId) continue;
    if (leaseStatus(l, today) === 'past') continue;
    for (const id of l.tenantIds || []) ids.add(id);
  }
  return store.all('tenants').filter((t) => ids.has(t.id));
}

export function render(ctx) {
  const store = app.store;
  const q = ctx.query;
  const existing = ctx.params.id ? store.get('tasks', ctx.params.id) : null;
  if (ctx.params.id && !existing) return h('div.page', emptyState({ icon: 'list-checks', title: 'Task not found', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/tasks' }, 'Back to tasks')] }));

  const lease = q.leaseId ? store.get('leases', q.leaseId) : null;
  const draft = existing
    ? structuredClone(existing)
    : {
        title: q.title || '',
        description: '',
        kind: TASK_KINDS.some((k) => k.id === q.kind) ? q.kind : q.tenantId ? 'resident' : q.ownerId ? 'owner' : 'todo',
        status: 'new',
        priority: 'normal',
        dueDate: addDays(app.today(), 3),
        assigneeId: currentMember()?.id || null,
        category: (app.settings().lists?.taskCategories || ['General'])[0] || 'General',
        propertyId: q.propertyId || lease?.propertyId || null,
        unitId: q.unitId || lease?.unitId || null,
        tenantId: q.tenantId || lease?.tenantIds?.[0] || null,
        ownerId: q.ownerId || null,
        leaseId: q.leaseId || null,
        workOrderId: q.workOrderId || null,
        contact: null,
      };
  let saved = false;

  const title = textInput({ name: 'title', value: draft.title, placeholder: 'e.g. Leaking faucet in kitchen', required: true });
  const description = textarea({ name: 'description', value: draft.description, rows: 5, placeholder: 'Details, access instructions, what was reported' });
  const priority = select({ name: 'priority', value: draft.priority, options: PRIORITIES.map((p) => ({ value: p, label: statusLabel(p) })) });
  const status = select({ name: 'status', value: draft.status, options: TASK_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })) });
  const due = textInput({ name: 'dueDate', type: 'date', value: draft.dueDate || '' });
  const assignee = memberSelect({ value: draft.assigneeId || '' });
  const categories = app.settings().lists?.taskCategories || [];
  const category = select({ name: 'category', value: draft.category || '', options: [...new Set([...(draft.category && !categories.includes(draft.category) ? [draft.category] : []), ...categories])].map((c) => ({ value: c, label: c })) });

  const place = propertyUnitFields({ propertyId: draft.propertyId || '', unitId: draft.unitId || '', unitEmpty: 'Whole property', onChange: () => drawTenant() });

  const tenantWrap = h('div.field');
  let tenantSel = null;
  function drawTenant() {
    const list = tenantsFor(store, { propertyId: place.propertyId, unitId: place.unitId }, app.today());
    const keep = list.some((t) => t.id === (tenantSel?.value ?? draft.tenantId)) ? (tenantSel?.value ?? draft.tenantId) : '';
    tenantSel = select({ name: 'tenantId', value: keep || '', options: [{ value: '', label: list.length ? 'Select a tenant' : 'No tenants here' }, ...list.map((t) => ({ value: t.id, label: personName(t) }))].sort((a, b) => (a.value ? 1 : 0) - (b.value ? 1 : 0) || a.label.localeCompare(b.label)) });
    tenantWrap.replaceChildren(field('Tenant', tenantSel, { hint: place.unitId || place.propertyId ? 'Showing current and future tenants here' : null }));
  }
  drawTenant();

  const owner = select({ name: 'ownerId', value: draft.ownerId || '', options: [{ value: '', label: 'Select an owner' }, ...store.all('owners').map((o) => ({ value: o.id, label: displayName(o) })).sort((a, b) => a.label.localeCompare(b.label))] });
  const ownerField = field('Rental owner', owner);
  const cName = textInput({ name: 'contactName', value: draft.contact?.name || '', autocomplete: 'name' });
  const cPhone = textInput({ name: 'contactPhone', type: 'tel', value: draft.contact?.phone || '', autocomplete: 'tel' });
  const cEmail = textInput({ name: 'contactEmail', type: 'email', value: draft.contact?.email || '', autocomplete: 'email' });
  const contactFields = h('div.form-grid.three', field('Contact name', cName), field('Phone', cPhone), field('Email', cEmail));

  const syncKind = () => {
    tenantWrap.hidden = draft.kind !== 'resident';
    ownerField.hidden = draft.kind !== 'owner';
    contactFields.hidden = draft.kind !== 'contact';
  };
  const kind = segmented({
    label: 'Task type',
    value: draft.kind,
    items: TASK_KINDS.map((k) => ({ value: k.id, label: k.label })),
    onChange: (v) => {
      draft.kind = v;
      syncKind();
    },
  });
  syncKind();

  const titleError = h('span.error-text', { hidden: true }, 'Give the task a title.');
  const form = h(
    'form.task-form',
    { novalidate: true },
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Task')),
      h(
        'div.card-body.stack',
        h('div.field', h('span.field-label', { id: 'task-kind-label' }, 'Type'), h('div.task-kind', kind)),
        h('div.field', h('label', { for: (title.id ||= 'task-title') }, 'Title', h('span', { 'aria-hidden': 'true' }, ' *')), title, titleError),
        field('Description', description),
      ),
    ),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Related to')),
      h('div.card-body.stack', h('div.form-grid', place.node), tenantWrap, ownerField, contactFields),
    ),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Assignment')),
      h('div.card-body', h('div.form-grid', field('Assigned to', assignee), field('Due date', due), field('Priority', priority), field('Category', category), existing ? field('Status', status) : null)),
    ),
    h('div.task-form-actions', h('div.spacer'), h('a.btn', { href: existing ? `#/tasks/${existing.id}` : '#/tasks' }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, icon('check', 16), existing ? 'Save changes' : 'Create task')),
  );

  const collect = () => {
    draft.title = title.value.trim();
    draft.description = description.value.trim();
    draft.priority = priority.value;
    draft.dueDate = due.value || null;
    draft.assigneeId = assignee.value || null;
    draft.category = category.value || null;
    draft.propertyId = place.propertyId;
    draft.unitId = place.unitId;
    draft.tenantId = draft.kind === 'resident' ? tenantSel?.value || null : null;
    draft.ownerId = draft.kind === 'owner' ? owner.value || null : null;
    draft.contact = draft.kind === 'contact' ? { name: cName.value.trim(), phone: cPhone.value.trim(), email: cEmail.value.trim() } : null;
    if (existing) draft.status = status.value;
  };

  let busy = false; // creating waits for a number from the server
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    collect();
    if (!draft.title) {
      title.setAttribute('aria-invalid', 'true');
      titleError.hidden = false;
      title.focus();
      return;
    }
    let rec;
    if (existing) {
      // Completed gets a date; closed keeps one it had; reopened has none.
      if (draft.status === 'completed' && !draft.completedOn) draft.completedOn = app.today();
      if (draft.status !== 'completed' && draft.status !== 'closed') draft.completedOn = null;
      rec = store.put('tasks', draft);
      toast('Task updated');
    } else {
      busy = true;
      const submit = form.querySelector('button[type=submit]');
      submit.disabled = true;
      try {
        rec = store.put('tasks', { ...draft, number: await store.nextNumber('tasks') });
      } finally {
        busy = false;
        submit.disabled = false;
      }
      toast(`Task TK-${rec.number} created`);
    }
    saved = true;
    navigate(`/tasks/${rec.id}`);
  });

  const snapshot = () => {
    collect();
    return JSON.stringify(draft);
  };
  const initial = snapshot();
  const heading = existing ? `Edit task TK-${existing.number}` : 'New task';
  return {
    node: h('div.page.narrow', pageHeader({ title: heading, crumbs: [{ label: 'Tasks', href: '#/tasks' }] }), form),
    title: heading,
    dirty: () => !saved && snapshot() !== initial,
  };
}
