import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { app, lookup, canEdit } from '../app.js';
import { formatDate } from '../core/dates.js';
import { poTotals } from '../core/totals.js';
import { PO_STATUSES, statusMeta } from '../core/status.js';
import { statusPill } from '../ui/components.js';
import { vendorCell, money, options, dash } from './common.js';

export function render(ctx) {
  const editable = canEdit('purchaseOrders');
  return renderList(ctx, {
    key: 'purchase-orders',
    title: 'Purchase orders',
    coll: 'purchaseOrders',
    watch: ['vendors', 'parts'],
    csvName: 'purchase-orders',
    actions: editable ? [h('a.btn.primary', { href: '#/purchase-orders/new' }, icon('plus', 16), 'Add purchase order')] : [],
    tabs: [
      { id: 'open', label: 'Open', filter: (p) => ['draft', 'ordered', 'partial'].includes(p.status) },
      { id: 'received', label: 'Received', filter: (p) => p.status === 'received' },
      { id: 'all', label: 'All' },
    ],
    filters: [fieldFilter('status', 'Status', 'status', () => PO_STATUSES.map((s) => ({ value: s.id, label: s.label, dot: s.tone }))), fieldFilter('vendor', 'Vendor', 'vendorId', options.vendors('parts'))],
    defaultSort: { id: 'number', dir: 'desc' },
    search: (p) => [`#${p.number}`, lookup.vendorName(p.vendorId), p.notes, ...(p.items || []).map((it) => lookup.part(it.partId)?.description || '')].join(' '),
    rowHref: (p) => `#/purchase-orders/${p.id}`,
    columns: [
      { id: 'number', label: 'Number', render: (p) => h('strong', `#${p.number}`), sort: (p) => Number(p.number) },
      { id: 'vendor', label: 'Vendor', render: (p) => vendorCell(p.vendorId), sort: (p) => lookup.vendorName(p.vendorId), csv: (p) => lookup.vendorName(p.vendorId) },
      { id: 'status', label: 'Status', render: (p) => statusPill('po', p.status), sort: (p) => PO_STATUSES.findIndex((s) => s.id === p.status), csv: (p) => statusMeta('po', p.status).label },
      { id: 'date', label: 'Ordered', render: (p) => formatDate(p.date), sort: (p) => p.date },
      { id: 'expected', label: 'Expected', render: (p) => (p.expectedDate ? formatDate(p.expectedDate) : dash()), sort: (p) => p.expectedDate || '' },
      { id: 'items', label: 'Items', align: 'r', render: (p) => String((p.items || []).length), sort: (p) => (p.items || []).length },
      { id: 'total', label: 'Total', align: 'r', render: (p) => h('span.money', money(poTotals(p).total)), sort: (p) => poTotals(p).total, csv: (p) => (poTotals(p).total / 100).toFixed(2) },
    ],
    mobile: (p) => h('div.grow', h('div.row', h('strong.grow', `PO #${p.number}`), statusPill('po', p.status)), h('div.subtle', `${lookup.vendorName(p.vendorId) || 'No vendor'} · ${money(poTotals(p).total)}`)),
    empty: { icon: 'cart', title: 'No purchase orders', text: 'Order parts from vendors and receive them into inventory.', action: () => h('a.btn.primary', { href: '#/purchase-orders/new' }, icon('plus', 16), 'Add purchase order') },
  });
}
