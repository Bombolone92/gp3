/** Helpers shared by the accounting screens. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app, lookup } from '../../app.js';
import { field, textInput, textarea, select, emptyState } from '../../ui/components.js';
import { formDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { addMonths, startOfMonth, endOfMonth } from '../../core/dates.js';
import { ACCOUNT_TYPES, ACC } from '../../core/accounts.js';
import { kindLabel, txTotal } from '../../core/ledger.js';
import { displayName } from '../../core/format.js';
import { money } from '../common.js';

/** Transaction dialogs live in another module; load them on demand. */
export const txDialogs = () => import('../transactions/dialogs.js');

export async function runTx(name, args) {
  try {
    const m = await txDialogs();
    if (typeof m[name] !== 'function') {
      toast('This action is not available yet.', { type: 'error' });
      return null;
    }
    return await m[name](args);
  } catch (err) {
    console.error(err);
    toast(err?.message || 'Something went wrong.', { type: 'error' });
    return null;
  }
}

// ---- Periods ------------------------------------------------------------------------

export const PERIODS = [
  { id: 'month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last-year', label: 'Last year' },
  { id: 'custom', label: 'Custom' },
];

/** [from, to] for a period id relative to today. */
export function periodRange(id, today, custom = {}) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  switch (id) {
    case 'month':
      return [startOfMonth(today), endOfMonth(today)];
    case 'last-month': {
      const s = startOfMonth(addMonths(startOfMonth(today), -1));
      return [s, endOfMonth(s)];
    }
    case 'quarter': {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      const s = `${y}-${String(qm).padStart(2, '0')}-01`;
      return [s, endOfMonth(addMonths(s, 2))];
    }
    case 'last-year':
      return [`${y - 1}-01-01`, `${y - 1}-12-31`];
    case 'custom':
      return [custom.from || `${y}-01-01`, custom.to || today];
    default:
      return [`${y}-01-01`, today];
  }
}

/**
 * Period select plus custom date inputs. onChange({ period, from, to }).
 * Returns a node with a .state getter.
 */
export function periodPicker({ period = 'ytd', from = '', to = '', onChange, label = 'Period' }) {
  const today = app.today();
  const sel = select({ value: period, options: PERIODS.map((p) => ({ value: p.id, label: p.label })), 'aria-label': label });
  const [df, dt] = periodRange(period, today, { from, to });
  const fromIn = h('input.input', { type: 'date', value: df, 'aria-label': 'From date' });
  const toIn = h('input.input', { type: 'date', value: dt, 'aria-label': 'To date' });
  const dates = h('div.acct-dates', fromIn, h('span.subtle', { 'aria-hidden': 'true' }, 'to'), toIn);
  const state = () => ({ period: sel.value, from: fromIn.value, to: toIn.value });
  const sync = () => {
    if (sel.value !== 'custom') {
      const [f, t] = periodRange(sel.value, today);
      fromIn.value = f;
      toIn.value = t;
    }
    dates.hidden = sel.value !== 'custom';
  };
  sync();
  sel.addEventListener('change', () => {
    sync();
    onChange?.(state());
  });
  for (const i of [fromIn, toIn])
    i.addEventListener('change', () => {
      if (fromIn.value && toIn.value && fromIn.value > toIn.value) [fromIn.value, toIn.value] = [toIn.value, fromIn.value];
      onChange?.(state());
    });
  const node = h('div.acct-period', sel, dates);
  Object.defineProperty(node, 'state', { get: state });
  return node;
}

export const periodLabel = (from, to) => {
  const f = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${f(from)} to ${f(to)}`;
};

// ---- Formatting ---------------------------------------------------------------------

/** Statement figure: negatives in parentheses. */
export function stmt(cents) {
  if (cents < 0) return `(${money(-cents)})`;
  return money(cents);
}

export function stmtCell(cents, { strong = false } = {}) {
  return h(`span.num${cents < 0 ? '.neg' : ''}${strong ? '.strong' : ''}`, stmt(cents));
}

/** Who a transaction is with, in plain words. */
export function txParty(tx) {
  if (tx.leaseId) {
    const lease = lookup.lease(tx.leaseId);
    if (lease) {
      const names = lookup.tenantNames(lease);
      return names ? `${names} · ${lookup.leaseLabel(lease)}` : lookup.leaseLabel(lease);
    }
  }
  if (tx.vendorId) return displayName(lookup.vendor(tx.vendorId)) || 'Vendor';
  if (tx.ownerId) return displayName(lookup.owner(tx.ownerId)) || 'Owner';
  if (tx.payee) return tx.payee;
  if (tx.kind === 'transfer') {
    const to = tx.lines.find((l) => l.amount > 0);
    const from = tx.lines.find((l) => l.amount < 0);
    return `${lookup.account(from?.accountId)?.name || 'Account'} to ${lookup.account(to?.accountId)?.name || 'account'}`;
  }
  return '';
}

export function txTitle(tx) {
  return txParty(tx) || tx.memo || kindLabel(tx.kind);
}

/** Property shown for a transaction: its own, or the only one its lines use. */
export function txPropertyId(tx) {
  if (tx.propertyId) return tx.propertyId;
  const ids = [...new Set(tx.lines.map((l) => l.propertyId).filter(Boolean))];
  return ids.length === 1 ? ids[0] : ids.length ? 'multiple' : null;
}

export function txPropertyName(tx) {
  const id = txPropertyId(tx);
  if (id === 'multiple') return 'Multiple';
  return id ? lookup.property(id)?.name || '' : '';
}

export { txTotal, kindLabel };

export function voidPill() {
  return h('span.pill', { title: 'Voided transactions do not affect any balance' }, 'Void');
}

export function notFound(what, back) {
  return h(
    'div.page',
    emptyState({
      icon: 'search',
      title: `${what} not found`,
      text: 'It may have been deleted, or the link is wrong.',
      headingLevel: 1,
      actions: [h('a.btn.primary', { href: back.href }, back.label)],
    }),
  );
}

// ---- Account dialog --------------------------------------------------------------------

export function accountInUse(id) {
  if (Object.values(ACC).includes(id)) return true;
  for (const t of app.store.all('transactions')) for (const l of t.lines) if (l.accountId === id || l.forAccountId === id) return true;
  for (const l of app.store.all('leases')) if ((l.recurring || []).some((r) => r.accountId === id)) return true;
  // Accounts other records point at: a property's bank, the default banks,
  // a vendor's default expense account, budget lines.
  const acc = app.settings().accounting || {};
  if (acc.defaultBankId === id || acc.depositBankId === id) return true;
  if (app.store.all('properties').some((p) => p.bankAccountId === id)) return true;
  if (app.store.all('vendors').some((v) => v.accountId === id)) return true;
  if (app.store.all('budgets').some((b) => (b.lines || []).some((l) => l.accountId === id))) return true;
  return false;
}

/**
 * Add or edit an account. preset: { type, bank } for new accounts.
 * Resolves with the saved account or null.
 */
export async function accountDialog(account = null, preset = {}) {
  const store = app.store;
  const isNew = !account;
  const a = account || { type: preset.type || 'asset', bank: !!preset.bank, active: true };
  const number = textInput({ name: 'number', value: a.number || '', inputmode: 'numeric', placeholder: 'e.g. 1020' });
  const name = textInput({ name: 'name', value: a.name || '', placeholder: preset.bank ? 'e.g. Reserve savings' : 'e.g. Snow removal' });
  const type = select({ name: 'type', value: a.type, options: ACCOUNT_TYPES.map((t) => ({ value: t.id, label: t.label })), disabled: a.system || null });
  const description = textarea({ name: 'description', value: a.description || '', rows: 2 });
  const bank = h('input', { type: 'checkbox', name: 'bank', checked: !!a.bank, disabled: a.role === 'bank' || null });
  const last4 = textInput({ name: 'last4', value: a.last4 || '', inputmode: 'numeric', maxlength: 4, placeholder: '1234' });
  const active = h('input', { type: 'checkbox', name: 'active', checked: a.active !== false, disabled: a.system || null });
  const bankRow = h('div.stack.sm', h('label.check', bank, h('span', 'This is a bank account')), field('Last 4 digits of the account number', last4, { hint: 'Shown on registers and checks. Never enter the full number.' }));
  const syncBank = () => {
    bankRow.hidden = type.value !== 'asset';
    last4.closest('.field').hidden = !bank.checked;
  };
  type.addEventListener('change', syncBank);
  bank.addEventListener('change', syncBank);
  const result = await formDialog({
    title: isNew ? (preset.bank ? 'Add bank account' : 'Add account') : 'Edit account',
    submitLabel: isNew ? 'Add account' : 'Save',
    body: () => {
      const node = h(
        'div.stack',
        h('div.form-grid', field('Account name', name, { required: true, span2: true }), field('Number', number, { hint: 'Optional. Orders the chart of accounts.' }), field('Type', type, { hint: a.system ? 'The app posts to this account, so its type is fixed.' : null })),
        field('Description', description),
        bankRow,
        a.system ? null : h('label.check', active, h('span', 'Active (shown in pickers)')),
      );
      queueMicrotask(syncBank);
      return node;
    },
    onSubmit: () => {
      const n = number.value.trim();
      if (n && store.all('accounts').some((x) => x.id !== a.id && String(x.number) === n)) {
        toast(`Account number ${n} is already used.`, { type: 'error' });
        number.focus();
        return false;
      }
      const digits = last4.value.replace(/\D/g, '').slice(-4);
      const isBank = type.value === 'asset' && bank.checked;
      const rec = {
        ...a,
        number: n,
        name: name.value.trim(),
        type: a.system ? a.type : type.value,
        description: description.value.trim(),
        bank: isBank,
        last4: isBank ? digits : '',
        active: a.system ? true : active.checked,
      };
      if (!rec.bank) delete rec.last4;
      return store.put('accounts', rec);
    },
  });
  if (result && result !== true) toast(isNew ? `${result.name} added` : 'Account saved');
  return result && result !== true ? result : null;
}

/** Small icon + text inline status for registers. */
export function clearedMark(cleared) {
  return cleared ? h('span.acct-cleared', { title: 'Reconciled' }, icon('circle-check', 15), h('span.sr-only', 'Reconciled')) : h('span.sr-only', 'Not reconciled');
}

