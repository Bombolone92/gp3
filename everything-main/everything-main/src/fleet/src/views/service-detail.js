import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit } from '../app.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { vehicleName } from '../core/format.js';
import { formatDate } from '../core/dates.js';
import { deleteServiceEntry } from '../core/actions.js';
import { statusPill } from '../ui/components.js';
import { detailHeader, kvList, sectionCard, vehicleCell, vendorCell, attachmentsPanel, commentsPanel, emptyPage, moreMenuButton, meterText } from './common.js';
import { lineItemsView, linkedView } from './service-doc.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  if (!store.get('serviceEntries', id)) return emptyPage('Service entry not found', 'It may have been deleted.');
  const get = () => store.get('serviceEntries', id);
  const editable = canEdit('serviceEntries');
  const header = ctx.live(() => {
    const e = get();
    if (!e) return null;
    return detailHeader({
      back: { label: 'Service history', href: '#/service' },
      title: `Service on ${formatDate(e.date)}`,
      meta: [vehicleCell(e.vehicleId, { sub: false }), e.meter != null ? h('span', meterText(e.meter, lookup.vehicle(e.vehicleId))) : null, statusPill('repair', e.repairClass), store.get('workOrders', e.workOrderId) ? h('a', { href: `#/work-orders/${e.workOrderId}` }, `From work order #${store.get('workOrders', e.workOrderId).number}`) : null],
      actions: [
        h('button.btn', { type: 'button', onClick: () => print() }, icon('printer', 15), 'Print'),
        editable ? h('a.btn', { href: `#/service/${id}/edit` }, icon('pencil', 15), 'Edit') : null,
        editable
          ? moreMenuButton([
              {
                label: 'Delete service entry',
                icon: 'trash',
                danger: true,
                run: async () => {
                  if (!(await confirmDialog({ title: 'Delete service entry?', message: 'Its meter reading is removed and reminder completions it recorded are undone.', confirmLabel: 'Delete', danger: true }))) return;
                  deleteServiceEntry(store, id);
                  toast('Service entry deleted');
                  navigate('/service');
                },
              },
            ])
          : null,
      ],
    });
  }, ['serviceEntries', 'vehicles', 'workOrders']);
  const body = ctx.live(() => {
    const e = get();
    if (!e) return null;
    return h(
      'div.col',
      sectionCard('Details', kvList([
        ['Vehicle', vehicleCell(e.vehicleId)],
        ['Started', e.startDate ? formatDate(e.startDate) : null],
        ['Completed', formatDate(e.date)],
        ['Meter', e.meter != null ? meterText(e.meter, lookup.vehicle(e.vehicleId)) : null],
        ['Vendor', e.vendorId ? vendorCell(e.vendorId) : 'In-house'],
        ['Reference', e.reference],
        ['Notes', e.notes ? h('span.pre-wrap', e.notes) : null],
      ])),
      lineItemsView(e),
      linkedView(e),
    );
  }, ['serviceEntries', 'issues', 'reminders', 'serviceTasks', 'parts']);
  return { node: h('div.page.detail-page', header, h('div.two-col', body, h('div.col', attachmentsPanel('serviceEntries', id, { title: 'Receipts and photos' }), commentsPanel('serviceEntries', id)))), title: `Service: ${vehicleName(lookup.vehicle(get().vehicleId))}` };
}
