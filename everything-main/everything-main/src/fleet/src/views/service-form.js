/**
 * One form for service entries (work that was done) and work orders (work
 * to do, tracked through statuses). The route decides which.
 */
import { h } from '../ui/dom.js';
import { formPage, openFormDialog } from '../ui/form.js';
import { app, lookup } from '../app.js';
import { navigate, back } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { vehicleName, formatDecimal } from '../core/format.js';
import { REPAIR_CLASSES, WORK_ORDER_STATUSES } from '../core/status.js';
import { saveServiceEntry, completeWorkOrder, meterWarnings, matchingReminders, stockOnHand } from '../core/actions.js';
import { partsUsed } from '../core/totals.js';
import { options, emptyPage, meterUnitLabel } from './common.js';
import { lineItemsEditor, totalsEditor, linksEditor } from './line-items.js';

export function render(ctx) {
  const store = app.store;
  const isWO = ctx.route.path.startsWith('/work-orders');
  const coll = isWO ? 'workOrders' : 'serviceEntries';
  const existing = ctx.params.id ? store.get(coll, ctx.params.id) : null;
  if (ctx.params.id && !existing) return emptyPage(isWO ? 'Work order not found' : 'Service entry not found', 'It may have been deleted.');
  const today = app.today();
  const fromIssue = ctx.query.issue ? store.get('issues', ctx.query.issue) : null;
  const fromReminder = ctx.query.reminder ? store.get('reminders', ctx.query.reminder) : null;
  const vehicleId = existing?.vehicleId || ctx.query.vehicle || fromIssue?.vehicleId || fromReminder?.vehicleId || null;
  const rec = existing || {
    vehicleId,
    date: today,
    issueDate: today,
    status: 'open',
    repairClass: fromIssue ? 'non_scheduled' : 'scheduled',
    meter: lookup.vehicle(vehicleId)?.meter ?? null,
    lineItems: fromReminder ? [{ id: crypto.randomUUID?.() || String(Date.now()), taskId: fromReminder.taskId, laborRate: app.settings().laborRate || null, parts: [] }] : [],
    issueIds: fromIssue ? [fromIssue.id] : [],
    reminderIds: fromReminder ? [fromReminder.id] : [],
  };

  const links = linksEditor({ issueIds: rec.issueIds || [], reminderIds: rec.reminderIds || [], vehicleId: rec.vehicleId, docId: existing?.id || null });
  const totals = totalsEditor(rec);
  const items = lineItemsEditor(rec.lineItems || [], {
    onChange: (list) => {
      totals.setItems(list);
      links.setTasks(list.map((li) => li.taskId));
    },
  });
  links.setTasks((rec.lineItems || []).map((li) => li.taskId));
  const warn = h('div.form-warning', { role: 'status', 'aria-live': 'polite' });
  let unitV = rec.vehicleId;
  const unit = () => meterUnitLabel(lookup.vehicle(unitV));

  const detailFields = isWO
    ? [
        { id: 'vehicleId', label: 'Vehicle', type: 'picker', required: true, options: options.vehicles({ keep: rec.vehicleId }), span: 2 },
        { id: 'status', label: 'Status', type: 'select', required: true, options: () => WORK_ORDER_STATUSES.filter((s) => s.id !== 'completed' || existing?.status === 'completed').map((s) => ({ value: s.id, label: s.label })) },
        { id: 'repairClass', label: 'Repair priority class', type: 'select', required: true, options: () => REPAIR_CLASSES.map((c) => ({ value: c.id, label: c.label })), hint: 'Scheduled, non-scheduled, or emergency work.' },
        { id: 'issueDate', label: 'Issue date', type: 'date', required: true },
        { id: 'startDate', label: 'Scheduled start', type: 'date' },
        { id: 'dueDate', label: 'Expected completion', type: 'date', validate: (v, all) => (v && all.startDate && v < all.startDate ? 'Must be on or after the start.' : null) },
        { id: 'meter', label: 'Meter', type: 'number', min: 0, unit },
        { id: 'assigneeId', label: 'Assigned to', type: 'picker', options: options.contacts(null, rec.assigneeId), placeholder: 'Unassigned' },
        { id: 'vendorId', label: 'Vendor', type: 'picker', options: options.vendors('service', rec.vendorId), placeholder: 'In-house', hint: 'Choose a shop if the work is sent out.' },
        { id: 'invoiceNumber', label: 'Invoice or PO number' },
        { id: 'notes', label: 'Instructions and notes', type: 'textarea', span: 2, rows: 3 },
      ]
    : [
        { id: 'vehicleId', label: 'Vehicle', type: 'picker', required: true, options: options.vehicles({ keep: rec.vehicleId }), span: 2 },
        { id: 'date', label: 'Completion date', type: 'date', required: true, validate: (v) => (v > today ? 'Service in the future belongs on a work order.' : null) },
        { id: 'startDate', label: 'Start date', type: 'date', validate: (v, all) => (v && all.date && v > all.date ? 'Must be on or before the completion date.' : null) },
        { id: 'meter', label: 'Meter at service', type: 'number', min: 0, unit },
        { id: 'repairClass', label: 'Repair priority class', type: 'select', required: true, options: () => REPAIR_CLASSES.map((c) => ({ value: c.id, label: c.label })) },
        { id: 'vendorId', label: 'Vendor', type: 'picker', options: options.vendors('service', rec.vendorId), placeholder: 'In-house' },
        { id: 'reference', label: 'Reference', placeholder: 'Invoice number' },
        { id: 'notes', label: 'Notes', type: 'textarea', span: 2, rows: 3 },
      ];

  const label = isWO ? (existing ? `Work order #${existing.number}` : 'New work order') : existing ? 'Edit service entry' : 'New service entry';
  const page = formPage({
    title: existing && isWO ? `Edit work order #${existing.number}` : label,
    crumbs: [isWO ? { label: 'Work orders', href: '#/work-orders' } : { label: 'Service history', href: '#/service' }, existing ? { label: isWO ? `#${existing.number}` : vehicleName(lookup.vehicle(existing.vehicleId)), href: `#/${isWO ? 'work-orders' : 'service'}/${existing.id}` } : { label: 'New' }],
    record: rec,
    saveLabel: isWO ? (existing ? 'Save work order' : 'Create work order') : 'Save service entry',
    sections: [
      { id: 'details', title: 'Details', icon: 'file', fields: detailFields, after: warn },
      {
        id: 'items',
        title: 'Line items',
        icon: 'list',
        fields: [
          { id: 'lineItems', label: 'Line items', type: 'custom', noLabel: true, span: 2, render: () => items, get: () => null },
          { id: 'totals', label: 'Totals', type: 'custom', noLabel: true, span: 2, render: () => totals, get: () => null },
        ],
      },
      { id: 'links', title: 'Issues and reminders', icon: 'check-check', fields: [{ id: 'links', label: 'Resolves', type: 'custom', noLabel: true, span: 2, render: () => links, get: () => null }] },
    ],
    onChange: (vals, fid) => {
      if (fid === 'vehicleId') {
        links.setVehicle(vals.vehicleId);
        unitV = vals.vehicleId;
        const v = lookup.vehicle(vals.vehicleId);
        if (!existing && v?.meter != null && (vals.meter === null || vals.meter === '')) page.form.set('meter', v.meter);
      }
      if (fid === 'vehicleId' || fid === 'meter' || fid === 'date') {
        const w = meterWarnings(store, { vehicleId: vals.vehicleId, value: vals.meter, date: vals.date || vals.issueDate || today, ignoreSource: existing ? { type: 'service', id: existing.id } : null });
        warn.replaceChildren(...w.map((t) => h('p', t)));
      }
    },
    onCancel: () => back(existing ? `/${isWO ? 'work-orders' : 'service'}/${existing.id}` : isWO ? '/work-orders' : '/service'),
    onSave: async (v) => {
      // Build on the stored record, not the one the form opened with: files
      // and other changes may have arrived meanwhile.
      const cur = existing && store.get(coll, existing.id);
      if (existing && !cur) {
        toast(`This ${isWO ? 'work order' : 'service entry'} was deleted, so the changes were not saved.`, { type: 'error' });
        return false;
      }
      const lineItems = items.value;
      const { discount, taxPercent } = totals.value;
      const { issueIds, reminderIds } = links.value;
      const base = { ...v, lineItems, discount, taxPercent, issueIds, reminderIds, vendorId: v.vendorId || null };
      delete base.links;
      delete base.totals;
      if (!isWO) {
        const saved = saveServiceEntry(store, { attachments: [], ...(cur || {}), ...base, startDate: v.startDate || v.date }, app.settings());
        page.form.markClean();
        toast(existing ? 'Service entry saved' : 'Service entry added');
        navigate(`/service/${saved.id}`, { replace: !existing });
        return;
      }
      let wo;
      if (existing) {
        wo = store.put('workOrders', { ...cur, ...base, assigneeId: v.assigneeId || null, dueDate: v.dueDate || null, startDate: v.startDate || null, completedDate: v.status === 'completed' ? existing.completedDate : null });
        // Keep a completed work order's service entry and the parts taken
        // from stock in step with its edits (an entry deleted from service
        // history stays deleted).
        if (wo.status === 'completed' && existing.status === 'completed' && store.get('serviceEntries', wo.serviceEntryId)) completeWorkOrder(store, wo, { date: wo.completedDate || today, meter: wo.meter }, app.settings());
      } else wo = store.put('workOrders', { attachments: [], ...base, number: await store.nextNumber('workOrders'), assigneeId: v.assigneeId || null, dueDate: v.dueDate || null, startDate: v.startDate || null });
      if (v.status === 'in_progress' || v.status === 'on_hold') {
        const veh = lookup.vehicle(wo.vehicleId);
        const shop = app.settings().vehicleStatuses.find((s) => s.id === 'in_shop');
        if (shop && veh && veh.status === 'active' && !existing) store.patch('vehicles', veh.id, { status: 'in_shop' });
      }
      page.form.markClean();
      toast(existing ? 'Work order saved' : `Work order #${wo.number} created`);
      navigate(`/work-orders/${wo.id}`, { replace: !existing });
    },
  });
  return { node: page.node, title: label, dirty: () => page.form.dirty() };
}

/**
 * The meter to complete at. The work order's was read when it was opened;
 * if the vehicle has been driven since, completing at that reading would
 * roll the vehicle's meter back.
 */
function completionMeter(wo, v) {
  const at = wo.meter === null || wo.meter === undefined || wo.meter === '' ? null : Number(wo.meter);
  return v?.meter != null && (at === null || Number(v.meter) > at) ? v.meter : at;
}

/** Ask for the completion date and meter, then complete the work order. */
export function completeDialog(wo) {
  const store = app.store;
  const v = lookup.vehicle(wo.vehicleId);
  // Reminders the work satisfies: the linked ones plus any whose task is on a line.
  const linked = new Set(wo.reminderIds || []);
  const candidates = [...new Map([...matchingReminders(store, wo.vehicleId, wo.lineItems), ...[...linked].map((id) => store.get('reminders', id)).filter(Boolean)].map((r) => [r.id, r])).values()];
  // Parts that would take stock below zero (beyond what an earlier completion took).
  const before = wo.stockUsed || (wo.stockDeducted ? Object.fromEntries(partsUsed(wo)) : {});
  const short = [...partsUsed(wo)]
    .map(([pid, qty]) => ({ part: lookup.part(pid), need: qty - (before[pid] || 0) }))
    .filter((x) => x.part && x.need > 0 && x.need > stockOnHand(x.part))
    .map((x) => h('p', `${x.part.description || x.part.number}: ${formatDecimal(x.need, 2)} needed, ${formatDecimal(stockOnHand(x.part), 2)} in stock.`));
  const meterWarn = h('div.form-warning', { role: 'status', 'aria-live': 'polite' });
  return openFormDialog({
    title: `Complete work order #${wo.number}`,
    intro: 'This adds the work to the vehicle service history, resolves the linked issues and reminders, and takes the parts out of inventory.',
    record: { date: app.today(), meter: completionMeter(wo, v), active: v?.status === 'in_shop', ...Object.fromEntries(candidates.map((r) => [`rem_${r.id}`, true])) },
    fields: [
      { id: 'date', label: 'Completed on', type: 'date', required: true, validate: (d) => (d > app.today() ? 'The completion date cannot be in the future.' : null) },
      { id: 'meter', label: 'Meter', type: 'number', min: 0, unit: meterUnitLabel(v) },
      v?.status === 'in_shop' ? { id: 'active', label: 'Back in service', type: 'checkbox', checkLabel: 'Set the vehicle back to Active', span: 2 } : null,
      ...candidates.map((r) => ({ id: `rem_${r.id}`, label: 'Reminder', type: 'checkbox', checkLabel: `Complete the ${lookup.taskName(r.taskId) || 'service'} reminder`, span: 2 })),
    ].filter(Boolean),
    after: [short.length ? h('div.form-warning', { role: 'status' }, h('p', h('strong', 'Not enough in stock. Completing takes these parts below zero.')), short) : null, meterWarn],
    // A meter out of line with the vehicle's other readings, as the service form warns.
    onChange: (vals, fid) => {
      if (fid !== 'meter' && fid !== 'date') return;
      const w = meterWarnings(store, { vehicleId: wo.vehicleId, value: vals.meter, date: vals.date || app.today(), ignoreSource: wo.serviceEntryId ? { type: 'service', id: wo.serviceEntryId } : null });
      meterWarn.replaceChildren(...w.map((t) => h('p', t)));
    },
    saveLabel: 'Complete',
    onSave: (vals) => {
      const current = store.get('workOrders', wo.id);
      if (!current) {
        toast('This work order was deleted.', { type: 'error' });
        return null;
      }
      const reminderIds = candidates.filter((r) => vals[`rem_${r.id}`]).map((r) => r.id);
      const entry = completeWorkOrder(store, { ...current, reminderIds }, vals, app.settings());
      if (vals.active) store.patch('vehicles', wo.vehicleId, { status: 'active' });
      toast(`Work order #${wo.number} completed`);
      return entry;
    },
  });
}
