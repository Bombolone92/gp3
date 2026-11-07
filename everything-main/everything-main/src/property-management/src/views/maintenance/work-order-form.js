/** New and edit work order. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup, occupancyMap } from '../../app.js';
import { pageHeader, field, textInput, textarea, select, moneyInput, emptyState, segmented } from '../../ui/components.js';
import { navigate } from '../../ui/router.js';
import { toast } from '../../ui/toast.js';
import { money, propertyUnitFields, vendorSelect, memberSelect } from '../common.js';
import { tenantName } from '../../core/leases.js';
import { statusLabel, PRIORITIES, WORK_ORDER_STATUSES } from '../../core/status.js';
import { addDays } from '../../core/dates.js';
import { ENTRY_LABEL, workOrderTotal } from './shared.js';

export function render(ctx) {
  const store = app.store;
  const existing = ctx.params.id ? store.get('workOrders', ctx.params.id) : null;
  if (ctx.params.id && !existing) {
    return h('div.page', emptyState({ icon: 'wrench', title: 'Work order not found', headingLevel: 1, text: 'It may have been deleted.', actions: [h('a.btn.primary', { href: '#/work-orders' }, 'Back to work orders')] }));
  }
  const q = ctx.query;
  const unit0 = q.unitId ? lookup.unit(q.unitId) : null;
  const task0 = q.taskId ? store.get('tasks', q.taskId) : null;
  const draft = existing
    ? structuredClone(existing)
    : {
        title: task0?.title || q.title || '',
        description: task0?.description || '',
        propertyId: unit0?.propertyId || task0?.propertyId || q.propertyId || '',
        unitId: unit0?.id || task0?.unitId || '',
        vendorId: q.vendorId || '',
        assigneeId: '',
        status: 'new',
        priority: task0?.priority && PRIORITIES.includes(task0.priority) ? task0.priority : 'normal',
        dueDate: addDays(app.today(), 7),
        entry: 'allowed',
        entryNotes: '',
        requestedBy: task0?.tenantId || '',
        taskId: task0?.id || null,
        items: [],
      };
  draft.items = (draft.items || []).map((it) => ({ ...it }));
  let saved = false;

  const title = textInput({ value: draft.title, placeholder: 'e.g. Kitchen sink leaking' });
  const description = textarea({ value: draft.description, rows: 4, placeholder: 'What is wrong, where, and anything the vendor should know' });
  const reqWrap = h('div');
  const place = propertyUnitFields({ propertyId: draft.propertyId || '', unitId: draft.unitId || '', required: true, onChange: () => drawRequester() });
  function drawRequester() {
    const lease = place.unitId ? occupancyMap().get(place.unitId) : null;
    const tenants = lookup.tenants(lease?.tenantIds || []);
    if (!tenants.some((t) => t.id === draft.requestedBy) && !(existing && existing.requestedBy === draft.requestedBy)) draft.requestedBy = '';
    const s = select({ value: draft.requestedBy || '', options: [{ value: '', label: tenants.length ? 'Not a tenant request' : 'No current tenants' }, ...tenants.map((t) => ({ value: t.id, label: tenantName(t) }))] });
    s.addEventListener('change', () => (draft.requestedBy = s.value));
    reqWrap.replaceChildren(field('Requested by', s));
  }
  drawRequester();

  const vendor = vendorSelect({ value: draft.vendorId || '', empty: 'No vendor yet' });
  const assignee = memberSelect({ value: draft.assigneeId || '' });
  const priority = segmented({ label: 'Priority', value: draft.priority || 'normal', items: PRIORITIES.map((p) => ({ value: p, label: statusLabel(p) })), onChange: (v) => (draft.priority = v) });
  const due = textInput({ type: 'date', value: draft.dueDate || '' });
  const status = select({ value: draft.status, options: WORK_ORDER_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })) });
  const entry = select({ value: draft.entry || 'allowed', options: Object.entries(ENTRY_LABEL).map(([value, label]) => ({ value, label })) });
  const entryNotes = textInput({ value: draft.entryNotes || '', placeholder: 'e.g. Dog in unit, key in lockbox 4' });

  // Line items
  const itemsBody = h('tbody');
  const totalCell = h('td.r.num.total-cell');
  function drawItems() {
    itemsBody.replaceChildren(
      ...draft.items.map((it, i) => {
        const d = textInput({ value: it.description || '', 'aria-label': `Item ${i + 1} description`, placeholder: 'Part or labor' });
        const qty = textInput({ type: 'number', min: '0', step: 'any', value: it.qty ?? 1, cls: 'num', 'aria-label': `Item ${i + 1} quantity` });
        const amt = moneyInput({ cents: it.amount || 0, 'aria-label': `Item ${i + 1} unit price` });
        const line = h('td.r.num');
        const sync = () => {
          it.description = d.value;
          it.qty = Number(qty.value) || 0;
          it.amount = amt.cents;
          line.textContent = money(Math.round(it.qty * it.amount));
          totalCell.textContent = money(workOrderTotal(draft));
        };
        d.addEventListener('input', sync);
        qty.addEventListener('input', sync);
        amt.addEventListener('input', sync);
        line.textContent = money(Math.round((Number(it.qty) || 0) * (it.amount || 0)));
        return h(
          'tr',
          h('td', d),
          h('td.qty-col', qty),
          h('td.amt-col', amt),
          line,
          h('td.r', h('button.icon-btn.sm', { type: 'button', 'aria-label': `Remove item ${i + 1}`, onClick: () => (draft.items.splice(i, 1), drawItems()) }, icon('trash', 15))),
        );
      }),
    );
    totalCell.textContent = money(workOrderTotal(draft));
  }
  drawItems();
  const addItem = () => {
    draft.items.push({ description: '', qty: 1, amount: 0 });
    drawItems();
    itemsBody.querySelector('tr:last-child input')?.focus();
  };

  const error = h('span.error-text', { role: 'alert', hidden: true });
  const form = h(
    'form.pm-form',
    { novalidate: true },
    h('section.card', h('div.card-head', h('h2.grow', 'What needs doing')), h('div.card-body.stack', field('Title', title, { required: true }), field('Description', description), error)),
    h('section.card', h('div.card-head', h('h2.grow', 'Where')), h('div.card-body', h('div.form-grid', place.node, reqWrap, field('Entry', entry), field('Entry notes', entryNotes, { span2: true })))),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Who and when')),
      h('div.card-body.stack', h('div.form-grid', field('Vendor', vendor), field('Assigned to', assignee), field('Due date', due), existing ? field('Status', status) : null), h('div.field', h('span.field-label', 'Priority'), priority)),
    ),
    h(
      'section.card',
      h('div.card-head', h('h2.grow', 'Parts and labor'), h('button.btn.sm', { type: 'button', onClick: addItem }, icon('plus', 14), 'Add item')),
      h(
        'div.card-body.flush',
        h(
          'div.table-wrap',
          h(
            'table.table.items-table',
            h('caption.sr-only', 'Parts and labor'),
            h('thead', h('tr', h('th', 'Description'), h('th.qty-col', 'Qty'), h('th.amt-col', 'Unit price'), h('th.r', 'Total'), h('th', h('span.sr-only', 'Remove')))),
            itemsBody,
            h('tfoot', h('tr', h('td', { colspan: 3 }, h('span.subtle', 'Estimated cost')), totalCell, h('td'))),
          ),
        ),
      ),
    ),
    h('div.form-actions', h('div.spacer'), h('a.btn', { href: existing ? `#/work-orders/${existing.id}` : '#/work-orders' }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, existing ? 'Save changes' : 'Create work order')),
  );

  /** Current form values, without touching draft (line item inputs write to draft.items). */
  const values = () => ({
    ...draft,
    title: title.value.trim(),
    description: description.value.trim(),
    propertyId: place.propertyId,
    unitId: place.unitId,
    vendorId: vendor.value || null,
    assigneeId: assignee.value || null,
    dueDate: due.value || null,
    entry: entry.value,
    entryNotes: entryNotes.value.trim(),
    status: existing ? status.value : draft.status,
    items: draft.items.filter((it) => (it.description || '').trim() || it.amount).map((it) => ({ ...it, description: (it.description || '').trim() })),
  });

  let busy = false; // creating waits for a number from the server
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    Object.assign(draft, values());
    if (!draft.title) {
      error.textContent = 'Give the work order a title.';
      error.hidden = false;
      title.focus();
      return;
    }
    if (!draft.propertyId) {
      error.textContent = 'Choose the property.';
      error.hidden = false;
      place.property.focus();
      return;
    }
    if (!existing && draft.status === 'new' && (draft.vendorId || draft.assigneeId)) draft.status = 'assigned';
    if (existing && ['completed', 'closed'].includes(draft.status) && !draft.completedOn) draft.completedOn = app.today();
    if (!['completed', 'closed'].includes(draft.status)) draft.completedOn = null;
    let rec;
    if (existing) {
      rec = store.put('workOrders', draft);
      toast('Work order updated');
    } else {
      busy = true;
      const submit = form.querySelector('button[type=submit]');
      submit.disabled = true;
      try {
        rec = store.put('workOrders', { ...draft, number: await store.nextNumber('workOrders') });
      } finally {
        busy = false;
        submit.disabled = false;
      }
      if (draft.taskId) store.patch('tasks', draft.taskId, (t) => ((t.workOrderId = rec.id), t.status === 'new' ? (t.status = 'in-progress') : null, t));
      toast(`Work order WO-${rec.number} created`);
    }
    saved = true;
    navigate(`/work-orders/${rec.id}`);
  });

  const snap = () => JSON.stringify(values());
  const initial = snap();
  const pageTitle = existing ? `Edit WO-${existing.number}` : 'New work order';
  return {
    node: h('div.page.narrow', pageHeader({ title: pageTitle, crumbs: [{ label: 'Work orders', href: '#/work-orders' }] }), form),
    title: pageTitle,
    dirty: () => !saved && snap() !== initial,
  };
}
