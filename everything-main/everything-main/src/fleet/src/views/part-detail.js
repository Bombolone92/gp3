import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit } from '../app.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { openFormDialog } from '../ui/form.js';
import { vehicleName, formatDecimal } from '../core/format.js';
import { formatDate } from '../core/dates.js';
import { stockOnHand, lowStock, adjustStock } from '../core/actions.js';
import { pill, statusPill } from '../ui/components.js';
import { detailHeader, kvList, sectionCard, vehicleCell, attachmentsPanel, emptyPage, moreMenuButton, simpleTable, deleteWithUndo, money } from './common.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  if (!store.get('parts', id)) return emptyPage('Part not found', 'It may have been deleted.');
  const get = () => store.get('parts', id);
  const editable = canEdit('parts');
  const body = ctx.live(() => {
    const p = get();
    if (!p) return null;
    const usage = [];
    for (const coll of ['serviceEntries', 'workOrders']) {
      for (const d of store.all(coll)) {
        if (coll === 'workOrders' && d.status === 'completed') continue;
        for (const li of d.lineItems || []) for (const x of li.parts || []) if (x.partId === id) usage.push({ id: `${d.id}:${x.id}`, coll, doc: d, qty: x.qty, cost: x.unitCost, date: coll === 'serviceEntries' ? d.date : d.issueDate });
      }
    }
    const pos = store.all('purchaseOrders').filter((po) => (po.items || []).some((it) => it.partId === id));
    return h(
      'div',
      detailHeader({
        back: { label: 'Parts', href: '#/parts' },
        thumb: h('span.thumb.lg', icon('package', 32)),
        title: p.description || p.number,
        sub: [p.number, p.manufacturer, p.mpn].filter(Boolean).join(' · '),
        meta: [h('span.strong', `${formatDecimal(stockOnHand(p), 2)} ${p.unit || ''} on hand`), lowStock(p) ? pill('Low stock', 'orange') : null, p.category ? h('span.mini-tag', p.category) : null, p.archived ? pill('Archived', 'gray') : null],
        actions: editable
          ? [
              h('button.btn', { type: 'button', onClick: () => adjust(p) }, icon('sliders', 15), 'Adjust stock'),
              h('a.btn', { href: `#/parts/${id}/edit` }, icon('pencil', 15), 'Edit'),
              moreMenuButton([
                canEdit('purchaseOrders') ? { label: 'Order more', icon: 'cart', run: () => navigate(`/purchase-orders/new?part=${id}`) } : null,
                { label: p.archived ? 'Restore' : 'Archive', icon: p.archived ? 'unarchive' : 'archive', run: () => (store.patch('parts', id, { archived: !p.archived }), toast(p.archived ? 'Part restored' : 'Part archived')) },
                { label: 'Delete part', icon: 'trash', danger: true, run: () => deleteWithUndo('parts', p, { label: 'part', onDeleted: () => navigate('/parts') }) },
              ]),
            ]
          : [],
      }),
      h(
        'div.two-col',
        h(
          'div.col',
          sectionCard('Details', kvList([
            ['Part number', p.number],
            ['Description', p.description],
            ['Category', p.category],
            ['Manufacturer', p.manufacturer],
            ['Manufacturer part number', p.mpn],
            ['UPC', p.upc],
            ['Unit', p.unit],
            ['Unit cost', money(p.unitCost || 0)],
            ['Inventory value', money(Math.round(stockOnHand(p) * (Number(p.unitCost) || 0)))],
            ['Notes', p.notes ? h('span.pre-wrap', p.notes) : null],
          ])),
          h('section.card.panel', h('div.card-head', h('h2.grow', 'Stock by location')), h('div.card-body.flush', simpleTable({
            rows: (p.locations || []).map((l, i) => ({ ...l, id: String(i) })),
            caption: 'Stock by location',
            empty: 'No locations.',
            columns: [
              { id: 'loc', label: 'Location', render: (l) => l.location },
              { id: 'aisle', label: 'Aisle', render: (l) => l.aisle || '-' },
              { id: 'qty', label: 'On hand', align: 'r', render: (l) => h('span.num', formatDecimal(l.qty, 2)) },
              { id: 'reorder', label: 'Reorder at', align: 'r', render: (l) => (l.reorderPoint != null ? String(l.reorderPoint) : '-') },
              { id: 'status', label: 'Stock', render: (l) => (l.reorderPoint != null && (Number(l.qty) || 0) <= Number(l.reorderPoint) ? pill('Low', 'orange') : '') },
            ],
          }))),
        ),
        h(
          'div.col',
          h('section.card.panel', h('div.card-head', h('h2.grow', 'Used on')), h('div.card-body.flush', simpleTable({
            rows: usage,
            caption: 'Part usage',
            defaultSort: { id: 'date', dir: 'desc' },
            rowHref: (u) => `#/${u.coll === 'serviceEntries' ? 'service' : 'work-orders'}/${u.doc.id}`,
            empty: 'Not used on any work yet.',
            columns: [
              { id: 'date', label: 'Date', render: (u) => formatDate(u.date), sort: (u) => u.date },
              { id: 'what', label: 'Where', render: (u) => (u.coll === 'serviceEntries' ? 'Service entry' : `Work order #${u.doc.number}`) },
              { id: 'vehicle', label: 'Vehicle', render: (u) => vehicleCell(u.doc.vehicleId, { sub: false, link: false }), sort: (u) => vehicleName(lookup.vehicle(u.doc.vehicleId)) },
              { id: 'qty', label: 'Qty', align: 'r', render: (u) => formatDecimal(u.qty, 2) },
            ],
          }))),
          pos.length ? sectionCard('Purchase orders', h('ul.widget-list.no-top', pos.map((po) => h('li', h('a.widget-row', { href: `#/purchase-orders/${po.id}` }, statusPill('po', po.status), h('span.grow', `PO #${po.number}`), h('span.subtle', formatDate(po.date))))))) : null,
        ),
      ),
    );
  }, ['parts', 'serviceEntries', 'workOrders', 'purchaseOrders']);

  function adjust(p) {
    const loc = p.locations?.[0]?.location || app.settings().partLocations[0];
    openFormDialog({
      title: 'Adjust stock',
      intro: 'Use this for counts, damage, or returns. Work orders and purchase orders change stock on their own.',
      record: { location: loc, change: null },
      fields: [
        { id: 'location', label: 'Location', type: 'select', required: true, options: () => [...new Set([...(p.locations || []).map((l) => l.location), ...app.settings().partLocations])] },
        {
          id: 'change',
          label: 'Change by',
          type: 'number',
          required: true,
          hint: 'Negative to remove stock, for example -2.',
          validate: (n, all) => {
            if (!n) return 'Enter a change other than zero.';
            const at = Number(get()?.locations?.find((l) => l.location === all.location)?.qty) || 0;
            return n < 0 && at + n < 0 ? `Only ${formatDecimal(Math.max(0, at), 2)} on hand at ${all.location}.` : null;
          },
        },
        { id: 'reason', label: 'Reason' },
      ],
      saveLabel: 'Adjust',
      onSave: (v) => {
        adjustStock(store, p.id, v.location, Number(v.change));
        toast(`Stock adjusted by ${v.change > 0 ? '+' : ''}${v.change}`);
      },
    });
  }
  return { node: h('div.page.detail-page', body, h('div.two-col.top-gap', h('div.col', attachmentsPanel('parts', id, { title: 'Photos and documents' })), h('div.col'))), title: get().number };
}
