import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit } from '../app.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { openMenu } from '../ui/menu.js';
import { formatDate, relativeDays } from '../core/dates.js';
import { reopenWorkOrder } from '../core/actions.js';
import { WORK_ORDER_STATUSES, statusMeta } from '../core/status.js';
import { statusPill, pill } from '../ui/components.js';
import { detailHeader, kvList, sectionCard, vehicleCell, vendorCell, contactCell, attachmentsPanel, commentsPanel, emptyPage, moreMenuButton, meterText, deleteWithUndo } from './common.js';
import { lineItemsView, linkedView } from './service-doc.js';
import { completeDialog } from './service-form.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  if (!store.get('workOrders', id)) return emptyPage('Work order not found', 'It may have been deleted.');
  const get = () => store.get('workOrders', id);
  const editable = canEdit('workOrders');

  const header = ctx.live(() => {
    const w = get();
    if (!w) return null;
    const today = app.today();
    const done = w.status === 'completed';
    const late = w.dueDate && w.dueDate < today && !done && w.status !== 'cancelled';
    return detailHeader({
      back: { label: 'Work orders', href: '#/work-orders' },
      title: `Work order #${w.number}`,
      meta: [statusPill('workOrder', w.status), late ? pill('Late', 'red') : null, statusPill('repair', w.repairClass), vehicleCell(w.vehicleId, { sub: false }), w.assigneeId ? h('span.row.gap-4', icon('user', 14), contactCell(w.assigneeId)) : null],
      actions: editable
        ? [
            done
              ? h('button.btn', { type: 'button', onClick: () => (reopenWorkOrder(store, w), toast('Work order reopened')) }, icon('rotate', 15), 'Reopen')
              : h('button.btn.primary', { type: 'button', onClick: () => completeDialog(w) }, icon('circle-check', 16), 'Complete'),
            !done
              ? h('button.btn', { type: 'button', onClick: (e) => openMenu(e.currentTarget, WORK_ORDER_STATUSES.filter((s) => s.id !== 'completed').map((s) => ({ label: s.label, checked: s.id === w.status, run: () => s.id !== w.status && (store.patch('workOrders', id, { status: s.id }), toast(`Status set to ${s.label}`)) })), { label: 'Status' }) }, 'Status', icon('chevron-down', 15))
              : null,
            h('a.btn', { href: `#/work-orders/${id}/edit` }, icon('pencil', 15), 'Edit'),
            moreMenuButton([
              { label: 'Print', icon: 'printer', run: () => print() },
              store.get('serviceEntries', w.serviceEntryId) ? { label: 'View service entry', icon: 'wrench', run: () => navigate(`/service/${w.serviceEntryId}`) } : null,
              { label: 'Delete work order', icon: 'trash', danger: true, run: () => deleteWithUndo('workOrders', w, { label: 'work order', message: store.get('serviceEntries', w.serviceEntryId) ? 'The work order is deleted. Its service entry stays in the history.' : null, onDeleted: () => navigate('/work-orders') }) },
            ]),
          ]
        : [h('button.btn', { type: 'button', onClick: () => print() }, icon('printer', 15), 'Print')],
    });
  }, ['workOrders', 'vehicles', 'contacts', 'serviceEntries']);

  const body = ctx.live(() => {
    const w = get();
    if (!w) return null;
    const v = lookup.vehicle(w.vehicleId);
    const today = app.today();
    return h(
      'div.col',
      sectionCard('Details', kvList([
        ['Vehicle', vehicleCell(w.vehicleId)],
        ['Status', `${statusMeta('workOrder', w.status).label}${w.completedDate ? ` on ${formatDate(w.completedDate)}` : ''}`],
        ['Issue date', formatDate(w.issueDate)],
        ['Scheduled start', w.startDate ? formatDate(w.startDate) : null],
        ['Expected completion', w.dueDate ? `${formatDate(w.dueDate)}${w.status !== 'completed' ? ` (${relativeDays(w.dueDate, today)})` : ''}` : null],
        ['Meter', w.meter != null ? meterText(w.meter, v) : null],
        ['Assigned to', w.assigneeId ? contactCell(w.assigneeId) : null],
        ['Vendor', w.vendorId ? vendorCell(w.vendorId) : 'In-house'],
        ['Invoice or PO', w.invoiceNumber],
        ['Instructions', w.notes ? h('span.pre-wrap', w.notes) : null],
        ['Service entry', w.serviceEntryId ? (store.get('serviceEntries', w.serviceEntryId) ? h('a', { href: `#/service/${w.serviceEntryId}` }, 'View in service history') : h('span.subtle', 'Deleted from service history')) : null],
      ])),
      lineItemsView(w),
      linkedView(w),
    );
  }, ['workOrders', 'issues', 'reminders', 'serviceTasks', 'parts', 'serviceEntries']);

  return { node: h('div.page.detail-page', header, h('div.two-col', body, h('div.col', attachmentsPanel('workOrders', id), commentsPanel('workOrders', id)))), title: `Work order #${get().number}` };
}
