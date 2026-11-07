/** Customers and vendors: the list, and one contact's page. */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { dataTable, sortRows } from '../ui/table.js';
import { amountNode, statusBadge, dateText, initials } from '../ui/format.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { navigate } from '../ui/router.js';
import { download } from '../ui/dom.js';
import { pageHead, splitButton, searchBox, emptyState, viewState, tabs, menuButton } from './page.js';
import { store } from '../lib/store.js';
import { typeLabel } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { today } from '../lib/dates.js';
import { toCSV } from '../lib/csv.js';
import { openContactForm } from '../forms/contact.js';
import { openTxnForm, openTxn } from '../forms/index.js';
import { openImport } from './importer.js';

export function renderContacts(main, route) {
  const kind = route.name === 'vendors' ? 'vendor' : 'customer';
  const Kind = kind === 'vendor' ? 'Vendor' : 'Customer';
  const st = viewState(`contacts:${kind}`, { q: '', show: 'active', sort: { key: 'name', dir: 'asc' } });
  const balances = store.contactBalances(kind);
  const info = store.docInfo();
  const now = today();
  const overdueBy = new Map();
  const openBy = new Map();
  for (const t of store.txns.values()) {
    if (t.voided || t.type !== (kind === 'vendor' ? 'bill' : 'invoice')) continue;
    const open = info.open.get(t.id) || 0;
    if (open <= 0) continue;
    openBy.set(t.contactId, (openBy.get(t.contactId) || 0) + 1);
    if (t.dueDate && t.dueDate < now) overdueBy.set(t.contactId, (overdueBy.get(t.contactId) || 0) + open);
  }
  const q = st.q.trim().toLowerCase();
  let rows = store.contactsOf(kind, { includeInactive: st.show !== 'active' }).filter((c) => (st.show !== 'inactive' || c.active === false));
  if (q) rows = rows.filter((c) => [c.displayName, c.company, c.email, c.phone].join(' ').toLowerCase().includes(q));
  const columns = [
    { key: 'name', label: kind === 'vendor' ? 'Vendor' : 'Customer', primary: true, render: (c) => el('div', {}, el('div.cell-main', {}, c.displayName, c.active === false ? el('span.badge', { style: { marginLeft: '8px' } }, 'Inactive') : null), c.company && c.company !== c.displayName ? el('div.cell-sub', {}, c.company) : null), sortValue: (c) => c.displayName.toLowerCase() },
    { key: 'email', label: 'Email', hideMobile: true, render: (c) => c.email || '', sortValue: (c) => c.email || '' },
    { key: 'phone', label: 'Phone', hideMobile: true, render: (c) => c.phone || c.mobile || '', sortable: false },
    { key: 'open', label: kind === 'vendor' ? 'Open bills' : 'Open invoices', align: 'right', hideMobile: true, render: (c) => String(openBy.get(c.id) || ''), sortValue: (c) => openBy.get(c.id) || 0 },
    { key: 'overdue', label: 'Overdue', align: 'right', hideMobile: true, render: (c) => (overdueBy.get(c.id) ? amountNode(overdueBy.get(c.id)) : ''), sortValue: (c) => overdueBy.get(c.id) || 0 },
    { key: 'balance', label: 'Open balance', align: 'right', amount: true, render: (c) => amountNode(balances.get(c.id) || 0), sortValue: (c) => balances.get(c.id) || 0 },
    {
      key: 'action', label: 'Action', srLabel: 'Action', className: 'actions-cell', sortable: false,
      render: (c) => el('div.row', { style: { justifyContent: 'flex-end' } },
        kind === 'customer'
          ? el('button.row-link', { type: 'button', onclick: () => openTxnForm({ type: 'invoice', draft: { contactId: c.id } }) }, 'Create invoice')
          : el('button.row-link', { type: 'button', onclick: () => openTxnForm({ type: 'bill', draft: { contactId: c.id } }) }, 'Create bill')),
    },
  ];
  rows = sortRows(rows, columns, st.sort);
  const totalOpen = rows.reduce((s, c) => s + (balances.get(c.id) || 0), 0);
  const totalOverdue = rows.reduce((s, c) => s + (overdueBy.get(c.id) || 0), 0);

  const table = dataTable({
    columns, rows, ariaLabel: `${Kind}s`,
    sort: st.sort, onSort: (s) => { st.sort = s; renderContacts(main, route); },
    onRowClick: (c) => navigate(`${kind}/${c.id}`),
    empty: emptyState({ iconName: kind === 'vendor' ? 'vendor' : 'users', title: q ? 'No matches' : `No ${kind}s yet`, text: q ? 'Try a different search.' : `Add your ${kind}s to bill them, track what they owe, and run reports by ${kind}.`, action: q ? null : el('button.btn.btn-primary', { type: 'button', onclick: () => openContactForm({ kind }) }, `Add ${kind}`) }),
  });

  const exportCsv = () => download(toCSV([
    ['Display name', 'Company', 'First name', 'Last name', 'Email', 'Phone', 'Street', 'City', 'State', 'ZIP', 'Country', 'Open balance', 'Notes'],
    ...rows.map((c) => [c.displayName, c.company || '', c.firstName || '', c.lastName || '', c.email || '', c.phone || '', c.billAddr?.line1 || '', c.billAddr?.city || '', c.billAddr?.state || '', c.billAddr?.zip || '', c.billAddr?.country || '', ((balances.get(c.id) || 0) / 100).toFixed(2), c.notes || '']),
  ]), `${kind}s-${today()}.csv`, 'text/csv');

  swap(main, el('div.page', {},
    pageHead({
      title: kind === 'vendor' ? 'Vendors' : 'Customers',
      crumbs: kind === 'vendor' ? [['Purchases', 'expenses'], ['Vendors']] : [['Sales', 'sales'], ['Customers']],
      actions: [splitButton(`New ${kind}`, () => openContactForm({ kind }), [{ label: `Import ${kind}s`, icon: 'upload', onClick: () => openImport(kind === 'vendor' ? 'vendors' : 'customers') }, { label: 'Export to CSV', icon: 'download', onClick: exportCsv }])],
    }),
    el('div.stat-row', {},
      el('div.stat', {}, el('div.kpi-label', {}, 'Open balance'), el('div.kpi-value', {}, formatMoney(totalOpen))),
      el('div.stat', {}, el('div.kpi-label', {}, 'Overdue'), el('div.kpi-value', { class: totalOverdue ? 'neg' : '' }, formatMoney(totalOverdue))),
      el('div.stat', {}, el('div.kpi-label', {}, `${Kind}s`), el('div.kpi-value', {}, String(rows.length)))),
    el('div.toolbar', {},
      searchBox({ value: st.q, placeholder: `Search ${kind}s`, label: `Search ${kind}s`, onInput: (v) => { st.q = v; renderContacts(main, route); main.querySelector('input[type="search"]')?.focus(); } }),
      el('select.select', { 'aria-label': 'Show', onchange: (e) => { st.show = e.target.value; renderContacts(main, route); } },
        ...[['active', 'Active'], ['all', 'All'], ['inactive', 'Inactive']].map(([v, l]) => el('option', { value: v, selected: st.show === v }, l)))),
    table.root));
}

export function renderContact(main, route) {
  const c = store.contact(route.params[0]);
  if (!c) {
    swap(main, el('div.page', {}, emptyState({ title: 'Contact not found', text: 'It may have been deleted.', action: el('a.btn', { href: '#/customers' }, 'Back to customers') })));
    return;
  }
  const kind = c.kind;
  const st = viewState(`contact:${c.id}`, { tab: 'txns' });
  const balance = store.contactBalances(kind).get(c.id) || 0;
  const info = store.docInfo();
  const now = today();
  let overdue = 0;
  const txns = store.txnList((t) => t.contactId === c.id || (t.lines || []).some((l) => l.contactId === c.id || l.customerId === c.id));
  for (const t of txns) if ((t.type === 'invoice' || t.type === 'bill') && !t.voided && t.dueDate && t.dueDate < now) overdue += Math.max(0, info.open.get(t.id) || 0);

  const columns = [
    { key: 'date', label: 'Date', render: (t) => dateText(t.date), sortable: false },
    { key: 'type', label: 'Type', primary: true, render: (t) => el('span.cell-main', {}, typeLabel(t.type)), sortable: false },
    { key: 'num', label: 'No.', render: (t) => t.num || '', sortable: false },
    { key: 'due', label: 'Due date', hideMobile: true, render: (t) => dateText(t.dueDate), sortable: false },
    { key: 'amount', label: 'Amount', align: 'right', amount: true, render: (t) => amountNode(store.total(t)), sortable: false },
    { key: 'open', label: 'Open balance', align: 'right', render: (t) => (['invoice', 'bill', 'payment', 'billPayment', 'creditMemo', 'vendorCredit'].includes(t.type) ? amountNode(store.openBalance(t.id)) : ''), sortable: false },
    { key: 'status', label: 'Status', render: (t) => statusBadge(store.status(t)), sortable: false },
  ];
  const table = dataTable({ columns, rows: txns, ariaLabel: `Transactions for ${c.displayName}`, onRowClick: (t) => openTxn(t.id), empty: emptyState({ title: 'No transactions yet', text: kind === 'vendor' ? 'Bills and expenses for this vendor appear here.' : 'Invoices and payments for this customer appear here.' }) });

  const addr = c.billAddr || {};
  const details = el('dl.keyval', {},
    c.company ? [el('dt', {}, 'Company'), el('dd', {}, c.company)] : null,
    c.email ? [el('dt', {}, 'Email'), el('dd', {}, el('a', { href: `mailto:${c.email}` }, c.email))] : null,
    c.phone ? [el('dt', {}, 'Phone'), el('dd', {}, el('a', { href: `tel:${c.phone}` }, c.phone))] : null,
    c.mobile ? [el('dt', {}, 'Mobile'), el('dd', {}, c.mobile)] : null,
    c.website ? [el('dt', {}, 'Website'), el('dd', {}, c.website)] : null,
    addr.line1 ? [el('dt', {}, 'Billing address'), el('dd', { style: { whiteSpace: 'pre-line' } }, [addr.line1, addr.line2, [addr.city, addr.state, addr.zip].filter(Boolean).join(' '), addr.country].filter(Boolean).join('\n'))] : null,
    c.terms ? [el('dt', {}, 'Terms'), el('dd', {}, (store.settings.terms || []).find((t) => t.id === c.terms)?.name || '')] : null,
    kind === 'vendor' && c.defaultAccountId ? [el('dt', {}, 'Default category'), el('dd', {}, store.accountName(c.defaultAccountId))] : null,
    c.notes ? [el('dt', {}, 'Notes'), el('dd', { style: { whiteSpace: 'pre-line' } }, c.notes)] : null);

  const newItems = kind === 'customer'
    ? [['Invoice', 'invoice'], ['Payment', 'payment'], ['Estimate', 'estimate'], ['Sales receipt', 'salesReceipt'], ['Credit memo', 'creditMemo'], ['Refund receipt', 'refundReceipt']]
    : [['Bill', 'bill'], ['Expense', 'expense'], ['Check', 'check'], ['Bill payment', 'billPayment'], ['Purchase order', 'purchaseOrder'], ['Vendor credit', 'vendorCredit']];

  const remove = async () => {
    const used = store.contactInUse(c.id);
    const ok = await confirmDialog({ title: used ? `Make ${c.displayName} inactive?` : `Delete ${c.displayName}?`, message: used ? 'This contact has transactions, so it is made inactive instead of deleted. Its history stays in your reports.' : 'This contact is removed for good.', confirmLabel: used ? 'Make inactive' : 'Delete', danger: !used });
    if (!ok) return;
    try {
      const r = store.deleteContact(c.id);
      toast(r === 'inactive' ? 'Made inactive' : 'Deleted');
      if (r === 'deleted') navigate(kind === 'vendor' ? 'vendors' : 'customers');
    } catch (err) { toastError(err); }
  };

  swap(main, el('div.page', {},
    pageHead({
      title: el('span.row', {}, el('span.avatar.avatar-lg', { 'aria-hidden': 'true' }, initials(c.displayName)), c.displayName),
      crumbs: kind === 'vendor' ? [['Vendors', 'vendors'], [c.displayName]] : [['Customers', 'customers'], [c.displayName]],
      actions: [
        el('button.btn', { type: 'button', onclick: () => openContactForm({ kind, contact: c }) }, 'Edit'),
        menuButton('More', [
          kind === 'customer' ? { label: 'Customer statement', icon: 'printer', onClick: () => navigate(`report/openInvoices?contact=${c.id}`) } : null,
          { label: c.active === false ? 'Make active' : 'Make inactive', onClick: () => store.saveContact({ ...c, active: c.active === false }) },
          { label: 'Delete', icon: 'trash', danger: true, onClick: remove },
        ].filter(Boolean)),
        splitButton('New transaction', () => openTxnForm({ type: newItems[0][1], draft: { contactId: c.id } }), newItems.map(([label, type]) => ({ label, onClick: () => openTxnForm({ type, draft: { contactId: c.id } }) }))),
      ],
    }),
    el('div.stat-row', {},
      el('div.stat', {}, el('div.kpi-label', {}, 'Open balance'), el('div.kpi-value', {}, formatMoney(balance))),
      el('div.stat', {}, el('div.kpi-label', {}, 'Overdue'), el('div.kpi-value', { class: overdue ? 'neg' : '' }, formatMoney(overdue)))),
    tabs([['txns', 'Transaction list'], ['details', `${kind === 'vendor' ? 'Vendor' : 'Customer'} details`]], st.tab, (k) => { st.tab = k; renderContact(main, route); }),
    st.tab === 'txns' ? table.root : el('div.card', {}, el('div.card-body', {}, details))));
}
