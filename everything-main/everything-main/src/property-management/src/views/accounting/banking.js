/** Banking: bank accounts with balances and reconciliation status. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../app.js';
import { pageHeader, stat, dataTable, emptyState, statusPill } from '../../ui/components.js';
import { bankAccounts } from '../../core/accounts.js';
import { unreconciledLines, lastReconciliation } from '../../core/financials.js';
import { money, date } from '../common.js';
import { accountDialog, stmtCell, runTx } from './shared.js';
import { navigate } from '../../ui/router.js';

export function render(ctx) {
  const store = app.store;

  const body = ctx.live(() => {
    const ledger = app.ledger();
    const today = app.today();
    const banks = bankAccounts(store.all('accounts'));
    const rows = banks.map((a) => {
      const open = store.all('reconciliations').find((r) => r.accountId === a.id && r.status === 'open');
      return { a, balance: ledger.account(a.id), pending: unreconciledLines(store, a.id, today).length, last: lastReconciliation(store, a.id), open };
    });
    const total = rows.reduce((s, r) => s + r.balance, 0);
    const pending = rows.reduce((s, r) => s + r.pending, 0);
    return [
      h(
        'div.stats',
        stat({ label: 'Total cash', value: money(total), sub: `${rows.length} bank ${rows.length === 1 ? 'account' : 'accounts'}` }),
        stat({ label: 'Not yet reconciled', value: pending.toLocaleString(), sub: 'Transactions to match to statements', tone: pending ? 'warning' : null }),
      ),
      h(
        'section.card.list-card',
        { 'aria-label': 'Bank accounts' },
        dataTable({
          caption: 'Bank accounts',
          rows,
          rowHref: (r) => `#/banking/${r.a.id}`,
          columns: [
            { id: 'name', label: 'Account', render: (r) => h('span.acct-desc', h('span.primary-link', r.a.name), r.a.description ? h('span.acct-memo', r.a.description) : null) },
            { id: 'no', label: 'Number', render: (r) => (r.a.last4 ? h('span.subtle.nowrap', `•••• ${r.a.last4}`) : h('span.subtle', 'Not set')) },
            {
              id: 'rec',
              label: 'Last reconciled',
              render: (r) => (r.open ? statusPill('open') : r.last ? h('span.nowrap', date(r.last.statementDate)) : h('span.subtle', 'Never')),
            },
            { id: 'pending', label: 'Unreconciled', align: 'r', render: (r) => (r.pending ? h('span.num', r.pending.toLocaleString()) : h('span.subtle', 'None')) },
            { id: 'balance', label: 'Balance', align: 'r', render: (r) => stmtCell(r.balance, { strong: true }) },
          ],
          mobile: (r) =>
            h(
              'a.mobile-row',
              { href: `#/banking/${r.a.id}` },
              h('span.acct-bank-icon', icon('landmark', 18)),
              h('div.grow', { style: { minWidth: 0 } }, h('div.m-title', r.a.name), h('div.m-sub', [r.a.last4 ? `••${r.a.last4}` : '', r.pending ? `${r.pending} unreconciled` : 'All reconciled'].filter(Boolean).join(' · '))),
              h('div.m-end', stmtCell(r.balance, { strong: true })),
            ),
          empty: emptyState({
            icon: 'landmark',
            title: 'No bank accounts',
            text: 'Add the accounts you collect rent into and pay bills from.',
            headingLevel: 3,
            actions: [h('button.btn.primary', { type: 'button', onClick: addAccount }, icon('plus', 16), 'Add bank account')],
          }),
        }),
      ),
    ];
  }, ['accounts', 'transactions', 'reconciliations']);

  async function addAccount() {
    const a = await accountDialog(null, { type: 'asset', bank: true });
    if (a) navigate(`/banking/${a.id}`);
  }

  return {
    node: h(
      'div.page.acct-page',
      pageHeader({
        title: 'Banking',
        subtitle: 'Bank balances, registers and reconciliation',
        actions: [h('button.btn', { type: 'button', onClick: () => runTx('transferDialog') }, icon('transfer', 16), 'Transfer'), h('button.btn.primary', { type: 'button', onClick: addAccount }, icon('plus', 16), 'Add bank account')],
      }),
      body,
    ),
    title: 'Banking',
  };
}
