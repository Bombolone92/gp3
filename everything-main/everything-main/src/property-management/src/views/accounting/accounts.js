/** Chart of accounts, grouped by type, with balances. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../app.js';
import { pageHeader, searchBox, emptyState } from '../../ui/components.js';
import { openMenu } from '../../ui/menu.js';
import { confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { setQuery } from '../../ui/router.js';
import { groupAccounts, normalSign, typeLabel } from '../../core/accounts.js';
import { matches } from '../../core/format.js';
import { accountDialog, accountInUse, stmtCell } from './shared.js';

const ROLE_HINT = {
  bank: 'Bank account',
  ar: 'Tenant balances post here',
  ap: 'Vendor bills post here',
  deposits: 'Security deposits post here',
  prepaid: 'Tenant prepayments post here',
  rent: 'Rent charges post here',
  'late-fees': 'Late fees post here',
  contributions: 'Owner contributions post here',
  distributions: 'Owner distributions post here',
  retained: 'Year-end balance of income and expenses',
};

export function render(ctx) {
  const store = app.store;
  const state = { q: ctx.query.q || '', inactive: ctx.query.inactive === '1' };

  const search = searchBox({
    value: state.q,
    placeholder: 'Search accounts',
    label: 'Search accounts',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      body.redraw();
    },
  });
  const inactive = h('input', { type: 'checkbox', checked: state.inactive });
  inactive.addEventListener('change', () => {
    state.inactive = inactive.checked;
    setQuery({ inactive: inactive.checked ? '1' : '' });
    body.redraw();
  });

  const body = ctx.live(() => {
    const ledger = app.ledger();
    const list = store.all('accounts').filter((a) => (state.inactive || a.active !== false) && (!state.q || matches(`${a.number} ${a.name} ${a.description || ''} ${typeLabel(a.type)}`, state.q)));
    const groups = groupAccounts(list);
    if (!groups.length)
      return h(
        'section.card',
        emptyState({ compact: !!store.all('accounts').length, icon: 'list', title: store.all('accounts').length ? 'No matching accounts' : 'No accounts yet', text: store.all('accounts').length ? 'Try a different search.' : 'Add accounts to categorize income, expenses and balances.', headingLevel: 2 }),
      );
    return groups.map((g) => {
      const total = g.accounts.reduce((s, a) => s + ledger.account(a.id) * normalSign(a.type), 0);
      return h(
        'section.card.acct-coa',
        { 'aria-labelledby': `coa-${g.type}` },
        h('div.card-head', h('h2.grow', { id: `coa-${g.type}` }, g.label), stmtCell(total, { strong: true })),
        h(
          'div.table-wrap',
          h(
            'table.table.acct-coa-table',
            h('caption.sr-only', g.label),
            h('thead', h('tr', h('th', { scope: 'col' }, 'Number'), h('th', { scope: 'col' }, 'Name'), h('th.r', { scope: 'col' }, 'Balance'), h('th', { scope: 'col' }, h('span.sr-only', 'Actions')))),
            h(
              'tbody',
              g.accounts.map((a) =>
                h(
                  `tr${a.active === false ? '.acct-inactive' : ''}`,
                  h('td.acct-no-cell', a.number || ''),
                  h(
                    'td',
                    h('a.primary-link', { href: a.bank ? `#/banking/${a.id}` : `#/accounts/${a.id}` }, a.name),
                    a.active === false ? h('span.pill.acct-pill-inline', 'Inactive') : null,
                    a.system ? h('span.acct-lock', { title: 'Used by the app. It cannot be deleted.' }, icon('lock', 13), h('span.sr-only', 'Required account')) : null,
                    a.description || ROLE_HINT[a.role] ? h('div.acct-memo', a.description || ROLE_HINT[a.role]) : null,
                  ),
                  h('td.r', stmtCell(ledger.account(a.id) * normalSign(a.type))),
                  h(
                    'td.r.acct-act',
                    h('button.icon-btn.sm', { type: 'button', 'aria-label': `Actions for ${a.name}`, onClick: (e) => menu(e.currentTarget, a) }, icon('more', 16)),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    });
  }, ['accounts', 'transactions']);

  function menu(anchor, a) {
    openMenu(anchor, [
      { label: 'Edit', icon: 'pencil', run: () => accountDialog(a) },
      { label: 'View register', icon: 'list', href: `#/accounts/${a.id}` },
      a.system ? null : { label: a.active === false ? 'Reactivate' : 'Deactivate', icon: a.active === false ? 'undo' : 'archive', run: () => setActive(a, a.active === false) },
      a.system ? null : { separator: true },
      a.system ? null : { label: 'Delete', icon: 'trash', danger: true, run: () => remove(a) },
    ]);
  }

  function setActive(a, on) {
    store.patch('accounts', a.id, { active: on });
    toast(on ? `${a.name} reactivated` : `${a.name} deactivated. It no longer appears in pickers.`);
  }

  async function remove(a) {
    if (accountInUse(a.id)) {
      const ok = await confirmDialog({
        title: 'This account is in use',
        message: `${a.name} is used by transactions, leases or other records, so it cannot be deleted. Deactivate it instead to hide it from pickers while keeping its history.`,
        confirmLabel: 'Deactivate',
      });
      if (ok) setActive(a, false);
      return;
    }
    const ok = await confirmDialog({ title: `Delete ${a.name}?`, message: 'The account has no transactions and will be removed from the chart of accounts.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const removed = store.remove('accounts', a.id);
    toast(`${a.name} deleted`, { action: { label: 'Undo', run: () => store.restore('accounts', removed) } });
  }

  return {
    node: h(
      'div.page.acct-page',
      pageHeader({
        title: 'Chart of accounts',
        subtitle: 'Categories for every amount in your books',
        actions: [h('button.btn.primary', { type: 'button', onClick: () => accountDialog() }, icon('plus', 16), 'Add account')],
      }),
      h('div.toolbar.acct-toolbar', search, h('label.check', inactive, h('span', 'Show inactive'))),
      h('div.stack.acct-stack', body),
    ),
    title: 'Chart of accounts',
  };
}
