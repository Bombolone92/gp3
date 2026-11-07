/**
 * Transaction list pages: All sales, Invoices, Estimates, All purchases
 * transactions, Bills. One configurable view.
 */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { dataTable, sortRows } from '../ui/table.js';
import { selectInput } from '../ui/fields.js';
import { confirmDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { amountNode, statusBadge, dateText } from '../ui/format.js';
import { navigate, setQuery } from '../ui/router.js';
import { download } from '../ui/dom.js';
import { pageHead, splitButton, searchBox, emptyState, viewState, menuButton, freshQuery } from './page.js';
import { store } from '../lib/store.js';
import { TXN_TYPES, typeLabel } from '../lib/txn.js';
import { PERIODS, periodRange, today, addDays } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';
import { toCSV } from '../lib/csv.js';
import { openTxnForm, openTxn } from '../forms/index.js';
import { openPayBills } from '../forms/payment.js';
import { printTxn } from '../ui/print.js';
import { convertEstimate } from '../forms/sales.js';

const SALES_TYPES = ['invoice', 'payment', 'estimate', 'salesReceipt', 'creditMemo', 'refundReceipt'];
const EXPENSE_TYPES = ['expense', 'check', 'bill', 'billPayment', 'vendorCredit', 'ccCredit', 'purchaseOrder'];

const PAGES = {
  sales: {
    title: 'All sales', crumbs: [['Sales', 'sales'], ['All sales']], types: SALES_TYPES, side: 'sales',
    newLabel: 'New transaction', newType: 'invoice',
    newMenu: [['Invoice', 'invoice'], ['Payment', 'payment'], ['Estimate', 'estimate'], ['Sales receipt', 'salesReceipt'], ['Credit memo', 'creditMemo'], ['Refund receipt', 'refundReceipt']],
    statuses: [['all', 'All statuses'], ['open', 'Open'], ['overdue', 'Overdue'], ['notDue', 'Not due yet'], ['paid', 'Paid'], ['pending', 'Pending estimates']],
  },
  invoices: {
    title: 'Invoices', crumbs: [['Sales', 'sales'], ['Invoices']], types: ['invoice'], side: 'sales',
    newLabel: 'Create invoice', newType: 'invoice', newMenu: [['Invoice', 'invoice'], ['Record payment', 'payment']],
    statuses: [['all', 'All statuses'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['notDue', 'Not due yet'], ['partial', 'Partially paid'], ['paid', 'Paid'], ['voided', 'Voided']],
  },
  estimates: {
    title: 'Estimates', crumbs: [['Sales', 'sales'], ['Estimates']], types: ['estimate'], side: 'sales',
    newLabel: 'Create estimate', newType: 'estimate', newMenu: [['Estimate', 'estimate']],
    statuses: [['all', 'All statuses'], ['pending', 'Pending'], ['accepted', 'Accepted'], ['converted', 'Converted'], ['rejected', 'Rejected'], ['closed', 'Closed'], ['expired', 'Expired']],
  },
  expenses: {
    title: 'All purchases', crumbs: [['Purchases', 'expenses'], ['All purchases']], types: EXPENSE_TYPES, side: 'purchases',
    newLabel: 'New transaction', newType: 'expense',
    newMenu: [['Expense', 'expense'], ['Check', 'check'], ['Bill', 'bill'], ['Pay bills', 'pay-bills'], ['Purchase order', 'purchaseOrder'], ['Vendor credit', 'vendorCredit'], ['Credit card refund', 'ccCredit']],
    statuses: [['all', 'All statuses'], ['open', 'Open bills'], ['overdue', 'Overdue bills'], ['notDue', 'Bills not due yet'], ['paid', 'Paid'], ['po', 'Open purchase orders']],
  },
  bills: {
    title: 'Bills', crumbs: [['Purchases', 'expenses'], ['Bills']], types: ['bill'], side: 'purchases',
    newLabel: 'Create bill', newType: 'bill', newMenu: [['Bill', 'bill'], ['Pay bills', 'pay-bills'], ['Vendor credit', 'vendorCredit']],
    statuses: [['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['notDue', 'Not due yet'], ['paid', 'Paid'], ['all', 'All bills']],
  },
};

function matchesStatus(t, status) {
  if (status === 'all') return true;
  const s = store.status(t);
  switch (status) {
    case 'open': return ['open', 'overdue', 'partial'].includes(s.code) && (t.type === 'invoice' || t.type === 'bill');
    case 'unpaid': return ['open', 'overdue', 'partial'].includes(s.code);
    case 'overdue': return s.code === 'overdue';
    case 'notDue': return (t.type === 'invoice' || t.type === 'bill') && (s.code === 'open' || s.code === 'partial');
    case 'partial': return s.code === 'partial';
    case 'paid': return s.code === 'paid' || ((t.type === 'payment' || t.type === 'billPayment' || t.type === 'salesReceipt' || t.type === 'expense' || t.type === 'check') && s.code !== 'voided');
    case 'voided': return !!t.voided;
    case 'po': return t.type === 'purchaseOrder' && s.code === 'open';
    default: return s.code === status;
  }
}

function moneyBar(side) {
  const sm = store.summary();
  const now = today();
  const since = addDays(now, -30);
  let paid30 = 0; let paidCount = 0;
  for (const t of store.txns.values()) {
    if (t.voided || t.date < since) continue;
    if (side === 'sales' && (t.type === 'payment' || t.type === 'salesReceipt')) { paid30 += store.total(t); paidCount++; }
    if (side === 'purchases' && (t.type === 'billPayment' || t.type === 'expense' || t.type === 'check')) { paid30 += store.total(t); paidCount++; }
  }
  const open = side === 'sales' ? sm.openInvoices : sm.openBills;
  const overdue = side === 'sales' ? sm.overdueInvoices : sm.overdueBills;
  const notDue = open - overdue;
  const total = Math.max(1, open + paid30);
  const seg = (label, value, count, color, filter) => el('button.money-seg', { type: 'button', onclick: () => filter && setFilter(filter) },
    el('span.money-seg-value', {}, formatMoney(value)),
    el('span.money-seg-label', {}, `${count} ${label}`),
    el('span.money-seg-bar', { style: { background: `var(${color})`, width: '100%' } }));
  let setFilter = () => {};
  const node = el('div.money-bar', {},
    el('div.money-group', { style: { flex: `${Math.max(open, 1)} 1 0` } },
      el('div.money-group-title', {}, `Unpaid`),
      el('div.money-segs', {},
        seg(side === 'sales' ? 'overdue' : 'overdue', overdue, side === 'sales' ? sm.overdueCount : sm.overdueBillCount, '--negative', 'overdue'),
        seg('not due yet', notDue, (side === 'sales' ? sm.openCount - sm.overdueCount : sm.billCount - sm.overdueBillCount), '--chart-other', 'notDue'))),
    el('div.money-group', { style: { flex: `${Math.max(paid30, 1)} 1 0` } },
      el('div.money-group-title', {}, 'Paid'),
      el('div.money-segs', {}, seg('in the last 30 days', paid30, paidCount, '--positive', 'paid'))));
  void total;
  return { node, onFilter(fn) { setFilter = fn; } };
}

export function renderTxnList(main, route) {
  const cfg = PAGES[route.name];
  const st = viewState(`list:${route.name}`, {
    period: route.name === 'bills' ? 'all' : 'last365', status: route.query.status || (route.name === 'bills' ? 'unpaid' : 'all'),
    type: 'all', q: '', sort: { key: 'date', dir: 'desc' }, contact: route.query.contact || null,
  });
  const query = freshQuery(route);
  if (query.status) st.status = query.status;

  const openNewType = (type) => (type === 'pay-bills' ? openPayBills() : openTxnForm({ type }));
  const actions = [
    route.name === 'bills' ? el('button.btn', { type: 'button', onclick: () => openPayBills() }, 'Pay bills') : null,
    splitButton(cfg.newLabel, () => openNewType(cfg.newType), cfg.newMenu.map(([label, type]) => ({ label, onClick: () => openNewType(type) }))),
  ];

  const now = today();
  const range = periodRange(st.period, { now, fiscalStartMonth: store.settings.fiscalStartMonth });
  const q = st.q.trim().toLowerCase();
  let rows = store.txnList((t) => cfg.types.includes(t.type)
    && (st.type === 'all' || t.type === st.type)
    && (!range.from || t.date >= range.from) && (!range.to || t.date <= range.to)
    && (!st.contact || t.contactId === st.contact));
  rows = rows.filter((t) => matchesStatus(t, st.status));
  if (q) rows = rows.filter((t) => [t.num, store.contactName(t.contactId), t.memo, typeLabel(t.type), formatMoney(store.total(t))].join(' ').toLowerCase().includes(q));

  const isBills = route.name === 'bills';
  const columns = [
    { key: 'date', label: 'Date', width: '110px', render: (t) => dateText(t.date), sortValue: (t) => t.date, defaultDir: 'desc', hideMobile: false },
    cfg.types.length > 1 ? { key: 'type', label: 'Type', render: (t) => typeLabel(t.type), sortValue: (t) => typeLabel(t.type) } : null,
    { key: 'num', label: 'No.', width: '90px', render: (t) => t.num || '', sortValue: (t) => t.num || '', hideMobile: true },
    { key: 'name', label: cfg.side === 'sales' ? 'Customer' : 'Payee', primary: true, render: (t) => el('span.cell-main', {}, store.contactName(t.contactId) || (t.type === 'transfer' ? '' : 'No name')), sortValue: (t) => store.contactName(t.contactId) },
    isBills ? { key: 'due', label: 'Due date', render: (t) => dateText(t.dueDate), sortValue: (t) => t.dueDate || '' } : { key: 'memo', label: cfg.side === 'sales' ? 'Memo' : 'Category', hideMobile: true, render: (t) => el('span.truncate', { style: { maxWidth: '280px', display: 'inline-block' } }, cfg.side === 'sales' ? t.memo || '' : store.splitName(t) || t.memo || ''), sortable: false },
    { key: 'amount', label: isBills ? 'Bill amount' : 'Amount', align: 'right', amount: true, render: (t) => amountNode(store.total(t)), sortValue: (t) => store.total(t) },
    isBills || route.name === 'invoices' ? { key: 'open', label: 'Open balance', align: 'right', render: (t) => amountNode(store.openBalance(t.id)), sortValue: (t) => store.openBalance(t.id) } : null,
    { key: 'status', label: 'Status', render: (t) => statusBadge(store.status(t)), sortValue: (t) => store.status(t).label },
    { key: 'action', label: 'Action', srLabel: 'Action', className: 'actions-cell', sortable: false, render: (t) => rowAction(t) },
  ].filter(Boolean);
  rows = sortRows(rows, columns, st.sort);

  let tableApi;
  const selBar = el('div.selection-bar', { hidden: true });
  const onSel = (sel) => {
    selBar.hidden = !sel.size;
    selBar.replaceChildren(
      el('span', {}, `${sel.size} selected`),
      el('button.btn.btn-sm', { type: 'button', onclick: () => exportRows(rows.filter((t) => sel.has(t.id))) }, 'Export'),
      el('button.btn.btn-sm', { type: 'button', onclick: () => batchDelete([...sel]) }, 'Delete'),
      el('button.btn-link', { type: 'button', onclick: () => tableApi.clearSelection() }, 'Clear'));
  };

  const periodSel = selectInput({ options: PERIODS.filter(([k]) => k !== 'custom'), value: st.period, ariaLabel: 'Date range', onChange: (v) => { st.period = v; rerender(); } });
  const statusSel = selectInput({ options: cfg.statuses, value: st.status, ariaLabel: 'Status', onChange: (v) => { st.status = v; setQuery({ status: null }); rerender(); } });
  const typeSel = cfg.types.length > 1 ? selectInput({ options: [['all', 'All transactions'], ...cfg.types.map((t) => [t, TXN_TYPES[t].plural])], value: st.type, ariaLabel: 'Type', onChange: (v) => { st.type = v; rerender(); } }) : null;
  const search = searchBox({ value: st.q, placeholder: 'Search by number, name, or amount', label: `Search ${cfg.title.toLowerCase()}`, onInput: (v) => { st.q = v; rerender(true); } });

  const bar = moneyBar(cfg.side);
  bar.onFilter((f) => { st.status = cfg.statuses.some((s) => s[0] === f) ? f : 'all'; rerender(); });

  tableApi = dataTable({
    columns, rows, ariaLabel: cfg.title,
    selectable: true, onSelectionChange: onSel,
    sort: st.sort, onSort: (s) => { st.sort = s; rerender(); },
    onRowClick: (t) => openTxn(t.id),
    empty: emptyState({ iconName: cfg.side === 'sales' ? 'invoice' : 'receipt', title: 'Nothing here yet', text: q || st.status !== 'all' ? 'No transactions match these filters.' : `Create your first ${TXN_TYPES[cfg.newType].label.toLowerCase()} to see it here.` }),
    footer: (data) => columns.map((c, i) => (i === 0 ? `${data.length} ${data.length === 1 ? 'transaction' : 'transactions'}` : c.key === 'amount' ? formatMoney(data.reduce((s, t) => s + store.total(t), 0)) : c.key === 'open' ? formatMoney(data.reduce((s, t) => s + store.openBalance(t.id), 0)) : '')),
  });

  const contactChip = st.contact ? el('button.chip', { type: 'button', 'aria-pressed': 'true', onclick: () => { st.contact = null; setQuery({ contact: null }); rerender(); } }, store.contactName(st.contact), el('span', { html: icon('x', 14) }), el('span.sr-only', {}, 'Remove filter')) : null;

  swap(main, el('div.page', {},
    pageHead({ title: cfg.title, crumbs: cfg.crumbs, actions }),
    cfg.types.length > 1 || isBills || route.name === 'invoices' ? bar.node : null,
    el('div.toolbar', {}, search, typeSel, statusSel, periodSel, contactChip,
      el('div.toolbar-end', {},
        el('button.icon-btn', { type: 'button', 'aria-label': 'Export to CSV', title: 'Export to CSV', html: icon('download', 18), onclick: () => exportRows(rows) }),
        el('button.icon-btn', { type: 'button', 'aria-label': 'Print list', title: 'Print list', html: icon('printer', 18), onclick: () => window.print() }))),
    selBar,
    tableApi.root));

  function rerender(keepFocus) {
    const active = keepFocus ? document.activeElement : null;
    const pos = active?.selectionStart;
    renderTxnList(main, { ...route, query: {} });
    if (active?.type === 'search') {
      const again = main.querySelector('input[type="search"]');
      again?.focus();
      if (pos !== undefined) again?.setSelectionRange(pos, pos);
    }
  }
}

function rowAction(t) {
  const s = store.status(t);
  if (t.type === 'invoice' && ['open', 'overdue', 'partial'].includes(s.code)) {
    return el('button.row-link', { type: 'button', onclick: () => openTxnForm({ type: 'payment', draft: { contactId: t.contactId, preselect: t.id } }) }, 'Record payment');
  }
  if (t.type === 'bill' && ['open', 'overdue', 'partial'].includes(s.code)) {
    return el('button.row-link', { type: 'button', onclick: () => openTxnForm({ type: 'billPayment', draft: { contactId: t.contactId, preselect: t.id } }) }, 'Make payment');
  }
  if (t.type === 'estimate' && (t.status || 'pending') === 'pending') {
    return el('button.row-link', { type: 'button', onclick: () => convertEstimate(t) }, 'Create invoice');
  }
  if (['invoice', 'salesReceipt', 'estimate', 'creditMemo', 'refundReceipt'].includes(t.type)) {
    return el('button.row-link', { type: 'button', onclick: () => printTxn(t) }, 'Print');
  }
  return el('button.row-link', { type: 'button', onclick: () => openTxn(t.id) }, 'View/Edit');
}

function exportRows(rows) {
  const data = [['Date', 'Type', 'No.', 'Name', 'Memo', 'Amount', 'Open balance', 'Status'],
    ...rows.map((t) => [t.date, typeLabel(t.type), t.num || '', store.contactName(t.contactId), t.memo || '', (store.total(t) / 100).toFixed(2), ['invoice', 'bill'].includes(t.type) ? (store.openBalance(t.id) / 100).toFixed(2) : '', store.status(t).label])];
  download(toCSV(data), `transactions-${today()}.csv`, 'text/csv');
}

async function batchDelete(ids) {
  const ok = await confirmDialog({ title: `Delete ${ids.length} transaction${ids.length > 1 ? 's' : ''}?`, message: 'They are removed from your books. This cannot be undone.', confirmLabel: 'Delete', danger: true });
  if (!ok) return;
  let n = 0;
  for (const id of ids) {
    try { store.deleteTxn(id); n++; } catch (err) { toastError(err); break; }
  }
  toast(`${n} deleted`);
}

export const TXN_LIST_ROUTES = Object.keys(PAGES);
export { navigate };
