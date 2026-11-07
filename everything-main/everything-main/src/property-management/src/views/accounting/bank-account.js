/**
 * One bank account: register with running balance, reconciliation against a
 * bank statement, and reconciliation history.
 */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../app.js';
import { pageHeader, card, dataTable, emptyState, field, moneyInput, statusPill, stat, moreButton } from '../../ui/components.js';
import { formDialog, confirmDialog } from '../../ui/dialog.js';
import { openMenu } from '../../ui/menu.js';
import { toast } from '../../ui/toast.js';
import { currentRoute } from '../../ui/router.js';
import { addMonths, endOfMonth, startOfMonth } from '../../core/dates.js';
import { generalLedger, unreconciledLines, clearedBalance, reconciledIds, lastReconciliation } from '../../core/financials.js';
import { money, date, detailTabs, exportCSV, csvMoney } from '../common.js';
import { accountDialog, kindLabel, txTitle, stmtCell, notFound, clearedMark, runTx } from './shared.js';

export function render(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  let mode = 'view';
  const today = app.today();
  const range = { from: ctx.query.from || startOfMonth(addMonths(today, -2)), to: ctx.query.to || today };

  const root = h('div.page.acct-page');
  let region = null;

  function show() {
    const account = store.get('accounts', id);
    if (!account || !account.bank) {
      root.replaceChildren(notFound('Bank account', { href: '#/banking', label: 'Go to banking' }));
      return;
    }
    const open = openRec();
    if (mode === 'reconcile' && open) region = ctx.live(() => reconcileView(account, openRec()), ['transactions', 'accounts']);
    else {
      mode = 'view';
      region = ctx.live(() => accountView(store.get('accounts', id)), ['transactions', 'accounts', 'reconciliations', 'leases', 'tenants', 'vendors', 'owners']);
    }
    root.replaceChildren(region);
  }

  const openRec = () => store.all('reconciliations').find((r) => r.accountId === id && r.status === 'open') || null;

  // ---- Account view ----------------------------------------------------------------

  function accountView(account) {
    if (!account) return notFound('Bank account', { href: '#/banking', label: 'Go to banking' });
    const balance = app.ledger().account(account.id);
    const open = openRec();
    const last = lastReconciliation(store, account.id);
    // The live route, not ctx: the selected tab must survive redraws.
    const tabs = detailTabs(
      { query: currentRoute().query },
      [
        { id: 'register', label: 'Register' },
        { id: 'reconciliations', label: 'Reconciliations' },
      ],
      (tab) => (tab === 'register' ? registerTab(account) : historyTab(account)),
      { label: 'Bank account sections' },
    );
    return h(
      'div.stack.acct-stack',
      pageHeader({
        title: account.name,
        crumbs: [{ label: 'Banking', href: '#/banking' }],
        subtitle: [account.last4 ? `Account ending ${account.last4}` : null, account.description].filter(Boolean).join(' · '),
        actions: [
          moreButton((btn) =>
            openMenu(btn, [
              { label: 'Edit account', icon: 'pencil', run: () => accountDialog(account) },
              { label: 'Transfer money', icon: 'transfer', run: () => runTx('transferDialog') },
              { label: 'Open in chart of accounts', icon: 'list', href: `#/accounts/${account.id}` },
            ]),
          ),
          h('button.btn.primary', { type: 'button', onClick: () => (open ? enterReconcile() : startReconcile(account)) }, icon('check-check', 16), open ? 'Continue reconciling' : 'Reconcile'),
        ],
      }),
      h(
        'div.stats',
        stat({ label: 'Balance', value: money(balance), tone: balance < 0 ? 'danger' : null }),
        stat({ label: 'Last reconciled', value: last ? date(last.statementDate) : 'Never', sub: last ? `Statement balance ${money(last.statementBalance)}` : 'Match this register to a bank statement' }),
        stat({ label: 'Unreconciled', value: unreconciledLines(store, account.id, today).length.toLocaleString(), sub: 'Transactions through today' }),
      ),
      open
        ? h(
            'div.notice.accent',
            icon('info'),
            h('span.grow', `A reconciliation for the statement ending ${date(open.statementDate)} is in progress.`),
            h('button.btn.sm', { type: 'button', onClick: enterReconcile }, 'Continue'),
          )
        : null,
      tabs.node,
    );
  }

  function registerTab(account) {
    const from = h('input.input', { type: 'date', value: range.from, 'aria-label': 'From date' });
    const to = h('input.input', { type: 'date', value: range.to, 'aria-label': 'To date' });
    const apply = () => {
      range.from = from.value;
      range.to = to.value;
      region.redraw();
    };
    from.addEventListener('change', apply);
    to.addEventListener('change', apply);
    const [g] = generalLedger(store, { from: range.from, to: range.to, accountIds: [account.id] });
    const opening = g?.opening || 0;
    const rows = (g?.rows || []).slice().reverse();
    const done = reconciledIds(store, account.id);
    const exportRows = () =>
      exportCSV(
        `${account.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-register`,
        [
          { label: 'Date', value: (r) => r.date },
          { label: 'Type', value: (r) => kindLabel(r.tx.kind) },
          { label: 'Description', value: (r) => txTitle(r.tx) },
          { label: 'Reference', value: (r) => r.tx.ref },
          { label: 'Deposit', value: (r) => (r.amount > 0 ? csvMoney(r.amount) : '') },
          { label: 'Withdrawal', value: (r) => (r.amount < 0 ? csvMoney(-r.amount) : '') },
          { label: 'Balance', value: (r) => csvMoney(r.balance) },
          { label: 'Reconciled', value: (r) => (done.has(r.tx.id) ? 'Yes' : '') },
        ],
        g?.rows || [],
      );
    return h(
      'section.card.list-card',
      { 'aria-label': 'Register' },
      h('div.toolbar.acct-filters', h('div.acct-dates', from, h('span.subtle', { 'aria-hidden': 'true' }, 'to'), to), h('div.grow'), h('button.btn.sm', { type: 'button', onClick: exportRows }, icon('download', 14), 'Export CSV')),
      dataTable({
        caption: `${account.name} register`,
        rows,
        rowHref: (r) => `#/transactions/${r.tx.id}`,
        columns: [
          { id: 'date', label: 'Date', render: (r) => h('span.nowrap', date(r.date)) },
          { id: 'desc', label: 'Description', render: (r) => h('span.acct-desc', h('span.truncate', txTitle(r.tx)), h('span.acct-memo', [kindLabel(r.tx.kind), r.tx.ref].filter(Boolean).join(' · '))) },
          { id: 'clr', label: '', srLabel: 'Reconciled', render: (r) => clearedMark(done.has(r.tx.id)) },
          { id: 'in', label: 'Deposit', align: 'r', render: (r) => (r.amount > 0 ? h('span.num', money(r.amount)) : '') },
          { id: 'out', label: 'Withdrawal', align: 'r', render: (r) => (r.amount < 0 ? h('span.num', money(-r.amount)) : '') },
          { id: 'bal', label: 'Balance', align: 'r', render: (r) => stmtCell(r.balance) },
        ],
        mobile: (r) =>
          h(
            'a.mobile-row',
            { href: `#/transactions/${r.tx.id}` },
            h('div.grow', { style: { minWidth: 0 } }, h('div.m-title', txTitle(r.tx)), h('div.m-sub', `${date(r.date)} · ${kindLabel(r.tx.kind)}`)),
            h('div.m-end', h(`span.num${r.amount < 0 ? '' : '.acct-in'}`, r.amount < 0 ? `-${money(-r.amount)}` : `+${money(r.amount)}`), h('span.subtle.acct-small', money(r.balance))),
          ),
        empty: emptyState({ compact: true, icon: 'landmark', title: 'No transactions in this period', text: 'Choose a wider date range to see more.', headingLevel: 3 }),
      }),
      h('div.acct-opening', h('span', `Opening balance on ${date(range.from)}`), stmtCell(opening)),
    );
  }

  function historyTab(account) {
    const recs = store
      .all('reconciliations')
      .filter((r) => r.accountId === account.id)
      .sort((a, b) => (a.statementDate < b.statementDate ? 1 : -1));
    const latest = recs.find((r) => r.status === 'reconciled');
    return h(
      'section.card.list-card',
      { 'aria-label': 'Reconciliations' },
      dataTable({
        caption: 'Reconciliations',
        rows: recs,
        columns: [
          { id: 'date', label: 'Statement date', render: (r) => date(r.statementDate) },
          { id: 'bal', label: 'Statement balance', align: 'r', render: (r) => stmtCell(r.statementBalance) },
          { id: 'n', label: 'Cleared', align: 'r', render: (r) => h('span.num', (r.cleared || []).length.toLocaleString()) },
          { id: 'on', label: 'Finished', render: (r) => (r.reconciledOn ? date(r.reconciledOn) : h('span.subtle', 'Not yet')) },
          { id: 'status', label: 'Status', render: (r) => statusPill(r.status) },
          {
            id: 'act',
            label: '',
            srLabel: 'Actions',
            render: (r) =>
              r.status === 'open'
                ? h('button.btn.sm', { type: 'button', onClick: enterReconcile }, 'Continue')
                : r === latest && !openRec()
                  ? h('button.btn.sm.ghost', { type: 'button', onClick: () => undoReconciliation(r) }, 'Undo')
                  : null,
          },
        ],
        mobile: (r) => h('div.mobile-row', h('div.grow', h('div.m-title', `Statement ${date(r.statementDate)}`), h('div.m-sub', `${(r.cleared || []).length} cleared`)), h('div.m-end', stmtCell(r.statementBalance), statusPill(r.status))),
        empty: emptyState({ compact: true, icon: 'check-check', title: 'No reconciliations yet', text: 'Reconcile each month to confirm this register matches your bank statement.', headingLevel: 3 }),
      }),
    );
  }

  async function undoReconciliation(r) {
    const ok = await confirmDialog({
      title: 'Undo this reconciliation?',
      message: `The statement ending ${date(r.statementDate)} will be reopened so you can change which transactions it clears.`,
      confirmLabel: 'Reopen',
    });
    if (!ok) return;
    store.patch('reconciliations', r.id, { status: 'open', reconciledOn: null });
    toast('Reconciliation reopened');
  }

  // ---- Reconcile -------------------------------------------------------------------------

  async function startReconcile(account) {
    const last = lastReconciliation(store, account.id);
    let suggested = endOfMonth(addMonths(startOfMonth(today), -1));
    if (last && suggested <= last.statementDate) suggested = endOfMonth(addMonths(startOfMonth(last.statementDate), 1));
    const dateIn = h('input.input', { type: 'date', name: 'statementDate', value: suggested });
    const bal = moneyInput({ name: 'statementBalance', placeholder: '0.00' });
    const rec = await formDialog({
      title: 'Reconcile with a bank statement',
      submitLabel: 'Start',
      body: h(
        'div.stack',
        h('p.muted', 'Enter the closing date and ending balance from your bank statement. Then tick each transaction that appears on it.'),
        h('div.form-grid', field('Statement ending date', dateIn, { required: true }), field('Ending balance', bal, { required: true, hint: last ? `Last statement: ${money(last.statementBalance)} on ${date(last.statementDate)}` : null })),
      ),
      onSubmit: () => {
        if (last && dateIn.value <= last.statementDate) {
          toast(`Choose a date after the last reconciled statement (${date(last.statementDate)}).`, { type: 'error' });
          return false;
        }
        return store.put('reconciliations', { accountId: account.id, statementDate: dateIn.value, statementBalance: bal.cents, cleared: [], status: 'open' });
      },
    });
    if (rec) enterReconcile();
  }

  function enterReconcile() {
    mode = 'reconcile';
    show();
  }

  function leaveReconcile() {
    mode = 'view';
    show();
  }

  function reconcileView(account, rec) {
    if (!rec) {
      queueMicrotask(leaveReconcile);
      return h('div');
    }
    const lines = unreconciledLines(store, account.id, rec.statementDate);
    const valid = new Set(lines.map((l) => l.tx.id));
    const cleared = new Set((rec.cleared || []).filter((tid) => valid.has(tid)));
    let saveTimer = null;
    // Selections save while the reconciliation is open; once it is
    // finished or discarded, a save still pending must not touch it.
    const save = () => {
      saveTimer = null;
      if (store.get('reconciliations', rec.id)?.status === 'open') store.patch('reconciliations', rec.id, { cleared: [...cleared] });
    };
    const persist = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 400);
    };
    ctx.onDispose(() => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        save();
      }
    });

    const clearedEl = h('span.acct-rec-value');
    const diffEl = h('span.acct-rec-value');
    const countEl = h('span.subtle');
    const finishBtn = h('button.btn.primary', { type: 'button', onClick: () => finish() }, icon('check', 16), 'Finish');
    const boxes = new Map();

    function update() {
      const bal = clearedBalance(store, account.id, [...cleared]);
      const diff = rec.statementBalance - bal;
      clearedEl.textContent = money(bal);
      diffEl.textContent = money(diff);
      diffEl.parentElement.classList.toggle('ok', diff === 0);
      diffEl.parentElement.classList.toggle('off', diff !== 0);
      countEl.textContent = `${cleared.size} of ${lines.length} selected`;
      finishBtn.disabled = diff !== 0;
      finishBtn.title = diff === 0 ? '' : 'The difference must be zero to finish';
      for (const [tid, box] of boxes) box.checked = cleared.has(tid);
    }

    const toggle = (tid, on) => {
      if (on) cleared.add(tid);
      else cleared.delete(tid);
      persist();
      update();
    };

    async function finish() {
      clearTimeout(saveTimer);
      saveTimer = null;
      store.patch('reconciliations', rec.id, { cleared: [...cleared], status: 'reconciled', reconciledOn: today, clearedBalance: rec.statementBalance });
      toast(`Reconciled through ${date(rec.statementDate)}`);
      leaveReconcile();
    }

    async function cancel() {
      const ok = await confirmDialog({ title: 'Discard this reconciliation?', message: 'Your selections will be lost. Nothing in the register changes.', confirmLabel: 'Discard', danger: true });
      if (!ok) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      store.remove('reconciliations', rec.id);
      leaveReconcile();
    }

    const deposits = lines.filter((l) => l.amount > 0);
    const withdrawals = lines.filter((l) => l.amount < 0);
    const table = (title, list) =>
      card({
        title,
        count: list.length,
        flush: true,
        actions: list.length
          ? h(
              'div.row',
              h('button.btn.sm.ghost', { type: 'button', onClick: () => (list.forEach((l) => cleared.add(l.tx.id)), persist(), update()) }, 'Select all'),
              h('button.btn.sm.ghost', { type: 'button', onClick: () => (list.forEach((l) => cleared.delete(l.tx.id)), persist(), update()) }, 'Clear'),
            )
          : null,
        body: list.length
          ? h(
              'ul.acct-rec-list',
              list.map((l) => {
                const box = h('input', { type: 'checkbox', checked: cleared.has(l.tx.id), onChange: (e) => toggle(l.tx.id, e.target.checked) });
                boxes.set(l.tx.id, box);
                return h(
                  'li',
                  h(
                    'label.acct-rec-row',
                    box,
                    h('span.acct-rec-date', date(l.date)),
                    h('span.acct-desc.grow', h('span.truncate', txTitle(l.tx)), h('span.acct-memo', [kindLabel(l.tx.kind), l.tx.ref].filter(Boolean).join(' · '))),
                    h('span.num', money(Math.abs(l.amount))),
                  ),
                );
              }),
            )
          : h('div.section-empty', 'Nothing to reconcile.'),
      });

    const node = h(
      'div.stack.acct-stack',
      pageHeader({
        title: `Reconcile ${account.name}`,
        crumbs: [
          { label: 'Banking', href: '#/banking' },
          { label: account.name, href: `#/banking/${account.id}` },
        ],
        subtitle: `Statement ending ${date(rec.statementDate)}`,
        actions: [h('button.btn', { type: 'button', onClick: cancel }, 'Discard'), h('button.btn', { type: 'button', onClick: leaveReconcile }, 'Save for later'), finishBtn],
      }),
      h(
        'div.acct-rec-bar',
        { role: 'status', 'aria-live': 'polite' },
        h('div', h('span.acct-rec-label', 'Statement ending balance'), h('span.acct-rec-value', money(rec.statementBalance))),
        h('div', h('span.acct-rec-label', 'Cleared balance'), clearedEl),
        h('div.acct-rec-diff', h('span.acct-rec-label', 'Difference'), diffEl),
        h('div.acct-rec-count', countEl),
      ),
      h('div.acct-grid.even', table('Deposits and credits', deposits), table('Payments and withdrawals', withdrawals)),
    );
    update();
    return node;
  }

  show();
  return { node: root, title: store.get('accounts', id)?.name || 'Bank account' };
}
