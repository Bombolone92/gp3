/** Products and services. */
import { el, swap } from '../ui/dom.js';
import { dataTable, sortRows } from '../ui/table.js';
import { amountNode } from '../ui/format.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { pageHead, splitButton, searchBox, emptyState, viewState } from './page.js';
import { store } from '../lib/store.js';
import { openItemForm } from '../forms/item.js';
import { openImport } from './importer.js';
import { setQuery } from '../ui/router.js';

export function renderItems(main, route) {
  const st = viewState('items', { q: '', show: 'active', sort: { key: 'name', dir: 'asc' } });
  if (route.query.edit) {
    const it = store.item(route.query.edit);
    setQuery({ edit: null });
    if (it) setTimeout(() => openItemForm({ item: it }));
  }
  const q = st.q.trim().toLowerCase();
  let rows = store.itemsList({ includeInactive: st.show !== 'active' }).filter((i) => st.show !== 'inactive' || i.active === false);
  if (q) rows = rows.filter((i) => `${i.name} ${i.sku || ''} ${i.desc || ''}`.toLowerCase().includes(q));
  const used = new Map();
  for (const t of store.txns.values()) for (const l of t.lines || []) if (l.itemId) used.set(l.itemId, (used.get(l.itemId) || 0) + 1);
  const columns = [
    { key: 'name', label: 'Name', primary: true, render: (i) => el('div', {}, el('div.cell-main', {}, i.name, i.active === false ? el('span.badge', { style: { marginLeft: '8px' } }, 'Inactive') : null), i.desc ? el('div.cell-sub.truncate', { style: { maxWidth: '420px' } }, i.desc) : null), sortValue: (i) => i.name.toLowerCase() },
    { key: 'sku', label: 'SKU', hideMobile: true, render: (i) => i.sku || '', sortValue: (i) => i.sku || '' },
    { key: 'kind', label: 'Type', render: (i) => (i.kind === 'nonInventory' ? 'Non-inventory' : 'Service'), sortValue: (i) => i.kind },
    { key: 'income', label: 'Income account', hideMobile: true, render: (i) => store.accountName(i.incomeAccountId), sortable: false },
    { key: 'price', label: 'Sales price', align: 'right', amount: true, render: (i) => amountNode(i.price || 0), sortValue: (i) => i.price || 0 },
    { key: 'cost', label: 'Cost', align: 'right', hideMobile: true, render: (i) => (i.purchased ? amountNode(i.cost || 0) : ''), sortValue: (i) => i.cost || 0 },
    { key: 'tax', label: 'Taxable', hideMobile: true, render: (i) => (i.taxable ? 'Yes' : ''), sortable: false },
    {
      key: 'action', label: 'Action', srLabel: 'Action', className: 'actions-cell', sortable: false,
      render: (i) => el('button.row-link', {
        type: 'button',
        onclick: async () => {
          if (used.has(i.id)) {
            store.saveItem({ ...i, active: i.active === false });
            toast(i.active === false ? 'Made active' : 'Made inactive');
          } else if (await confirmDialog({ title: `Delete ${i.name}?`, message: 'It is not used on any transaction.', confirmLabel: 'Delete', danger: true })) {
            store.remove('items', i.id);
            toast('Deleted');
          }
        },
      }, used.has(i.id) ? (i.active === false ? 'Make active' : 'Make inactive') : 'Delete'),
    },
  ];
  rows = sortRows(rows, columns, st.sort);
  const table = dataTable({
    columns, rows, ariaLabel: 'Products and services',
    sort: st.sort, onSort: (s) => { st.sort = s; renderItems(main, { ...route, query: {} }); },
    onRowClick: (i) => openItemForm({ item: i }),
    empty: emptyState({ iconName: 'item', title: q ? 'No matches' : 'No products or services yet', text: 'Save what you sell to fill in invoices with one pick.', action: q ? null : el('button.btn.btn-primary', { type: 'button', onclick: () => openItemForm() }, 'New product or service') }),
  });
  swap(main, el('div.page', {},
    pageHead({ title: 'Products and services', crumbs: [['Sales', 'sales'], ['Products and services']], actions: [splitButton('New', () => openItemForm(), [{ label: 'Import from CSV', icon: 'upload', onClick: () => openImport('items') }])] }),
    el('div.toolbar', {},
      searchBox({ value: st.q, placeholder: 'Search by name or SKU', label: 'Search products and services', onInput: (v) => { st.q = v; renderItems(main, { ...route, query: {} }); main.querySelector('input[type="search"]')?.focus(); } }),
      el('select.select', { 'aria-label': 'Show', onchange: (e) => { st.show = e.target.value; renderItems(main, { ...route, query: {} }); } },
        ...[['active', 'Active'], ['all', 'All'], ['inactive', 'Inactive']].map(([v, l]) => el('option', { value: v, selected: st.show === v }, l)))),
    table.root));
}
