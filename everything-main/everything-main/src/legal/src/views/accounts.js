/**
 * Bank accounts and trust: account balances, trust held per matter, account
 * ledgers with running balances, and a three-way reconciliation check.
 */
import '../styles/billing.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, card, pill, emptyState, dataTable, select, textInput, searchBox, moneyInput, field, stat } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { openDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { matterLink, contactLink, moneyCell, matterPicker, rememberSort, saveSort } from './common.js';
import { openAccountDialog, openTrustDialog, deleteTransaction } from './money-dialogs.js';
import { accountBalance, ledger, matterAccountBalance } from '../core/finance.js';
import { reconcileTrust, shiftRange } from '../core/billing-ops.js';
import { formatMoney } from '../core/money.js';
import { formatDate, namedRange, RANGE_OPTIONS } from '../core/dates.js';
import { matches, matterLabel, contactName, formatAddress } from '../core/format.js';
import { downloadCsv } from '../core/csv.js';

export function render(ctx) {
  return ctx.params.id ? accountDetail(ctx) : overview(ctx);
}

// ---- Overview --------------------------------------------------------------------------

function overview(ctx) {
  const store = app.store;
  const accountsNode = h('div');
  const statsNode = h('div');
  const trustNode = h('div');
  let q = '';
  let onlyLow = false;

  function draw() {
    const accounts = store.all('accounts');
    const tx = store.all('transactions');
    let trustTotal = 0;
    let opTotal = 0;
    for (const a of accounts) {
      const bal = accountBalance(a, tx);
      if (a.type === 'trust') trustTotal += bal;
      else opTotal += bal;
    }
    const held = trustRows();
    const low = held.filter((r) => r.low).length;
    statsNode.replaceChildren(
      h(
        'div.stats',
        stat({ label: 'Held in trust', value: formatMoney(trustTotal), icon: 'vault' }),
        stat({ label: 'Operating funds', value: formatMoney(opTotal), icon: 'landmark' }),
        stat({ label: 'Matters with trust funds', value: String(held.filter((r) => r.balance > 0).length) }),
        stat({ label: 'Below trust minimum', value: String(low), tone: low ? 'warning' : null, onClick: low ? () => ((onlyLow = true), drawTrust()) : null }),
      ),
    );
    accountsNode.replaceChildren(
      accounts.length
        ? h(
            'div.acct-grid',
            [...accounts]
              .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'trust' ? -1 : 1))
              .map((a) =>
                h(
                  'article.card.acct-card',
                  h(
                    'div.acct-card-head',
                    h('span.acct-icon', { 'data-type': a.type }, icon(a.type === 'trust' ? 'vault' : 'landmark', 18)),
                    h(
                      'div.grow',
                      h('h2.acct-name', h('a', { href: `#/accounts/${a.id}` }, a.name)),
                      h('div.subtle.small', [a.institution, a.last4 ? `ending ${a.last4}` : ''].filter(Boolean).join(' · ') || 'No bank details'),
                    ),
                    h('button.icon-btn.sm', { type: 'button', 'aria-label': `Edit ${a.name}`, title: 'Edit account', onClick: () => openAccountDialog({ account: a }) }, icon('pencil', 15)),
                  ),
                  h('div.acct-balance.num', formatMoney(accountBalance(a, tx))),
                  h(
                    'div.row',
                    pill(a.type === 'trust' ? 'Trust' : 'Operating', a.type === 'trust' ? 'violet' : 'accent'),
                    a.isDefault ? pill('Default', 'neutral') : null,
                    h('div.spacer'),
                    h('a.btn.sm', { href: `#/accounts/${a.id}` }, 'View ledger'),
                  ),
                ),
              ),
          )
        : emptyState({
            icon: 'landmark',
            title: 'No bank accounts yet',
            text: 'Add your operating account and your client trust account. Accounts here mirror your real bank accounts so payments and trust funds are tracked to the cent.',
            actions: [
              h('button.btn.primary', { type: 'button', onClick: () => openAccountDialog({ type: 'trust' }) }, icon('plus', 16), 'Add trust account'),
              h('button.btn', { type: 'button', onClick: () => openAccountDialog({ type: 'operating' }) }, 'Add operating account'),
            ],
          }),
    );
    drawTrust();
  }

  function trustRows() {
    const trustAccts = lookup.trustAccounts();
    const ids = new Set(trustAccts.map((a) => a.id));
    const per = new Map();
    for (const t of store.all('transactions')) {
      if (!ids.has(t.accountId) || !t.matterId) continue;
      per.set(t.matterId, (per.get(t.matterId) || 0) + (t.type === 'withdrawal' ? -Math.abs(t.amountCents) : Math.abs(t.amountCents)));
    }
    for (const m of store.all('matters')) if (Number(m.trustMinimumCents) > 0 && !per.has(m.id) && m.status !== 'closed') per.set(m.id, 0);
    return [...per.entries()]
      .map(([matterId, balance]) => {
        const m = lookup.matter(matterId);
        const min = Number(m?.trustMinimumCents) || 0;
        return { id: matterId, matter: m, balance, min, low: min > 0 && balance < min };
      })
      .filter((r) => r.matter);
  }

  const trustTable = dataTable({
    caption: 'Trust funds by matter',
    columnsKey: 'trust-matters',
    sort: rememberSort('trust-matters', { id: 'balance', dir: 'desc' }),
    onSort: (v) => saveSort('trust-matters', v),
    rowHeight: 44,
    maxHeight: '520px',
    columns: [
      { id: 'matter', label: 'Matter', fixed: true, render: (r) => matterLink(r.id), sort: (r) => r.matter.displayNumber },
      { id: 'client', label: 'Client', render: (r) => contactLink(r.matter.clientId), sort: (r) => lookup.contactName(r.matter.clientId) },
      { id: 'balance', label: 'Trust balance', align: 'r', render: (r) => h(`span.num.strong${r.low ? '.text-warning' : ''}`, formatMoney(r.balance)), sort: (r) => r.balance },
      { id: 'min', label: 'Minimum', align: 'r', render: (r) => (r.min ? moneyCell(r.min) : h('span.subtle', 'None')), sort: (r) => r.min },
      { id: 'flag', label: 'Status', render: (r) => (r.low ? pill('Below minimum', 'warning') : r.balance > 0 ? pill('Funded', 'success') : pill('Empty', 'neutral')), sort: (r) => (r.low ? 0 : 1) },
      {
        id: 'actions',
        label: '',
        srLabel: 'Actions',
        fixed: true,
        width: '60px',
        render: (r) =>
          h(
            'button.icon-btn.sm',
            {
              type: 'button',
              'aria-label': `Trust actions for ${r.matter.displayNumber}`,
              onClick: (e) =>
                openMenu(
                  e.currentTarget,
                  [
                    { label: 'Deposit', icon: 'arrow-down', run: () => openTrustDialog({ type: 'deposit', matterId: r.id }) },
                    { label: 'Withdraw', icon: 'arrow-up', disabled: r.balance <= 0, run: () => openTrustDialog({ type: 'withdrawal', matterId: r.id }) },
                    { label: 'Transfer to operating', icon: 'transfer', disabled: r.balance <= 0, run: () => openTrustDialog({ type: 'transfer', matterId: r.id }) },
                    { separator: true },
                    { label: 'Print trust ledger', icon: 'printer', run: () => printTrustLedger(r.id) },
                  ],
                  { align: 'end', label: 'Trust actions' },
                ),
            },
            icon('more', 16),
          ),
      },
    ],
    mobile: (r) =>
      h(
        'a.list-item',
        { href: `#/matters/${r.id}?tab=transactions` },
        h('span.grow', h('span.title', r.matter.displayNumber), h('span.sub', lookup.contactName(r.matter.clientId))),
        h(`span.num.strong${r.low ? '.text-warning' : ''}`, formatMoney(r.balance)),
      ),
    empty: () => emptyState({ compact: true, icon: 'vault', title: 'No trust funds held', text: 'Record a retainer deposit to start a matter’s trust ledger.', headingLevel: 3 }),
    footer: (rows) => [h('span', h('strong', String(rows.length)), rows.length === 1 ? ' matter' : ' matters'), h('span', 'Total ', h('strong', formatMoney(rows.reduce((n, r) => n + r.balance, 0))))],
  });

  const visibleTrustRows = () => trustRows().filter((r) => (!onlyLow || r.low) && (!q || matches(`${r.matter.displayNumber} ${r.matter.description} ${lookup.contactName(r.matter.clientId)}`, q)));
  // Built once, so a redraw from a background sync doesn't take focus or
  // half-typed text away from the search box or the card's buttons.
  const search = searchBox({
    value: q,
    placeholder: 'Search matters',
    label: 'Search trust balances',
    onInput: (v) => {
      q = v;
      trustTable.setRows(visibleTrustRows());
    },
  });
  const lowFilter = h('span', { style: { display: 'contents' } });
  const trustCard = h(
    'section.card.list-card',
    { 'aria-labelledby': 'trust-head' },
    h(
      'div.card-head',
      h('h2.grow#trust-head', 'Trust funds by matter'),
      h('button.btn.sm', { type: 'button', onClick: () => openTrustDialog({ type: 'deposit' }) }, icon('arrow-down', 14), 'Deposit'),
      h('button.btn.sm', { type: 'button', onClick: () => openTrustDialog({ type: 'withdrawal' }) }, icon('arrow-up', 14), 'Withdraw'),
      h('button.btn.sm', { type: 'button', onClick: () => openTrustDialog({ type: 'transfer' }) }, icon('transfer', 14), h('span.hide-sm', 'To operating')),
    ),
    h('div.toolbar', search, lowFilter),
    trustTable.node,
  );

  function drawTrust() {
    const hasTrust = lookup.trustAccounts().length > 0;
    if (!hasTrust) {
      trustNode.replaceChildren();
      return;
    }
    trustTable.setRows(visibleTrustRows());
    const hadFocus = lowFilter.contains(document.activeElement);
    lowFilter.replaceChildren(onlyLow ? h('button.btn.sm', { type: 'button', onClick: () => ((onlyLow = false), drawTrust()) }, icon('x', 14), 'Below minimum only') : '');
    if (hadFocus && !onlyLow) search.input.focus();
    if (trustCard.parentNode !== trustNode) trustNode.replaceChildren(trustCard);
  }

  draw();
  ctx.watch(['accounts', 'transactions', 'matters', 'contacts'], draw);

  return {
    title: 'Accounts',
    node: h(
      'div.page',
      pageHeader({
        title: 'Accounts',
        subtitle: 'Operating and client trust accounts. Trust money belongs to clients and is tracked per matter.',
        actions: [
          h('button.btn', { type: 'button', onClick: () => openTrustDialog({ type: 'deposit' }) }, icon('vault', 16), 'Trust deposit'),
          h('button.btn.primary', { type: 'button', onClick: () => openAccountDialog() }, icon('plus', 16), 'New account'),
        ],
      }),
      statsNode,
      accountsNode,
      trustNode,
    ),
  };
}

// ---- Account ledger --------------------------------------------------------------------

function accountDetail(ctx) {
  const store = app.store;
  const id = ctx.params.id;
  const account = () => store.get('accounts', id);
  if (!account()) {
    return h(
      'div.page',
      emptyState({ icon: 'landmark', title: 'Account not found', text: 'It may have been deleted.', headingLevel: 1, actions: [h('a.btn.primary', { href: '#/accounts' }, 'Back to accounts')] }),
    );
  }
  const state = { range: ctx.query.range || 'all', from: ctx.query.from || '', to: ctx.query.to || '', matterId: ctx.query.matter || '' };
  if (state.from || state.to) state.range = 'custom';
  else applyPreset();
  function applyPreset() {
    const r = namedRange(state.range, app.today(), app.settings().weekStart);
    state.from = r ? r[0] : '';
    state.to = r ? r[1] : '';
  }
  const headNode = h('div');
  const reconNode = h('div');

  const rangeSel = select({ name: 'range', 'aria-label': 'Date range', value: state.range, options: [...RANGE_OPTIONS, { value: 'custom', label: 'Custom range' }] });
  const fromI = textInput({ type: 'date', value: state.from, 'aria-label': 'From date' });
  const toI = textInput({ type: 'date', value: state.to, 'aria-label': 'To date' });
  rangeSel.addEventListener('change', () => {
    state.range = rangeSel.value;
    if (state.range !== 'custom') applyPreset();
    syncRange();
  });
  for (const el of [fromI, toI]) el.addEventListener('change', () => ((state.range = 'custom'), (state.from = fromI.value), (state.to = toI.value), syncRange()));
  const prev = h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Previous period', onClick: () => step(-1) }, icon('chevron-left', 16));
  const next = h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'Next period', onClick: () => step(1) }, icon('chevron-right', 16));
  function step(dir) {
    const r = shiftRange(state.from, state.to, dir);
    if (!r) return;
    [state.from, state.to] = r;
    state.range = 'custom';
    syncRange();
  }
  function syncRange() {
    rangeSel.value = state.range;
    fromI.value = state.from;
    toI.value = state.to;
    prev.disabled = next.disabled = !(state.from && state.to);
    setQuery(state.range === 'custom' ? { range: '', from: state.from, to: state.to } : { range: state.range === 'all' ? '' : state.range, from: '', to: '' });
    refresh();
  }
  const matterF = matterPicker({
    name: 'matterFilter',
    value: state.matterId,
    label: 'Filter by matter',
    placeholder: 'All matters',
    onChange: (v) => ((state.matterId = v), setQuery({ matter: v }), refresh()),
  });
  matterF.classList.add('toolbar-picker');

  const table = dataTable({
    caption: 'Account ledger',
    columnsKey: 'ledger',
    sort: null,
    columns: [
      { id: 'date', label: 'Date', width: '112px', fixed: true, render: (t) => formatDate(t.date) },
      {
        id: 'description',
        label: 'Description',
        render: (t) => h('span', { title: t.description || '' }, t.description || (t.type === 'deposit' ? 'Deposit' : 'Withdrawal'), t.payee ? h('span.subtle', ` to ${t.payee}`) : null),
      },
      { id: 'matter', label: 'Matter', render: (t) => (t.matterId ? matterLink(t.matterId) : h('span.subtle', 'None')) },
      { id: 'contact', label: 'Contact', hidden: true, render: (t) => (t.contactId ? contactLink(t.contactId) : '') },
      { id: 'reference', label: 'Reference', render: (t) => t.reference || '' },
      { id: 'deposit', label: 'Deposit', align: 'r', render: (t) => (t.type !== 'withdrawal' ? h('span.num.text-success', formatMoney(Math.abs(t.amountCents))) : '') },
      { id: 'withdrawal', label: 'Withdrawal', align: 'r', render: (t) => (t.type === 'withdrawal' ? h('span.num', formatMoney(Math.abs(t.amountCents))) : '') },
      { id: 'balance', label: 'Balance', align: 'r', render: (t) => h(`span.num.strong${t.balance < 0 ? '.text-danger' : ''}`, formatMoney(t.balance)) },
      {
        id: 'actions',
        label: '',
        srLabel: 'Actions',
        fixed: true,
        width: '52px',
        render: (t) =>
          h(
            'button.icon-btn.sm',
            {
              type: 'button',
              'aria-label': `Delete transaction of ${formatMoney(t.amountCents)} on ${formatDate(t.date)}`,
              title: t.paymentId ? 'Part of a payment' : 'Delete',
              disabled: !!t.paymentId || null,
              onClick: () => deleteTransaction(store.get('transactions', t.id)),
            },
            icon('trash', 15),
          ),
      },
    ],
    mobile: (t) =>
      h(
        'div.list-item',
        h('span.grow', h('span.title', t.description || t.type), h('span.sub', [formatDate(t.date), lookup.matter(t.matterId)?.displayNumber].filter(Boolean).join(' · '))),
        h(
          'span.stack-sm.r',
          h(`span.num.strong${t.type === 'withdrawal' ? '' : '.text-success'}`, `${t.type === 'withdrawal' ? '-' : '+'}${formatMoney(Math.abs(t.amountCents))}`),
          h('span.num.subtle.small', formatMoney(t.balance)),
        ),
      ),
    empty: () => emptyState({ compact: true, icon: 'list', title: 'No transactions', text: 'Nothing was recorded in this period.', headingLevel: 3 }),
    footer: (rows) => {
      let dep = 0;
      let wd = 0;
      for (const t of rows) {
        if (t.type === 'withdrawal') wd += Math.abs(t.amountCents);
        else dep += Math.abs(t.amountCents);
      }
      return [
        h('span', h('strong', String(rows.length)), ' transactions'),
        h('span', 'Deposits ', h('strong', formatMoney(dep))),
        h('span', 'Withdrawals ', h('strong', formatMoney(wd))),
        // Rows are newest first.
        rows.length ? h('span', 'Closing balance ', h('strong', formatMoney(rows[0].balance))) : null,
      ];
    },
  });

  /** Ledger rows for the filters; running balance covers all earlier history. */
  function rows() {
    const a = account();
    const all = ledger(store.all('transactions'), { accountId: a.id, matterId: state.matterId || null, opening: state.matterId ? 0 : Number(a.openingBalanceCents) || 0 });
    return all.filter((t) => (!state.from || t.date >= state.from) && (!state.to || t.date <= state.to)).reverse();
  }

  function drawHead() {
    const a = account();
    if (!a) return;
    const bal = accountBalance(a, store.all('transactions'));
    headNode.replaceChildren(
      pageHeader({
        title: a.name,
        crumbs: [{ label: 'Accounts', href: '#/accounts' }, { label: a.name }],
        subtitle: [
          pill(a.type === 'trust' ? 'Trust' : 'Operating', a.type === 'trust' ? 'violet' : 'accent'),
          h('span', [a.institution, a.last4 ? `ending ${a.last4}` : ''].filter(Boolean).join(' · ')),
          h('span', 'Balance ', h('strong.num', formatMoney(bal))),
        ],
        actions: [
          a.type === 'trust' ? h('button.btn', { type: 'button', onClick: () => openTrustDialog({ type: 'deposit', accountId: a.id }) }, icon('arrow-down', 16), 'Deposit') : null,
          a.type === 'trust' ? h('button.btn', { type: 'button', onClick: () => openTrustDialog({ type: 'withdrawal', accountId: a.id }) }, icon('arrow-up', 16), 'Withdraw') : null,
          h('button.btn', { type: 'button', onClick: () => openAccountDialog({ account: a }) }, icon('pencil', 16), 'Edit'),
          h('button.btn', { type: 'button', onClick: exportCsv }, icon('download', 16), h('span.hide-sm', 'Export')),
        ],
      }),
    );
  }

  function exportCsv() {
    const a = account();
    downloadCsv(`${a.name.replace(/[^\w-]+/g, '-').toLowerCase()}-ledger.csv`, [
      ['Date', 'Description', 'Matter', 'Contact', 'Reference', 'Deposit', 'Withdrawal', 'Balance'],
      ...table.rows
        .slice()
        .reverse()
        .map((t) => [
          t.date,
          t.description || '',
          lookup.matter(t.matterId)?.displayNumber || '',
          t.contactId ? lookup.contactName(t.contactId) : '',
          t.reference || '',
          t.type !== 'withdrawal' ? (Math.abs(t.amountCents) / 100).toFixed(2) : '',
          t.type === 'withdrawal' ? (Math.abs(t.amountCents) / 100).toFixed(2) : '',
          (t.balance / 100).toFixed(2),
        ]),
    ]);
  }

  // Three-way reconciliation (trust accounts only). Nothing is stored.
  let statement = null;
  const stmtInput = moneyInput({ name: 'statement', placeholder: 'Bank statement balance' });
  stmtInput.addEventListener('input', () => {
    statement = stmtInput.value.trim() ? stmtInput.cents : null;
    drawRecon();
  });
  const reconOut = h('div.recon-out', { role: 'status', 'aria-live': 'polite' });
  function drawRecon() {
    const a = account();
    if (!a || a.type !== 'trust') {
      reconNode.replaceChildren();
      return;
    }
    const r = reconcileTrust({ account: a, transactions: store.all('transactions'), statementCents: statement });
    const cell = (label, value, ok) =>
      h(
        'div.recon-cell',
        h('span.recon-label', label),
        h('span.recon-value.num', value),
        ok === null ? null : h(`span.recon-flag.${ok ? 'ok' : 'bad'}`, icon(ok ? 'circle-check' : 'alert', 14), ok ? 'Agrees' : 'Differs'),
      );
    reconOut.replaceChildren(
      h(
        'div.recon-grid',
        cell('Bank statement', r.bank === null ? 'Not entered' : formatMoney(r.bank), r.bank === null ? null : r.bankDiff === 0),
        cell('Account ledger', formatMoney(r.book), null),
        cell('Sum of client ledgers', formatMoney(r.clients), r.clientsDiff === 0),
      ),
      r.unassigned
        ? h(
            'div.notice.warning',
            icon('warning', 16),
            h('span', `${formatMoney(r.unassigned)} in this account is not assigned to any matter${Number(a.openingBalanceCents) ? ', including its opening balance' : ''}. Every trust transaction should belong to a client matter.`),
          )
        : null,
      r.negative.length
        ? h(
            'div.notice.danger',
            icon('alert', 16),
            h(
              'span',
              `${r.negative.length} ${r.negative.length === 1 ? 'matter has' : 'matters have'} a negative trust balance: `,
              r.negative.map((n, i) => [i ? ', ' : '', matterLink(n.matterId, { short: true })]),
            ),
          )
        : null,
      r.bank !== null && r.bankDiff !== 0
        ? h(
            'div.notice.warning',
            icon('warning', 16),
            h(
              'span',
              `The bank statement is ${formatMoney(Math.abs(r.bankDiff))} ${r.bankDiff > 0 ? 'higher' : 'lower'} than the ledger. Look for outstanding checks, deposits in transit, or missing entries.`,
            ),
          )
        : null,
      r.balanced && r.bank !== null ? h('div.notice.success', icon('shield-check', 16), h('span', 'All three balances agree.')) : null,
    );
    reconNode.replaceChildren(
      card({
        title: 'Three-way reconciliation',
        actions: h('button.btn.sm', { type: 'button', onClick: () => printTrustLedger('') }, icon('printer', 14), 'Print client ledger'),
        body: h(
          'div.stack',
          h('p.subtle', 'Compare the bank statement, this account’s ledger, and the total of every client’s trust ledger. They should match exactly. Nothing you enter here is saved.'),
          field('Statement ending balance', stmtInput),
          reconOut,
        ),
      }),
    );
  }

  function refresh() {
    if (!account()) return;
    drawHead();
    table.setRows(rows());
    drawRecon();
  }
  syncRange();
  ctx.watch(['accounts', 'transactions', 'matters', 'contacts'], refresh);

  return {
    title: account()?.name || 'Account',
    node: h(
      'div.page.acct-page',
      headNode,
      h(
        'section.card.list-card.ledger-card',
        { 'aria-label': 'Ledger' },
        h(
          'div.toolbar',
          h('div.range-group', { role: 'group', 'aria-label': 'Date range' }, prev, rangeSel, fromI, h('span.subtle', { 'aria-hidden': 'true' }, 'to'), toI, next),
          matterF,
          h('div.spacer'),
          table.columnsButton(),
        ),
        table.node,
      ),
      reconNode,
    ),
  };
}

/** Printable trust ledger for one matter (pick one in the dialog when matterId is empty). */
export function printTrustLedger(matterId) {
  const store = app.store;
  const trustIds = new Set(lookup.trustAccounts().map((a) => a.id));
  const withTrust = [
    ...new Set(
      store
        .all('transactions')
        .filter((t) => trustIds.has(t.accountId) && t.matterId)
        .map((t) => t.matterId),
    ),
  ]
    .map((id) => lookup.matter(id))
    .filter(Boolean);
  // A matter asked for by name (say, one with a minimum but no deposit yet) is always offered.
  if (matterId && lookup.matter(matterId) && !withTrust.some((m) => m.id === matterId)) withTrust.push(lookup.matter(matterId));
  if (!withTrust.length) {
    import('../ui/toast.js').then((m) => m.toast('No matter has trust transactions yet.', { type: 'info' }));
    return;
  }
  let current = matterId || withTrust[0].id;
  const sel = select({
    name: 'ledgerMatter',
    'aria-label': 'Matter',
    value: current,
    options: withTrust.sort((a, b) => (a.number || 0) - (b.number || 0)).map((m) => ({ value: m.id, label: matterLabel(m) })),
  });
  const docNode = h('div');
  const firm = app.settings().firm;
  function draw() {
    const m = lookup.matter(current);
    const rowsAll = ledger(
      store.all('transactions').filter((t) => trustIds.has(t.accountId)),
      { matterId: current },
    );
    const c = lookup.contact(m?.clientId);
    const balance = lookup.trustAccounts().reduce((n, a) => n + matterAccountBalance(current, a.id, store.all('transactions')), 0);
    docNode.replaceChildren(
      h(
        'article.print-doc.statement',
        h(
          'div.doc-head',
          h(
            'div',
            h('div.doc-firm', firm.name || 'Your firm'),
            h('div.doc-muted.pre', formatAddress({ street: firm.street, city: firm.city, region: firm.region, postal: firm.postal, country: firm.country }, { multiline: true })),
          ),
          h('div.doc-title-block', h('h2.doc-title', 'Client trust ledger'), h('div.doc-muted', `As of ${formatDate(app.today())}`)),
        ),
        h(
          'div.doc-parties',
          h('div', h('div.doc-label', 'Client'), h('div.strong', contactName(c))),
          h('div', h('div.doc-label', 'Matter'), h('div.strong', m?.displayNumber || ''), h('div', m?.description || '')),
        ),
        h(
          'table.table-plain.doc-table',
          h('thead', h('tr', h('th', 'Date'), h('th', 'Description'), h('th', 'Reference'), h('th.r', 'Deposit'), h('th.r', 'Withdrawal'), h('th.r', 'Balance'))),
          h(
            'tbody',
            rowsAll.map((t) =>
              h(
                'tr',
                h('td.nowrap', formatDate(t.date)),
                h('td', t.description || ''),
                h('td', t.reference || ''),
                h('td.r.num', t.type !== 'withdrawal' ? formatMoney(Math.abs(t.amountCents)) : ''),
                h('td.r.num', t.type === 'withdrawal' ? formatMoney(Math.abs(t.amountCents)) : ''),
                h('td.r.num', formatMoney(t.balance)),
              ),
            ),
          ),
          h('tfoot', h('tr', h('td', { colspan: '5' }, 'Trust balance held'), h('td.r.num', formatMoney(balance)))),
        ),
      ),
    );
  }
  sel.addEventListener('change', () => ((current = sel.value), draw()));
  draw();
  openDialog({
    title: 'Client trust ledger',
    size: 'wide',
    cls: 'statement-dialog',
    body: h('div.stack', h('div.no-print', field('Matter', sel)), docNode),
    footer: ({ close }) => [
      h('div.spacer'),
      h('button.btn', { type: 'button', onClick: () => close() }, 'Close'),
      h('button.btn.primary', { type: 'button', onClick: () => window.print() }, icon('printer', 16), 'Print'),
    ],
  });
}
