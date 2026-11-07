import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit } from '../app.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { openFormDialog } from '../ui/form.js';
import { formatDecimal } from '../core/format.js';
import { formatDate } from '../core/dates.js';
import { poTotals } from '../core/totals.js';
import { receivePurchaseOrder } from '../core/actions.js';
import { statusPill } from '../ui/components.js';
import { detailHeader, kvList, sectionCard, vendorCell, attachmentsPanel, commentsPanel, emptyPage, moreMenuButton, deleteWithUndo, money } from './common.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  if (!store.get('purchaseOrders', id)) return emptyPage('Purchase order not found', 'It may have been deleted.');
  const get = () => store.get('purchaseOrders', id);
  const editable = canEdit('purchaseOrders');
  const body = ctx.live(() => {
    const po = get();
    if (!po) return null;
    const t = poTotals(po);
    const open = ['ordered', 'partial'].includes(po.status);
    return h(
      'div',
      detailHeader({
        back: { label: 'Purchase orders', href: '#/purchase-orders' },
        title: `Purchase order #${po.number}`,
        meta: [statusPill('po', po.status), po.vendorId ? vendorCell(po.vendorId) : null, h('span.money.strong', money(t.total))],
        actions: editable
          ? [
              po.status === 'draft' ? h('button.btn.primary', { type: 'button', onClick: () => (store.patch('purchaseOrders', id, { status: 'ordered' }), toast('Marked as ordered')) }, icon('send', 15), 'Mark as ordered') : null,
              open ? h('button.btn.primary', { type: 'button', onClick: () => receive(po) }, icon('package-check', 16), 'Receive') : null,
              h('button.btn', { type: 'button', onClick: () => print() }, icon('printer', 15), 'Print'),
              po.status !== 'received' ? h('a.btn', { href: `#/purchase-orders/${id}/edit` }, icon('pencil', 15), 'Edit') : null,
              moreMenuButton([
                po.status !== 'received' && po.status !== 'cancelled' ? { label: 'Cancel order', icon: 'ban', run: () => (store.patch('purchaseOrders', id, { status: 'cancelled' }), toast('Purchase order cancelled')) } : null,
                { label: 'Delete', icon: 'trash', danger: true, run: () => deleteWithUndo('purchaseOrders', po, { label: 'purchase order', message: po.status === 'received' || po.status === 'partial' ? 'Stock already received stays in inventory.' : null, onDeleted: () => navigate('/purchase-orders') }) },
              ]),
            ]
          : [],
      }),
      h(
        'div.two-col',
        h(
          'div.col',
          h(
            'section.card.panel',
            h('div.card-head', h('h2.grow', 'Parts')),
            h(
              'div.table-wrap',
              h(
                'table.table.compact',
                h('thead', h('tr', h('th', { scope: 'col' }, 'Part'), h('th.r', { scope: 'col' }, 'Ordered'), h('th.r', { scope: 'col' }, 'Received'), h('th.r', { scope: 'col' }, 'Unit cost'), h('th.r', { scope: 'col' }, 'Total'))),
                h(
                  'tbody',
                  (po.items || []).map((it) => {
                    const p = lookup.part(it.partId);
                    return h('tr', h('td', p ? h('a', { href: `#/parts/${p.id}` }, p.description || p.number) : 'Deleted part', h('div.cell-sub', p?.number || '')), h('td.r.num', formatDecimal(it.qty, 2)), h('td.r.num', formatDecimal(it.received || 0, 2)), h('td.r.money', money(it.unitCost)), h('td.r.money', money(Math.round((Number(it.qty) || 0) * (Number(it.unitCost) || 0)))));
                  }),
                ),
              ),
            ),
            h('dl.totals.readonly', h('div', h('dt', 'Subtotal'), h('dd.money', money(t.subtotal))), h('div', h('dt', `Tax (${po.taxPercent || 0}%)`), h('dd.money', money(t.tax))), h('div', h('dt', 'Shipping'), h('dd.money', money(t.shipping))), h('div.grand', h('dt', 'Total'), h('dd.money', money(t.total)))),
          ),
        ),
        h(
          'div.col',
          sectionCard('Details', kvList([
            ['Vendor', po.vendorId ? vendorCell(po.vendorId) : null],
            ['Order date', formatDate(po.date)],
            ['Expected', po.expectedDate ? formatDate(po.expectedDate) : null],
            ['Received', po.receivedDate ? formatDate(po.receivedDate) : null],
            ['Receive into', po.location],
            ['Notes', po.notes ? h('span.pre-wrap', po.notes) : null],
          ])),
        ),
      ),
    );
  }, ['purchaseOrders', 'parts', 'vendors']);

  function receive(po) {
    const fields = (po.items || [])
      .filter((it) => (Number(it.received) || 0) < (Number(it.qty) || 0))
      .map((it) => ({ id: `r_${it.id}`, label: `${lookup.part(it.partId)?.description || 'Part'} (${formatDecimal((Number(it.qty) || 0) - (Number(it.received) || 0), 2)} outstanding)`, type: 'number', min: 0, step: '0.01', span: 2 }));
    const rec = Object.fromEntries((po.items || []).map((it) => [`r_${it.id}`, Math.max(0, (Number(it.qty) || 0) - (Number(it.received) || 0))]));
    openFormDialog({
      title: `Receive purchase order #${po.number}`,
      intro: `Received parts are added to stock at ${po.location || 'the default location'}.`,
      record: { ...rec, date: app.today() },
      fields: [{ id: 'date', label: 'Received on', type: 'date', required: true, span: 2 }, ...fields],
      saveLabel: 'Receive',
      onSave: (v) => {
        const received = Object.fromEntries((po.items || []).map((it) => [it.id, Number(v[`r_${it.id}`]) || 0]));
        if (!Object.values(received).some((q) => q > 0)) {
          toast('Enter the quantity received for at least one part.', { type: 'error' });
          return false;
        }
        // Add to what is received now, which may have changed on another device.
        const out = receivePurchaseOrder(store, get() || po, received, v.date);
        toast(out.status === 'received' ? 'All parts received and added to stock' : 'Parts received. Some are still outstanding.');
      },
    });
  }
  return { node: h('div.page.detail-page', body, h('div.two-col.top-gap', h('div.col', attachmentsPanel('purchaseOrders', id, { title: 'Invoices and documents' })), h('div.col', commentsPanel('purchaseOrders', id)))), title: `PO #${get().number}` };
}
