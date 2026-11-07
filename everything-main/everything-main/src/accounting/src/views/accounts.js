/** Chart of accounts, and an account's register. */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { dataTable } from '../ui/table.js';
import { amountNode, dateText } from '../ui/format.js';
import { toast, toastError } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { navigate } from '../ui/router.js';
import { download } from '../ui/dom.js';
import { selectInput } from '../ui/fields.js';
import { pageHead, splitButton, searchBox, emptyState, viewState } from './page.js';
import { store } from '../lib/store.js';
import { ACCOUNT_TYPES, isBalanceSheet, typeInfo, descendantIds } from '../lib/accounts.js';
import { typeLabel } from '../lib/txn.js';
import { PERIODS, periodRange, today } from '../lib/dates.js';
import { toCSV } from '../lib/csv.js';
import { openAccountForm } from '../forms/account.js';
import { openTxn, openTxnForm } from '../forms/index.js';

export function renderAccounts(main) {
  const st = viewState('accounts', { q: '', type: 'all', show: 'active' });
  const q = st.q.trim().toLowerCase();
  const rows = store.chart({ includeInactive: st.show !== 'active' })
    .filter(({ account: a }) => (st.type === 'all' || a.type === st.type) && (st.show !== 'inactive' || a.active === false))
    .filter(({ account: a }) => !q || `${a.number || ''} ${a.name} ${a.description || ''}`.toLowerCase().includes(q));
  const bankBalances = new Map();
  for (const l of store.bankLines.values()) bankBalances.set(l.accountId, true);
  const columns = [
    { key: 'name', label: 'Name', primary: true, render: ({ account: a, depth }) => el('div', { style: { paddingLeft: `${depth * 20}px` } }, el('span.cell-main', {}, a.number ? `${a.number} ` : '', a.name), a.active === false ? el('span.badge', { style: { marginLeft: '8px' } }, 'Inactive') : null, a.role ? el('span.sr-only', {}, ' (system account)') : null), sortable: false },
    { key: 'type', label: 'Account type', render: ({ account: a }) => ACCOUNT_TYPES[a.type].label, sortable: false },
    { key: 'desc', label: 'Description', hideMobile: true, render: ({ account: a }) => el('span.truncate', { style: { maxWidth: '260px', display: 'inline-block' } }, a.description || ''), sortable: false },
    { key: 'balance', label: 'Balance', align: 'right', amount: true, render: ({ account: a }) => (isBalanceSheet(a.type) ? amountNode(store.accountBalance(a.id, { includeSubs: false })) : ''), sortable: false },
    {
      key: 'action', label: 'Action', srLabel: 'Action', className: 'actions-cell', sortable: false,
      render: ({ account: a }) => {
        const more = el('button.icon-btn', { type: 'button', 'aria-label': `More actions for ${a.name}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: icon('chevDown', 16) });
        more.addEventListener('click', () => openMenu(more, [
          { label: 'Edit', icon: 'pencil', onClick: () => openAccountForm({ account: a }) },
          { label: 'Run report', icon: 'reports', onClick: () => navigate(`report/gl?accounts=${a.id}`) },
          a.type === 'bank' || a.type === 'creditCard' ? { label: 'Reconcile', icon: 'scale', onClick: () => navigate(`reconcile/${a.id}`) } : null,
          a.active === false ? { label: 'Make active', onClick: () => store.saveAccount({ ...a, active: true }) } : null,
          !a.role ? { label: a.active === false ? 'Delete' : 'Make inactive or delete', icon: 'trash', danger: true, onClick: () => removeAccount(a) } : null,
        ].filter(Boolean), { align: 'end' }));
        return el('div.row', { style: { justifyContent: 'flex-end' } },
          el('a.row-link', { href: `#/register/${a.id}` }, isBalanceSheet(a.type) ? 'View register' : 'Run report'), more);
      },
    },
  ];
  const table = dataTable({
    columns, rows, rowKey: (r) => r.account.id, ariaLabel: 'Chart of accounts',
    onRowClick: (r) => navigate(`register/${r.account.id}`),
    empty: emptyState({ iconName: 'bank', title: 'No accounts match', text: 'Try another filter.' }),
  });
  const exportCsv = () => download(toCSV([['Number', 'Name', 'Type', 'Description', 'Balance'], ...rows.map(({ account: a }) => [a.number || '', store.accountName(a.id, { withNumber: false }), ACCOUNT_TYPES[a.type].label, a.description || '', isBalanceSheet(a.type) ? (store.accountBalance(a.id, { includeSubs: false }) / 100).toFixed(2) : ''])]), `chart-of-accounts-${today()}.csv`, 'text/csv');
  swap(main, el('div.page', {},
    pageHead({ title: 'Chart of accounts', crumbs: [['Accounting', 'accounts'], ['Chart of accounts']], actions: [el('a.btn', { href: '#/report/accountList' }, 'Run report'), splitButton('New account', () => openAccountForm(), [{ label: 'Export to CSV', icon: 'download', onClick: exportCsv }])] }),
    el('div.toolbar', {},
      searchBox({ value: st.q, placeholder: 'Filter by name or number', label: 'Filter accounts', onInput: (v) => { st.q = v; renderAccounts(main); main.querySelector('input[type="search"]')?.focus(); } }),
      selectInput({ options: [['all', 'All account types'], ...Object.entries(ACCOUNT_TYPES).map(([k, v]) => [k, v.label])], value: st.type, ariaLabel: 'Account type', onChange: (v) => { st.type = v; renderAccounts(main); } }),
      selectInput({ options: [['active', 'Active'], ['all', 'All'], ['inactive', 'Inactive']], value: st.show, ariaLabel: 'Show', onChange: (v) => { st.show = v; renderAccounts(main); } }),
      el('div.toolbar-end', {}, el('button.icon-btn', { type: 'button', 'aria-label': 'Export to CSV', title: 'Export to CSV', html: icon('download', 18), onclick: exportCsv }), el('button.icon-btn', { type: 'button', 'aria-label': 'Print', title: 'Print', html: icon('printer', 18), onclick: () => window.print() }))),
    table.root));
}

async function removeAccount(a) {
  const inUse = store.accountInUse(a.id);
  const ok = await confirmDialog({
    title: inUse ? `Make ${a.name} inactive?` : `Delete ${a.name}?`,
    message: inUse ? 'This account has transactions or sub-accounts, so it is made inactive. Its history stays in your reports.' : 'This account has no transactions and is removed for good.',
    confirmLabel: inUse ? 'Make inactive' : 'Delete', danger: !inUse,
  });
  if (!ok) return;
  try {
    const r = store.deleteAccount(a.id);
    toast(r === 'inactive' ? 'Account made inactive' : 'Account deleted');
  } catch (err) { toastError(err); }
}

export function renderRegister(main, route) {
  const a = store.account(route.params[0]);
  if (!a) {
    swap(main, el('div.page', {}, emptyState({ title: 'Account not found', action: el('a.btn', { href: '#/accounts' }, 'Chart of accounts') })));
    return;
  }
  const st = viewState(`register:${a.id}`, { period: 'all', q: '', subs: true });
  const range = periodRange(st.period, { now: today(), fiscalStartMonth: store.settings.fiscalStartMonth });
  const ids = st.subs ? [...descendantIds(a.id, [...store.accounts.values()])] : [a.id];
  const L = store.ledger('accrual');
  const reg = L.register(ids, range);
  const sign = typeInfo(a.type).sign;
  const bs = isBalanceSheet(a.type);
  const q = st.q.trim().toLowerCase();
  let rows = reg.rows;
  if (q) rows = rows.filter((r) => `${r.txn.num || ''} ${store.contactName(r.txn.contactId)} ${r.memo || r.txn.memo || ''} ${typeLabel(r.txn.type)}`.toLowerCase().includes(q));
  rows = rows.slice().reverse();
  const card = a.type === 'creditCard';
  const liability = sign < 0;
  const incLabel = a.type === 'bank' ? 'Deposit' : card ? 'Charge' : liability ? 'Increase' : 'Increase';
  const decLabel = a.type === 'bank' ? 'Payment' : card ? 'Payment' : 'Decrease';
  const columns = [
    { key: 'date', label: 'Date', render: (r) => dateText(r.txn.date), sortable: false },
    { key: 'num', label: 'Ref no.', hideMobile: true, render: (r) => r.txn.num || r.txn.ref || '', sortable: false },
    { key: 'type', label: 'Type', render: (r) => typeLabel(r.txn.type), sortable: false },
    { key: 'payee', label: 'Payee', primary: true, render: (r) => el('span.cell-main', {}, store.contactName(r.txn.contactId) || ''), sortable: false },
    { key: 'acct', label: 'Account', hideMobile: true, render: (r) => store.splitName(r.txn, a.id), sortable: false },
    { key: 'memo', label: 'Memo', hideMobile: true, render: (r) => el('span.truncate', { style: { maxWidth: '220px', display: 'inline-block' } }, r.memo || r.txn.memo || ''), sortable: false },
    { key: 'dec', label: decLabel, align: 'right', render: (r) => (r.amount * sign < 0 ? amountNode(-r.amount * sign) : ''), sortable: false },
    { key: 'inc', label: incLabel, align: 'right', render: (r) => (r.amount * sign > 0 ? amountNode(r.amount * sign) : ''), sortable: false },
    { key: 'rec', label: 'Status', mobileLabel: 'Status', render: (r) => { const s = store.reconcileStatus(r.txn.id, a.id); return s ? el('span.badge', { title: s === 'R' ? 'Reconciled' : 'Cleared', class: s === 'R' ? 'badge-positive' : 'badge-info' }, s, el('span.sr-only', {}, s === 'R' ? ' reconciled' : ' cleared')) : ''; }, sortable: false },
    bs ? { key: 'bal', label: 'Balance', align: 'right', amount: true, render: (r) => amountNode(r.balance * sign), sortable: false } : null,
  ].filter(Boolean);
  const table = dataTable({
    columns, rows, rowKey: (r) => `${r.txn.id}:${r.postingIdx}`, ariaLabel: `Register for ${a.name}`,
    onRowClick: (r) => openTxn(r.txn.id),
    empty: emptyState({ title: 'No transactions in this period', text: 'Transactions that use this account show up here.' }),
  });
  const newTypes = a.type === 'bank'
    ? [['Expense', 'expense'], ['Check', 'check'], ['Deposit', 'deposit'], ['Transfer', 'transfer'], ['Journal entry', 'journal']]
    : a.type === 'creditCard' ? [['Expense', 'expense'], ['Credit card refund', 'ccCredit'], ['Credit card payment', 'ccPayment'], ['Journal entry', 'journal']]
      : [['Journal entry', 'journal']];
  const draftFor = (type) => {
    if (type === 'deposit' || type === 'expense' || type === 'check' || type === 'ccCredit') return { accountId: a.id };
    if (type === 'transfer') return { fromId: a.id };
    if (type === 'ccPayment') return a.type === 'creditCard' ? { ccAccountId: a.id } : { bankAccountId: a.id };
    return {};
  };
  swap(main, el('div.page', {},
    pageHead({
      title: store.accountName(a.id),
      crumbs: [['Chart of accounts', 'accounts'], [a.name]],
      sub: bs ? el('div.register-balance', {}, el('span.kpi-label', {}, 'Ending balance'), el('span.kpi-value', {}, amountNode(reg.closing * sign))) : null,
      actions: [
        el('a.btn', { href: `#/report/gl?accounts=${a.id}` }, 'Run report'),
        a.type === 'bank' || a.type === 'creditCard' ? el('a.btn', { href: `#/reconcile/${a.id}` }, 'Reconcile') : null,
        el('button.btn', { type: 'button', onclick: () => openAccountForm({ account: a }) }, 'Edit account'),
        splitButton('Add transaction', () => openTxnForm({ type: newTypes[0][1], draft: draftFor(newTypes[0][1]) }), newTypes.map(([l, t]) => ({ label: l, onClick: () => openTxnForm({ type: t, draft: draftFor(t) }) }))),
      ].filter(Boolean),
    }),
    el('div.toolbar', {},
      searchBox({ value: st.q, placeholder: 'Search memo, payee, or number', label: 'Search register', onInput: (v) => { st.q = v; renderRegister(main, route); main.querySelector('input[type="search"]')?.focus(); } }),
      selectInput({ options: PERIODS.filter(([k]) => k !== 'custom'), value: st.period, ariaLabel: 'Date range', onChange: (v) => { st.period = v; renderRegister(main, route); } }),
      [...store.accounts.values()].some((x) => x.parentId === a.id) ? el('label.check', {}, el('input', { type: 'checkbox', checked: st.subs, onchange: (e) => { st.subs = e.target.checked; renderRegister(main, route); } }), 'Include sub-accounts') : null,
      el('div.toolbar-end', {}, el('span.muted', {}, `${rows.length} transactions`))),
    table.root));
}
