import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList, fieldFilter } from '../ui/grid.js';
import { app, canEdit } from '../app.js';
import { formatDecimal } from '../core/format.js';
import { stockOnHand, lowStock } from '../core/actions.js';
import { pill } from '../ui/components.js';
import { dash, money, loadImage, archiveBulk } from './common.js';
import { importParts } from './importers.js';
import { stat } from './service.js';

export function render(ctx) {
  const store = app.store;
  const editable = canEdit('parts');
  return renderList(ctx, {
    key: 'parts',
    title: 'Parts',
    intro: 'Inventory used on work orders and service entries. Stock goes down when work is completed and up when purchase orders are received.',
    coll: 'parts',
    watch: ['purchaseOrders'],
    csvName: 'parts',
    actions: editable ? [h('a.btn', { href: '#/purchase-orders' }, icon('cart', 15), 'Purchase orders'), h('a.btn.primary', { href: '#/parts/new' }, icon('plus', 16), 'Add part')] : [],
    more: editable ? [{ label: 'Import from CSV', icon: 'upload', run: importParts }] : [],
    tabs: [
      { id: 'active', label: 'Active', filter: (p) => !p.archived },
      { id: 'low', label: 'Low stock', dot: 'orange', filter: (p) => !p.archived && lowStock(p) },
      { id: 'archived', label: 'Archived', filter: (p) => p.archived },
    ],
    filters: [
      fieldFilter('category', 'Category', 'category', () => app.settings().partCategories.map((c) => ({ value: c, label: c }))),
      fieldFilter('manufacturer', 'Manufacturer', (p) => p.manufacturer || '', () => [...new Set(store.all('parts').map((p) => p.manufacturer).filter(Boolean))].sort().map((m) => ({ value: m, label: m }))),
      { id: 'location', label: 'Location', options: () => app.settings().partLocations.map((l) => ({ value: l, label: l })), match: (p, vals) => (p.locations || []).some((l) => vals.has(l.location)) },
    ],
    defaultSort: { id: 'number', dir: 'asc' },
    search: (p) => [p.number, p.description, p.manufacturer, p.mpn, p.category, p.upc].join(' '),
    rowHref: (p) => `#/parts/${p.id}`,
    summary: (rows) => h('div.summary-stats', stat('Parts', rows.length), stat('Units on hand', formatDecimal(rows.reduce((a, p) => a + stockOnHand(p), 0), 1)), stat('Inventory value', money(rows.reduce((a, p) => a + Math.round(stockOnHand(p) * (Number(p.unitCost) || 0)), 0))), stat('Low stock', rows.filter(lowStock).length)),
    columns: [
      { id: 'number', label: 'Part', fixed: true, render: (p) => { const t = h('span.thumb.sm', icon('package', 15)); if (p.photo) loadImage(t, p.photo); return h('span.cell-vehicle', t, h('span.cell-text', h('span.cell-title', p.number), h('span.cell-sub', p.description || ''))); }, sort: (p) => p.number, csv: (p) => p.number },
      { id: 'description', label: 'Description', hidden: true, render: (p) => p.description || dash(), sort: (p) => p.description || '' },
      { id: 'category', label: 'Category', render: (p) => p.category || dash(), sort: (p) => p.category || '' },
      { id: 'manufacturer', label: 'Manufacturer', render: (p) => p.manufacturer || dash(), sort: (p) => p.manufacturer || '' },
      { id: 'mpn', label: 'Manufacturer part number', hidden: true, render: (p) => p.mpn || dash(), sort: (p) => p.mpn || '' },
      { id: 'location', label: 'Location', render: (p) => h('span.truncate', (p.locations || []).map((l) => `${l.location}${l.aisle ? ` (${l.aisle})` : ''}`).join(', ') || '-'), csv: (p) => (p.locations || []).map((l) => `${l.location}${l.aisle ? ` (${l.aisle})` : ''}`).join('; ') },
      { id: 'onhand', label: 'On hand', align: 'r', render: (p) => h('span.row.gap-4.end', lowStock(p) ? pill('Low', 'orange') : null, h('span.num', `${formatDecimal(stockOnHand(p), 2)} ${p.unit || ''}`)), sort: stockOnHand, csv: (p) => Math.round(stockOnHand(p) * 1000) / 1000 },
      { id: 'cost', label: 'Unit cost', align: 'r', render: (p) => h('span.money', money(p.unitCost || 0)), sort: (p) => Number(p.unitCost) || 0, csv: (p) => ((Number(p.unitCost) || 0) / 100).toFixed(2) },
      { id: 'value', label: 'Value', align: 'r', render: (p) => h('span.money', money(Math.round(stockOnHand(p) * (Number(p.unitCost) || 0)))), sort: (p) => stockOnHand(p) * (Number(p.unitCost) || 0), csv: (p) => (Math.round(stockOnHand(p) * (Number(p.unitCost) || 0)) / 100).toFixed(2) },
    ],
    mobile: (p) => h('div.grow', h('div.row', h('strong.grow.truncate', `${p.number} ${p.description || ''}`), lowStock(p) ? pill('Low', 'orange') : null), h('div.subtle', `${formatDecimal(stockOnHand(p), 2)} on hand · ${money(p.unitCost || 0)}`)),
    bulk: editable ? [archiveBulk('parts', 'part')] : null,
    empty: { icon: 'package', title: 'No parts yet', text: 'Track filters, fluids, and other parts you keep in stock.', action: () => h('a.btn.primary', { href: '#/parts/new' }, icon('plus', 16), 'Add part') },
  });
}
