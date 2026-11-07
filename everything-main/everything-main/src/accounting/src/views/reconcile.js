/** Reconcile: start (pick account, statement date and balance), then tick off transactions. */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { field, moneyInput, dateInput, selectInput } from '../ui/fields.js';
import { amountNode, dateText } from '../ui/format.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/dialog.js';
import { navigate } from '../ui/router.js';
import { pageHead, emptyState, viewState, tabs, pageDraft } from './page.js';
import { openTxn } from '../forms/index.js';
import { store } from '../lib/store.js';
import { typeLabel } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { formatDate, today, endOfMonth, addMonths } from '../lib/dates.js';
import { typeInfo } from '../lib/accounts.js';
import { candidates, summarize, finishRecord, lastReconciliation, draftReconciliation, beginningBalance, undoLast } from '../lib/reconcile.js';

export function renderReconcile(main, route) {
  const accounts = store.accountsOfType('bank', 'creditCard', 'otherCurrentAsset');
  const accountId = route.params[0];
  if (!accountId) return renderStart(main, route, accounts);
  const account = store.account(accountId);
  if (!account) return renderStart(main, route, accounts);
  const draft = draftReconciliation(store, accountId);
  if (!draft) return renderStart(main, route, accounts, accountId);
  return renderSession(main, account, draft);
}

function renderStart(main, route, accounts, preselect = null) {
  // What the user has entered so far survives a re-render (a change synced
  // from another tab or device) for as long as they stay on this page.
  const form = pageDraft(route, 'reconcileStart', () => {
    const accountId = preselect || accounts[0]?.id || null;
    const l = accountId ? lastReconciliation(store, accountId) : null;
    return { accountId, statementDate: l ? endOfMonth(addMonths(l.statementDate, 1)) : endOfMonth(addMonths(today(), -1)), ending: null };
  });
  let { accountId, statementDate, ending } = form;
  const last = () => (accountId ? lastReconciliation(store, accountId) : null);
  const sel = selectInput({ options: accounts.map((a) => [a.id, a.name]), value: accountId, ariaLabel: 'Account', onChange: (v) => { accountId = form.accountId = v; paintInfo(); } });
  const date = dateInput({ value: statementDate, ariaLabel: 'Ending date', onChange: (v) => { statementDate = form.statementDate = v; } });
  const end = moneyInput({ value: ending, allowNegative: true, ariaLabel: 'Ending balance', onChange: (v) => { ending = form.ending = v; } });
  const info = el('div.keyval');
  function paintInfo() {
    const l = last();
    const sign = typeInfo(store.account(accountId)?.type).sign;
    info.replaceChildren(
      el('dt', {}, 'Beginning balance'), el('dd', {}, formatMoney(beginningBalance(store, accountId) * sign)),
      el('dt', {}, 'Last statement ending date'), el('dd', {}, l ? formatDate(l.statementDate) : 'Never reconciled'));
  }
  if (accountId) paintInfo();
  const history = [...store.recons.values()].filter((r) => r.status === 'done').sort((a, b) => b.statementDate.localeCompare(a.statementDate));
  swap(main, el('div.page', {},
    pageHead({ title: 'Reconcile', crumbs: [['Accounting', 'banking'], ['Reconcile']], actions: [el('a.btn', { href: '#/report/reconDiscrepancy' }, 'Changes after reconciliation')] }),
    !accounts.length ? emptyState({ iconName: 'scale', title: 'No accounts to reconcile', text: 'Add a bank or credit card account first.' }) : el('div.recon-start', {},
      el('div.card', {}, el('div.card-body.stack', {},
        el('h2', { style: { fontSize: '17px' } }, 'Which account do you want to reconcile?'),
        field('Account', sel),
        info,
        el('h2', { style: { fontSize: '17px', marginTop: '8px' } }, 'Add the following information'),
        el('p.field-hint', {}, 'Enter the ending date and balance from your bank or card statement.'),
        el('div.form-grid', {}, field('Ending balance', end, { required: true }), field('Ending date', date, { required: true })),
        el('div', {}, el('button.btn.btn-primary', {
          type: 'button',
          onclick: () => {
            if (ending === null || ending === undefined) { toast('Enter the statement ending balance.'); end.input.focus(); return; }
            const existing = draftReconciliation(store, accountId);
            store.put('recons', { ...(existing || {}), accountId, statementDate, endingBalance: ending, status: 'draft', clearedIds: existing?.clearedIds || autoTick(accountId, statementDate) });
            navigate(`reconcile/${accountId}`);
          },
        }, 'Start reconciling')))),
      history.length ? el('div.card', {}, el('div.card-head', {}, el('h2.card-title', {}, 'History')), el('div.card-body', {},
        el('table.grid', {},
          el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Account'), el('th', { scope: 'col' }, 'Statement ending date'), el('th.num', { scope: 'col' }, 'Ending balance'), el('th.num', { scope: 'col' }, 'Adjustment'), el('th', { scope: 'col' }, el('span.sr-only', {}, 'Action')))),
          el('tbody', {}, history.slice(0, 20).map((r) => el('tr', {},
            el('td', {}, store.account(r.accountId)?.name || ''),
            el('td', {}, formatDate(r.statementDate)),
            el('td.num', {}, formatMoney(r.endingBalance)),
            el('td.num', {}, r.adjustmentId ? formatMoney(store.total(store.txn(r.adjustmentId) || {}) || 0) : ''),
            el('td.actions-cell', {}, lastReconciliation(store, r.accountId)?.id === r.id ? el('button.row-link', { type: 'button', onclick: async () => {
              if (await confirmDialog({ title: 'Undo this reconciliation?', message: 'Its transactions become unreconciled again. Use this when a statement was reconciled by mistake.', confirmLabel: 'Undo', danger: true })) { undoLast(store, r.accountId); toast('Reconciliation undone'); }
            } }, 'Undo') : null))))))) : null)));
}

/** Pre-tick what the bank feed already cleared, up to the statement date. */
function autoTick(accountId, statementDate) {
  return candidates(store, accountId, statementDate).filter((c) => c.cleared).map((c) => c.txn.id);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function renderSession(main, account, draft) {
  const st = viewState(`recon:${draft.id}`, { tab: 'all' });
  const selected = new Set(draft.clearedIds || []);
  const items = candidates(store, account.id, draft.statementDate);
  const sign = typeInfo(account.type).sign;
  const card = account.type === 'creditCard';
  const sum = summarize(store, account.id, { endingBalance: draft.endingBalance, selected, items });
  const save = () => store.put('recons', { ...draft, clearedIds: [...selected] }, { silent: true });

  const header = el('div.recon-summary', {},
    el('div.recon-figure', {}, el('div.kpi-label', {}, 'Statement ending balance'), el('div.kpi-value', {}, formatMoney(sum.ending))),
    el('div.recon-op', { 'aria-hidden': 'true' }, '-'),
    el('div.recon-figure', {}, el('div.kpi-label', {}, 'Cleared balance'), el('div.kpi-value', {}, formatMoney(sum.cleared)),
      el('div.cell-sub', {}, `${formatMoney(sum.beginning)} beginning + ${plural(sum.nIn, card ? 'charge' : 'deposit')} ${formatMoney(sum.increases)} - ${plural(sum.nOut, 'payment')} ${formatMoney(sum.decreases)}`)),
    el('div.recon-op', { 'aria-hidden': 'true' }, '='),
    el('div.recon-figure', { role: 'status', 'aria-live': 'polite' }, el('div.kpi-label', {}, 'Difference'), el(`div.kpi-value${sum.difference ? '.neg' : ''}`, {}, formatMoney(sum.difference)), sum.difference === 0 ? el('div.cell-sub', { style: { color: 'var(--positive)' } }, el('span', { html: icon('ok', 13) }), ' You are balanced') : null));

  let list = items;
  if (st.tab === 'in') list = items.filter((c) => c.amount * sign > 0);
  if (st.tab === 'out') list = items.filter((c) => c.amount * sign < 0);
  const table = el('table.grid', { 'aria-label': 'Transactions to reconcile' });
  const allBox = el('input', { type: 'checkbox', 'aria-label': 'Select all' });
  allBox.checked = list.length > 0 && list.every((c) => selected.has(c.txn.id));
  allBox.addEventListener('change', () => { for (const c of list) if (allBox.checked) selected.add(c.txn.id); else selected.delete(c.txn.id); save(); rerender(); });
  table.append(el('thead', {}, el('tr', {},
    el('th', { scope: 'col' }, 'Date'), el('th', { scope: 'col' }, 'Cleared date'), el('th', { scope: 'col' }, 'Type'), el('th', { scope: 'col' }, 'Ref no.'), el('th', { scope: 'col' }, 'Payee'), el('th', { scope: 'col' }, 'Memo'),
    el('th.num', { scope: 'col' }, card ? 'Charge' : 'Payment'), el('th.num', { scope: 'col' }, card ? 'Payment' : 'Deposit'), el('th.check-cell', { scope: 'col' }, allBox))));
  const tb = el('tbody');
  for (const c of list) {
    const on = selected.has(c.txn.id);
    const cb = el('input', { type: 'checkbox', checked: on, 'aria-label': `Mark ${typeLabel(c.txn.type)} ${formatDate(c.txn.date)} ${formatMoney(Math.abs(c.amount))} as cleared` });
    cb.addEventListener('change', () => { if (cb.checked) selected.add(c.txn.id); else selected.delete(c.txn.id); save(); rerender(); });
    const natural = c.amount * sign;
    const tr = el('tr.clickable', { class: on ? 'is-selected' : '' },
      el('td', {}, dateText(c.txn.date)), el('td', {}, c.cleared ? 'Bank feed' : ''), el('td', {}, el('button.row-link', { type: 'button', onclick: () => openTxn(c.txn.id) }, typeLabel(c.txn.type))), el('td', {}, c.txn.num || c.txn.ref || ''),
      el('td', {}, store.contactName(c.txn.contactId)), el('td', {}, el('span.truncate', { style: { maxWidth: '220px', display: 'inline-block' } }, c.txn.memo || '')),
      el('td.num', {}, card ? (natural > 0 ? amountNode(natural) : '') : (natural < 0 ? amountNode(-natural) : '')),
      el('td.num', {}, card ? (natural < 0 ? amountNode(-natural) : '') : (natural > 0 ? amountNode(natural) : '')),
      el('td.check-cell', {}, cb));
    tr.addEventListener('click', (e) => { if (!e.target.closest('button, input')) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); } });
    tb.append(tr);
  }
  table.append(tb);

  const finish = async () => {
    let adjustmentId = null;
    if (sum.difference !== 0) {
      const ok = await confirmDialog({ title: 'Your books do not match the statement', message: `There is a difference of ${formatMoney(sum.difference)}. You can keep looking, or add an adjustment to Reconciliation Adjustments so the books match.`, confirmLabel: 'Add adjustment and finish', cancelLabel: 'Keep looking' });
      if (!ok) return;
      const diffDebit = sum.difference * sign; // natural -> debit sign
      const disc = store.roleAccount('reconDiscrepancy');
      const adj = store.saveTxn({ type: 'journal', date: draft.statementDate, num: store.nextNumber('journal'), memo: `Reconciliation adjustment for ${account.name}`, lines: [
        { accountId: account.id, debit: Math.max(diffDebit, 0), credit: Math.max(-diffDebit, 0), desc: 'Reconciliation adjustment' },
        { accountId: disc, debit: Math.max(-diffDebit, 0), credit: Math.max(diffDebit, 0), desc: 'Reconciliation adjustment' },
      ] }, { allowLocked: true });
      adjustmentId = adj.id;
      selected.add(adj.id);
    }
    const rec = finishRecord(store, { accountId: account.id, statementDate: draft.statementDate, endingBalance: draft.endingBalance, selected, draftId: draft.id, adjustmentId });
    store.put('recons', rec);
    toast(`${account.name} reconciled through ${formatDate(draft.statementDate)}`);
    navigate('reconcile');
  };

  function rerender() { renderSession(main, account, store.recons.get(draft.id) || draft); }

  swap(main, el('div.page', {},
    pageHead({
      title: `Reconcile ${account.name}`,
      crumbs: [['Reconcile', 'reconcile'], [account.name]],
      sub: el('span.muted', {}, `Statement ending date ${formatDate(draft.statementDate)}`),
      actions: [
        el('button.btn', { type: 'button', onclick: () => { store.put('recons', { ...draft, status: 'draft' }); toast('Saved for later'); navigate('reconcile'); } }, 'Save for later'),
        el('button.btn', { type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Stop reconciling?', message: 'Your ticks for this statement are discarded.', confirmLabel: 'Discard', danger: true })) { store.remove('recons', draft.id); navigate('reconcile'); } } }, 'Cancel'),
        el('button.btn.btn-primary', { type: 'button', onclick: finish }, 'Finish now'),
      ],
    }),
    header,
    tabs([['all', 'All', items.length], ['out', 'Payments', items.filter((c) => c.amount * sign < 0).length], ['in', card ? 'Charges' : 'Deposits', items.filter((c) => c.amount * sign > 0).length]], st.tab, (k) => { st.tab = k; rerender(); }, { label: 'Filter transactions' }),
    items.length ? el('div.table-wrap', {}, el('div.table-scroll', {}, table)) : emptyState({ iconName: 'ok', title: 'Nothing to reconcile', text: 'Every transaction up to the statement date is already reconciled.' })));
}
