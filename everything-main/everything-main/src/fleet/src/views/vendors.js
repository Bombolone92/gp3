import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { renderList } from '../ui/grid.js';
import { app, canEdit } from '../app.js';
import { telHref } from '../core/format.js';
import { VENDOR_KINDS } from '../core/status.js';
import { docTotals } from '../core/totals.js';
import { dash, money, archiveBulk } from './common.js';

export function render(ctx) {
  const store = app.store;
  const editable = canEdit('vendors');
  const kinds = (v) => (v.kinds || []).map((k) => VENDOR_KINDS.find((x) => x.id === k)?.label).filter(Boolean);
  const spendMap = () => {
    const m = new Map();
    const add = (id, c) => id && m.set(id, (m.get(id) || 0) + c);
    for (const f of store.all('fuel')) add(f.vendorId, Number(f.total) || 0);
    for (const e of store.all('serviceEntries')) add(e.vendorId, docTotals(e).total);
    for (const e of store.all('expenses')) add(e.vendorId, Number(e.amount) || 0);
    return m;
  };
  let spend = spendMap();
  ctx.onDispose(store.subscribe((c) => (c.has('fuel') || c.has('serviceEntries') || c.has('expenses')) && (spend = spendMap())));
  return renderList(ctx, {
    key: 'vendors',
    title: 'Vendors',
    intro: 'Fuel stations, repair shops, parts suppliers, and other businesses you work with.',
    coll: 'vendors',
    csvName: 'vendors',
    actions: editable ? [h('a.btn.primary', { href: '#/vendors/new' }, icon('plus', 16), 'Add vendor')] : [],
    tabs: [
      { id: 'active', label: 'Active', filter: (v) => !v.archived },
      { id: 'archived', label: 'Archived', filter: (v) => v.archived },
    ],
    filters: [{ id: 'kind', label: 'Classification', options: () => VENDOR_KINDS.map((k) => ({ value: k.id, label: k.label })), match: (v, vals) => (v.kinds || []).some((k) => vals.has(k)) }],
    defaultSort: { id: 'name', dir: 'asc' },
    search: (v) => [v.name, v.contactName, v.email, v.phone, v.address, ...kinds(v)].join(' '),
    rowHref: (v) => `#/vendors/${v.id}`,
    columns: [
      { id: 'name', label: 'Name', fixed: true, render: (v) => h('span.cell-text', h('span.cell-title', v.name), v.address ? h('span.cell-sub', v.address) : null), sort: (v) => v.name },
      { id: 'kinds', label: 'Classification', render: (v) => h('span.cell-labels', kinds(v).map((k) => h('span.mini-tag', k))), sort: (v) => kinds(v).join(','), csv: (v) => kinds(v).join('; ') },
      { id: 'contact', label: 'Contact', render: (v) => v.contactName || dash(), sort: (v) => v.contactName || '' },
      { id: 'phone', label: 'Phone', render: (v) => (v.phone ? h('a', { href: telHref(v.phone) }, v.phone) : dash()), sort: (v) => v.phone || '' },
      { id: 'email', label: 'Email', render: (v) => (v.email ? h('a', { href: `mailto:${v.email}` }, v.email) : dash()), sort: (v) => v.email || '' },
      { id: 'spend', label: 'Total spend', align: 'r', render: (v) => h('span.money', money(spend.get(v.id) || 0)), sort: (v) => spend.get(v.id) || 0, csv: (v) => ((spend.get(v.id) || 0) / 100).toFixed(2) },
    ],
    mobile: (v) => h('div.grow', h('strong', v.name), h('div.subtle.truncate', [kinds(v).join(', '), v.phone].filter(Boolean).join(' · '))),
    bulk: editable ? [archiveBulk('vendors', 'vendor')] : null,
    empty: { icon: 'store', title: 'No vendors yet', text: 'Add the places you buy fuel, parts, and service to track spending by vendor.', action: editable ? () => h('a.btn.primary', { href: '#/vendors/new' }, icon('plus', 16), 'Add vendor') : null },
  });
}
