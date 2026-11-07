/** Billing: bills by status, and outstanding balances per client. */
import '../styles/billing.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, navTabs, segmented, searchBox, dataTable, emptyState, stat } from '../ui/components.js';
import { setQuery, navigate } from '../ui/router.js';
import { openDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { matterLink, contactLink, billStatusPill, moneyCell, rememberSort, saveSort } from './common.js';
import { openPaymentDialog } from './money-dialogs.js';
import { billTotals, billPaid, billBalance, billStatus, BILL_STATUS } from '../core/finance.js';
import { BILL_TABS, billTab, outstandingByClient, openBillsForClient } from '../core/billing-ops.js';
import { approveBills, issueBills, voidBills, deleteDrafts } from './billing-actions.js';
import { formatMoney } from '../core/money.js';
import { formatDate } from '../core/dates.js';
import { matches, contactName, formatAddress } from '../core/format.js';
import { downloadCsv } from '../core/csv.js';
import { where } from '../core/derive.js';

export function render(ctx) {
  const tab = ctx.params.tab === 'outstanding' ? 'outstanding' : 'bills';
  const header = pageHeader({
    title: 'Billing',
    actions: [
      h('button.btn', { type: 'button', onClick: () => openPaymentDialog() }, icon('hand-coins', 16), 'Record payment'),
      h('a.btn.primary', { href: '#/billing/new' }, icon('plus', 16), 'New bills'),
    ],
    tabs: navTabs(
      [
        { href: '#/billing', label: 'Bills', current: tab === 'bills' },
        { href: '#/billing/outstanding', label: 'Outstanding balances', current: tab === 'outstanding' },
      ],
      'Billing views',
    ),
  });
  const body = tab === 'outstanding' ? outstandingView(ctx) : billsView(ctx);
  return { title: tab === 'outstanding' ? 'Outstanding balances' : 'Bills', node: h('div.page.fill', header, body.stats || null, body.node) };
}

// ---- Bills --------------------------------------------------------------------------

function billsView(ctx) {
  const store = app.store;
  const state = { tab: BILL_TABS.some((t) => t.id === ctx.query.status) ? ctx.query.status : 'unpaid', q: ctx.query.q || '' };
  const today = app.today();
  // Each bill's own payments (grouped once per change), so per-bill money is
  // not a scan of every payment.
  const paysOf = (b) => where(store, 'payments', 'billId', b.id);
  const statusOf = (b) => billStatus(b, paysOf(b), today);
  const statsNode = h('div');
  const segWrap = h('div');
  const bulk = h('div.bulk-bar', { hidden: true });

  const columns = [
    { id: 'number', label: 'Bill', fixed: true, width: '96px', render: (b) => h('span.strong', `#${b.number}`), sort: (b) => b.number },
    { id: 'client', label: 'Client', render: (b) => contactLink(b.clientId), sort: (b) => lookup.contactName(b.clientId) },
    { id: 'matter', label: 'Matter', render: (b) => matterLink(b.matterId), sort: (b) => lookup.matter(b.matterId)?.displayNumber || '' },
    { id: 'issue', label: 'Issue date', width: '120px', render: (b) => formatDate(b.issueDate), sort: (b) => b.issueDate },
    { id: 'due', label: 'Due date', width: '120px', render: (b) => (statusOf(b) === 'overdue' ? h('span.text-danger', formatDate(b.dueDate)) : formatDate(b.dueDate)), sort: (b) => b.dueDate },
    { id: 'total', label: 'Total', align: 'r', render: (b) => moneyCell(billTotals(b).total), sort: (b) => billTotals(b).total },
    { id: 'paid', label: 'Paid', align: 'r', render: (b) => moneyCell(billPaid(b, paysOf(b)), { muted: true }), sort: (b) => billPaid(b, paysOf(b)) },
    { id: 'balance', label: 'Balance', align: 'r', render: (b) => moneyCell(billBalance(b, paysOf(b)), { muted: true }), sort: (b) => billBalance(b, paysOf(b)) },
    { id: 'status', label: 'Status', render: (b) => billStatusPill(statusOf(b)), sort: (b) => statusOf(b) },
  ];

  const table = dataTable({
    caption: 'Bills',
    columns,
    columnsKey: 'bills',
    sort: rememberSort('bills', { id: 'number', dir: 'desc' }),
    onSort: (v) => saveSort('bills', v),
    rowHref: (b) => `#/bills/${b.id}`,
    selectable: true,
    onSelectionChange: drawBulk,
    mobile: (b) =>
      h(
        'a.list-item',
        { href: `#/bills/${b.id}` },
        h(
          'span.grow',
          h('span.title', `Bill #${b.number} · ${lookup.contactName(b.clientId)}`),
          h('span.sub', [lookup.matter(b.matterId)?.displayNumber, `Due ${formatDate(b.dueDate)}`].filter(Boolean).join(' · ')),
        ),
        h('span.stack-sm.r', h('span.num.strong', formatMoney(billTotals(b).total)), billStatusPill(statusOf(b))),
      ),
    empty: () =>
      store.all('bills').length
        ? emptyState({ compact: true, icon: 'search', title: 'No bills here', text: 'Try another status or search.', headingLevel: 3 })
        : emptyState({
            icon: 'receipt-text',
            title: 'No bills yet',
            text: 'Generate bills from unbilled time and expenses, or collect a retainer into trust first.',
            actions: [h('a.btn.primary', { href: '#/billing/new' }, icon('plus', 16), 'New bills'), h('a.btn', { href: '#/accounts' }, 'Trust accounts')],
            headingLevel: 3,
          }),
    footer: (rows) => {
      let total = 0;
      let balance = 0;
      for (const b of rows) {
        total += billTotals(b).total;
        balance += billBalance(b, paysOf(b));
      }
      return [
        h('span', h('strong', String(rows.length)), rows.length === 1 ? ' bill' : ' bills'),
        h('span', 'Total ', h('strong', formatMoney(total))),
        h('span', 'Balance due ', h('strong', formatMoney(balance))),
      ];
    },
  });

  // Rows a filter hides leave the selection, so the bulk bar is redrawn
  // with them (and with fresh copies of the bills still selected).
  function setRows() {
    table.setRows(rows());
    drawBulk(table.selected);
  }

  function rows() {
    const t = billTab(state.tab);
    return store.all('bills').filter((b) => {
      if (!t.match(statusOf(b))) return false;
      if (state.q) {
        const m = lookup.matter(b.matterId);
        if (!matches(`#${b.number} ${b.number} ${lookup.contactName(b.clientId)} ${m?.displayNumber || ''} ${m?.description || ''}`, state.q)) return false;
      }
      return true;
    });
  }

  function drawStats() {
    const pays = store.all('payments');
    let draft = 0;
    let unpaid = 0;
    let overdue = 0;
    let collected = 0;
    const month = today.slice(0, 7);
    for (const b of store.all('bills')) {
      const st = statusOf(b);
      if (st === 'draft' || st === 'pending') draft += billTotals(b).total;
      if (st === 'unpaid' || st === 'partial' || st === 'overdue') unpaid += billBalance(b, paysOf(b));
      if (st === 'overdue') overdue += billBalance(b, paysOf(b));
    }
    for (const p of pays) if (p.date?.slice(0, 7) === month) collected += Number(p.amountCents) || 0;
    statsNode.replaceChildren(
      h(
        'div.stats',
        stat({ label: 'In draft or pending', value: formatMoney(draft), onClick: () => setTab('draft') }),
        stat({ label: 'Unpaid', value: formatMoney(unpaid), tone: unpaid ? 'warning' : null, onClick: () => setTab('unpaid') }),
        stat({ label: 'Overdue', value: formatMoney(overdue), tone: overdue ? 'danger' : null, onClick: () => setTab('overdue') }),
        stat({ label: 'Collected this month', value: formatMoney(collected), tone: 'success' }),
      ),
    );
  }

  function drawSeg() {
    const all = store.all('bills');
    const counts = Object.fromEntries(BILL_TABS.map((t) => [t.id, 0]));
    for (const b of all) {
      const st = statusOf(b);
      for (const t of BILL_TABS) if (t.match(st)) counts[t.id]++;
    }
    segWrap.replaceChildren(segmented({ label: 'Bill status', value: state.tab, items: BILL_TABS.map((t) => ({ value: t.id, label: t.label, count: counts[t.id] })), onChange: setTab }));
  }

  function setTab(id) {
    state.tab = id;
    setQuery({ status: id === 'unpaid' ? '' : id });
    drawSeg();
    table.clearSelection();
    setRows();
  }

  function drawBulk(sel) {
    bulk.hidden = !sel.size;
    if (!sel.size) return;
    const chosen = [...sel].map((id) => store.get('bills', id)).filter(Boolean);
    const pendingOrDraft = chosen.filter((b) => b.status === 'draft' || b.status === 'pending');
    // Redrawn on every refresh, so keep keyboard focus on the same button.
    const focused = bulk.contains(document.activeElement) ? document.activeElement.textContent : null;
    bulk.replaceChildren(
      h('span', `${sel.size} selected`),
      h('div.spacer'),
      pendingOrDraft.length ? h('button.btn.sm', { type: 'button', onClick: () => approve(pendingOrDraft) }, icon('check', 15), 'Approve') : null,
      pendingOrDraft.length ? h('button.btn.sm', { type: 'button', onClick: () => issue(pendingOrDraft) }, icon('send', 15), 'Issue') : null,
      h('button.btn.sm', { type: 'button', onClick: () => exportCsv(chosen) }, icon('download', 15), 'Export'),
      h(
        'button.btn.sm',
        {
          type: 'button',
          onClick: (e) =>
            openMenu(e.currentTarget, [
              { label: 'Void bills', icon: 'x', danger: true, run: () => voidSelected(chosen) },
              { label: 'Delete drafts', icon: 'trash', danger: true, disabled: !pendingOrDraft.length, run: () => deleteSelected(pendingOrDraft) },
            ]),
        },
        'More',
        icon('chevron-down', 14),
      ),
      h('button.btn.sm.ghost', { type: 'button', onClick: () => table.clearSelection() }, 'Clear'),
    );
    if (focused !== null) ([...bulk.querySelectorAll('button')].find((x) => x.textContent === focused) || bulk.querySelector('button'))?.focus();
  }

  function approve(list) {
    approveBills(list);
    table.clearSelection();
  }

  function issue(list) {
    issueBills(list);
    table.clearSelection();
  }

  async function voidSelected(list) {
    if (await voidBills(list)) table.clearSelection();
  }

  async function deleteSelected(list) {
    if (await deleteDrafts(list)) table.clearSelection();
  }

  function exportCsv(list) {
    const head = ['Bill number', 'Client', 'Matter', 'Issue date', 'Due date', 'Status', 'Fees', 'Expenses', 'Discount', 'Tax', 'Total', 'Paid', 'Balance'];
    downloadCsv(`bills-${today}.csv`, [
      head,
      ...list.map((b) => {
        const t = billTotals(b);
        return [
          String(b.number),
          lookup.contactName(b.clientId),
          lookup.matter(b.matterId)?.displayNumber || '',
          b.issueDate,
          b.dueDate,
          BILL_STATUS[statusOf(b)]?.label || statusOf(b),
          t.fees / 100,
          t.expenses / 100,
          t.discount / 100,
          t.tax / 100,
          t.total / 100,
          billPaid(b, paysOf(b)) / 100,
          billBalance(b, paysOf(b)) / 100,
        ].map((v) => (typeof v === 'number' ? v.toFixed(2) : v));
      }),
    ]);
  }

  const search = searchBox({
    value: state.q,
    placeholder: 'Bill number, client, or matter',
    label: 'Search bills',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      setRows();
    },
  });

  function refresh() {
    drawStats();
    drawSeg();
    setRows();
  }
  refresh();
  ctx.watch(['bills', 'payments', 'contacts', 'matters'], refresh);

  return {
    stats: statsNode,
    node: h(
      'section.card.list-card',
      { 'aria-label': 'Bills list' },
      h(
        'div.toolbar',
        segWrap,
        search,
        h('div.spacer'),
        table.columnsButton(),
        h('button.btn', { type: 'button', onClick: () => exportCsv(table.rows) }, icon('download', 16), h('span.hide-sm', 'Export')),
      ),
      bulk,
      table.node,
    ),
  };
}

// ---- Outstanding balances -------------------------------------------------------------

function outstandingView(ctx) {
  const store = app.store;
  const today = app.today();
  let q = ctx.query.q || '';
  const data = () =>
    outstandingByClient({
      matters: store.all('matters'),
      bills: store.all('bills'),
      payments: store.all('payments'),
      activities: store.all('activities'),
      transactions: store.all('transactions'),
      accounts: store.all('accounts'),
      today,
    });
  const columns = [
    { id: 'client', label: 'Client', fixed: true, render: (r) => contactLink(r.clientId), sort: (r) => lookup.contactName(r.clientId) },
    { id: 'matters', label: 'Matters', align: 'r', render: (r) => h('span.num', String(r.matters)), sort: (r) => r.matters },
    { id: 'wip', label: 'Unbilled', align: 'r', render: (r) => moneyCell(r.wip, { muted: true }), sort: (r) => r.wip },
    { id: 'outstanding', label: 'Outstanding', align: 'r', render: (r) => h('span.num.strong', formatMoney(r.outstanding)), sort: (r) => r.outstanding },
    { id: 'current', label: 'Current', align: 'r', render: (r) => moneyCell(r.aging.current, { muted: true }), sort: (r) => r.aging.current },
    { id: 'd30', label: '1 to 30', align: 'r', render: (r) => moneyCell(r.aging.d30, { muted: true }), sort: (r) => r.aging.d30 },
    { id: 'd60', label: '31 to 60', align: 'r', render: (r) => moneyCell(r.aging.d60, { muted: true }), sort: (r) => r.aging.d60 },
    { id: 'd90', label: '61 to 90', align: 'r', render: (r) => moneyCell(r.aging.d90, { muted: true }), sort: (r) => r.aging.d90 },
    { id: 'd90plus', label: 'Over 90', align: 'r', render: (r) => moneyCell(r.aging.d90plus, { muted: true, tone: r.aging.d90plus ? 'danger' : null }), sort: (r) => r.aging.d90plus },
    { id: 'trust', label: 'In trust', align: 'r', render: (r) => moneyCell(r.trust, { muted: true }), sort: (r) => r.trust },
    { id: 'last', label: 'Last payment', render: (r) => (r.lastPayment ? formatDate(r.lastPayment) : h('span.subtle', 'None')), sort: (r) => r.lastPayment },
    {
      id: 'actions',
      label: '',
      srLabel: 'Actions',
      fixed: true,
      width: '60px',
      render: (r) => h('button.icon-btn.sm', { type: 'button', 'aria-label': `Actions for ${lookup.contactName(r.clientId)}`, onClick: (e) => rowMenu(e.currentTarget, r) }, icon('more', 16)),
    },
  ];
  const table = dataTable({
    caption: 'Outstanding balances by client',
    columns: columns.map((c) => ({ ...c })),
    rows: [],
    sort: rememberSort('outstanding', { id: 'outstanding', dir: 'desc' }),
    onSort: (v) => saveSort('outstanding', v),
    columnsKey: 'outstanding',
    mobile: (r) =>
      h(
        'a.list-item',
        { href: `#/contacts/${r.clientId}` },
        h('span.grow', h('span.title', lookup.contactName(r.clientId)), h('span.sub', `Unbilled ${formatMoney(r.wip)} · In trust ${formatMoney(r.trust)}`)),
        h('span.num.strong', formatMoney(r.outstanding)),
      ),
    empty: () => emptyState({ icon: 'coins', title: 'Nothing outstanding', text: 'Clients with unbilled work, unpaid bills, or trust funds appear here.', headingLevel: 3 }),
    footer: (rows) => {
      const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
      return [
        h('span', h('strong', String(rows.length)), rows.length === 1 ? ' client' : ' clients'),
        h('span', 'Unbilled ', h('strong', formatMoney(sum((r) => r.wip)))),
        h('span', 'Outstanding ', h('strong', formatMoney(sum((r) => r.outstanding)))),
        h('span', 'Over 90 days ', h('strong', formatMoney(sum((r) => r.aging.d90plus)))),
        h('span', 'In trust ', h('strong', formatMoney(sum((r) => r.trust)))),
      ];
    },
  });

  function rowMenu(anchor, r) {
    openMenu(
      anchor,
      [
        {
          label: 'Record payment',
          icon: 'hand-coins',
          disabled: !r.outstanding,
          run: () => openPaymentDialog({ billId: openBillsForClient(r.clientId, store.all('bills'), store.all('payments'), today, store.all('matters'))[0]?.bill.id || null }),
        },
        { label: 'View statement', icon: 'file', run: () => showStatement(r.clientId) },
        { label: 'Open contact', icon: 'contact', run: () => navigate(`/contacts/${r.clientId}`) },
      ],
      { align: 'end', label: 'Client actions' },
    );
  }

  function refresh() {
    const rows = data().filter((r) => !q || matches(lookup.contactName(r.clientId), q));
    table.setRows(rows);
  }
  const search = searchBox({
    value: q,
    placeholder: 'Search clients',
    label: 'Search clients',
    onInput: (v) => {
      q = v;
      setQuery({ q: v });
      refresh();
    },
  });
  refresh();
  ctx.watch(['bills', 'payments', 'activities', 'transactions', 'matters', 'contacts', 'accounts'], refresh);
  return {
    node: h(
      'section.card.list-card',
      { 'aria-label': 'Outstanding balances' },
      h(
        'div.toolbar',
        search,
        h('div.spacer'),
        table.columnsButton(),
        h(
          'button.btn',
          {
            type: 'button',
            onClick: () =>
              downloadCsv(`outstanding-balances-${today}.csv`, [
                ['Client', 'Matters', 'Unbilled', 'Outstanding', 'Current', '1 to 30', '31 to 60', '61 to 90', 'Over 90', 'In trust', 'Last payment'],
                ...table.rows.map((r) => [
                  lookup.contactName(r.clientId),
                  r.matters,
                  ...[r.wip, r.outstanding, r.aging.current, r.aging.d30, r.aging.d60, r.aging.d90, r.aging.d90plus, r.trust].map((v) => (v / 100).toFixed(2)),
                  r.lastPayment,
                ]),
              ]),
          },
          icon('download', 16),
          h('span.hide-sm', 'Export'),
        ),
      ),
      table.node,
    ),
  };
}

/** A printable statement of a client's open bills. */
export function showStatement(clientId) {
  const store = app.store;
  const today = app.today();
  const c = lookup.contact(clientId);
  const firm = app.settings().firm;
  const open = openBillsForClient(clientId, store.all('bills'), store.all('payments'), today, store.all('matters'));
  const total = open.reduce((n, r) => n + r.balance, 0);
  const addr = c?.addresses?.find((a) => a.primary) || c?.addresses?.[0];
  openDialog({
    title: 'Client statement',
    size: 'wide',
    cls: 'statement-dialog',
    body: h(
      'article.print-doc.statement',
      h(
        'div.doc-head',
        h(
          'div',
          h('div.doc-firm', firm.name || 'Your firm'),
          h('div.doc-muted.pre', formatAddress({ street: firm.street, city: firm.city, region: firm.region, postal: firm.postal, country: firm.country }, { multiline: true })),
        ),
        h('div.doc-title-block', h('h2.doc-title', 'Statement of account'), h('div.doc-muted', `As of ${formatDate(today)}`)),
      ),
      h('div.doc-to', h('div.doc-label', 'Client'), h('div.strong', contactName(c)), addr ? h('div.doc-muted.pre', formatAddress(addr, { multiline: true })) : null),
      open.length
        ? h(
            'table.table-plain.doc-table',
            h('thead', h('tr', h('th', 'Bill'), h('th', 'Matter'), h('th', 'Issued'), h('th', 'Due'), h('th.r', 'Total'), h('th.r', 'Paid'), h('th.r', 'Balance'))),
            h(
              'tbody',
              open.map((r) =>
                h(
                  'tr',
                  h('td', `#${r.bill.number}`),
                  h('td', lookup.matter(r.bill.matterId)?.displayNumber || ''),
                  h('td', formatDate(r.bill.issueDate)),
                  h('td', r.status === 'overdue' ? h('span.text-danger', formatDate(r.bill.dueDate)) : formatDate(r.bill.dueDate)),
                  h('td.r.num', formatMoney(r.total)),
                  h('td.r.num', formatMoney(r.paid)),
                  h('td.r.num', formatMoney(r.balance)),
                ),
              ),
            ),
            h('tfoot', h('tr', h('td', { colspan: '6' }, 'Total balance due'), h('td.r.num', formatMoney(total)))),
          )
        : h('p.doc-muted', 'No open balance. Thank you.'),
    ),
    footer: ({ close }) => [
      h('div.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Close'),
      h('button.btn.primary', { type: 'button', onClick: () => window.print() }, icon('printer', 16), 'Print'),
    ],
  });
}
