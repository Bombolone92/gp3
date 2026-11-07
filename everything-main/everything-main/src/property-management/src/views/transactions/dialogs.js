/**
 * Every dialog that records money: lease payments, charges, credits,
 * refunds and deposit applications; vendor bills and bill payments;
 * expenses, transfers, journal entries and owner transactions. Each one
 * returns a Promise of the saved transaction (or null when cancelled) and
 * can be opened from any page.
 */
import { h, uniqueId } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { openDialog, confirmDialog } from '../../ui/dialog.js';
import { toast } from '../../ui/toast.js';
import { navigate } from '../../ui/router.js';
import { field, textInput, textarea, select, moneyInput, segmented } from '../../ui/components.js';
import { app, lookup } from '../../app.js';
import { ACC, accountLabel, chargeableAccounts, expenseAccounts } from '../../core/accounts.js';
import {
  buildApplyDeposit,
  buildBill,
  buildBillPayment,
  buildCharge,
  buildCredit,
  buildExpense,
  buildJournal,
  buildOwnerTransaction,
  buildPayment,
  buildRefund,
  buildTransfer,
  billStatus,
  kindLabel,
  suggestAllocation,
  txTotal,
} from '../../core/ledger.js';
import { addDays } from '../../core/dates.js';
import { PAYMENT_METHODS, methodLabel } from '../../core/settings.js';
import { displayName, formatAddress } from '../../core/format.js';
import { tenantName } from '../../core/leases.js';
import { centsToInput } from '../../core/money.js';
import { accountSelect, bankSelect, usableBank, leasePicker, money, propertySelect, unitSelect, vendorSelect, date as fmtDate } from '../common.js';
import { allocated, changeProblem, groupByVendor, journalDifference, restoreProblem } from './logic.js';
import { reconciledIds } from '../../core/financials.js';

const store = () => app.store;
const accountsById = () => lookup.accountsById();
const accName = (id) => lookup.account(id)?.name || 'Unknown account';

// ---- Dialog scaffold -------------------------------------------------------------

/**
 * A form in a dialog. body({ close, form, error }) builds the fields;
 * submit() returns the saved record, or false to stay open (after calling
 * error(message)). Resolves with the record, or null when cancelled.
 */
function txDialog({ title, size = '', submitLabel = 'Save', body, submit, secondary }) {
  return new Promise((resolve) => {
    let result = null;
    const formId = uniqueId('txf');
    const errorEl = h('div.notice.danger.tx-error', { role: 'alert', hidden: true });
    const error = (msg) => {
      errorEl.hidden = !msg;
      errorEl.replaceChildren(icon('alert', 16), h('span', msg || ''));
    };
    const submitBtn = h('button.btn.primary', { type: 'submit', form: formId }, submitLabel);
    openDialog({
      title,
      size,
      body: (api) => {
        const form = h('form.tx-form', { id: formId, novalidate: true });
        const ctx = { close: api.close, form, error, submitBtn };
        form.append(errorEl, body(ctx));
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          error('');
          const missing = [...form.querySelectorAll('[required]')].find((el) => !String(el.value || '').trim());
          if (missing) {
            missing.setAttribute('aria-invalid', 'true');
            missing.focus();
            error('Fill in the required fields.');
            return;
          }
          try {
            const out = await submit(ctx);
            if (out === false) return;
            result = out ?? null;
            api.close();
          } catch (err) {
            console.error(err);
            error(err?.message || 'This could not be saved.');
          }
        });
        return form;
      },
      footer: ({ close }) => [secondary ? secondary({ close }) : null, h('div.spacer'), h('button.btn', { type: 'button', onClick: () => close() }, 'Cancel'), submitBtn],
      onClose: () => resolve(result),
    });
  });
}

const dateInput = (value, attrs = {}) => textInput({ type: 'date', value: value || app.today(), ...attrs });
const methodSelect = (value = 'check') => select({ value, options: PAYMENT_METHODS.map((m) => ({ value: m.id, label: m.label })) });

/** Keep createdAt and attachments when replacing an existing transaction. */
/** Why saving an edited transaction would leave the books impossible, or null. */
function editProblem(old, tx) {
  return old ? changeProblem(store().all('transactions'), tx, { action: 'Saving this change' }) : null;
}

function keep(old, tx) {
  if (!old) return tx;
  return { ...tx, id: old.id, createdAt: old.createdAt, ...(old.attachments ? { attachments: old.attachments } : {}), ...(old.auto ? { auto: old.auto } : {}) };
}

function savedToast(message, tx, { receipt = false } = {}) {
  toast(message, {
    action: receipt ? { label: 'Print receipt', run: () => printReceipt(tx.id) } : { label: 'View', run: () => navigate(`/transactions/${tx.id}`) },
  });
}

function leaseBank(lease) {
  // The property's bank, else the default bank from settings, else the first.
  return usableBank(lookup.property(lease?.propertyId)?.bankAccountId);
}

/**
 * Lease section shared by the lease dialogs: a fixed summary when the lease
 * is known, otherwise a picker. onLease(lease) runs once one is chosen.
 */
function leaseSection(lease, onLease) {
  const wrap = h('div.tx-lease');
  const show = (l) => {
    const info = app.ledger().lease(l.id);
    wrap.replaceChildren(
      h(
        'div.tx-lease-summary',
        icon('file-signature', 18),
        h('div.grow', h('div.tx-lease-title', lookup.leaseLabel(l)), h('div.subtle', lookup.tenantNames(l) || 'No tenants')),
        h('div.tx-lease-balance', h('span.subtle', info.balance < 0 ? 'Credit' : 'Balance due'), h(`strong.num${info.balance > 0 ? '.owed' : ''}`, money(Math.abs(info.balance)))),
      ),
    );
  };
  if (lease) show(lease);
  else {
    const picker = leasePicker({
      onSelect: (l) => {
        show(l);
        onLease(l);
      },
    });
    picker.input.required = true;
    wrap.append(field('Lease', picker, { required: true }));
  }
  return wrap;
}

// ---- Line item rows -----------------------------------------------------------------

/**
 * Editable rows of { accountId, amount, memo } (charges, credits). Returns
 * a node with `.items` (non-zero rows) and `.total`.
 */
function amountRows({ items = [], accounts, addLabel = 'Add line', onChange } = {}) {
  const list = h('div.tx-rows');
  const rows = [];
  const total = h('strong.num');
  const totalRow = h('div.tx-rows-total', h('span.grow', 'Total'), total);
  const recalc = () => {
    total.textContent = money(rows.reduce((s, r) => s + r.amount.cents, 0));
    onChange?.();
  };
  const add = (it = {}) => {
    const acc = accountSelect({ value: it.accountId || accounts[0]?.id, filter: (a) => accounts.some((x) => x.id === a.id), 'aria-label': 'Account' });
    const amount = moneyInput({ cents: it.amount || 0, 'aria-label': 'Amount' });
    const memo = textInput({ value: it.memo || '', placeholder: 'Description (optional)', 'aria-label': 'Description' });
    const row = { acc, amount, memo };
    const node = h(
      'div.tx-row',
      acc,
      memo,
      amount,
      h('button.icon-btn', {
        type: 'button',
        'aria-label': 'Remove line',
        onClick: () => {
          if (rows.length === 1) return;
          rows.splice(rows.indexOf(row), 1);
          node.remove();
          recalc();
        },
      }, icon('x', 16)),
    );
    amount.addEventListener('input', recalc);
    rows.push(row);
    list.append(node);
    recalc();
    return row;
  };
  (items.length ? items : [{}]).forEach(add);
  const wrap = h('div.tx-lines', h('div.tx-row.tx-row-head', { 'aria-hidden': 'true' }, h('span', 'Account'), h('span', 'Description'), h('span.r', 'Amount'), h('span')), list, h('div.row', h('button.btn.ghost.sm', { type: 'button', onClick: () => add().acc.focus() }, icon('plus', 14), addLabel)), totalRow);
  Object.defineProperty(wrap, 'items', { get: () => rows.map((r) => ({ accountId: r.acc.value, amount: r.amount.cents, memo: r.memo.value.trim() })).filter((r) => r.amount > 0) });
  Object.defineProperty(wrap, 'total', { get: () => rows.reduce((s, r) => s + r.amount.cents, 0) });
  return wrap;
}

/**
 * Editable "apply to" table: one row per account with money owed. Returns a
 * node with `.allocations`, `.suggest(amount)`, `.manual` (user edited).
 */
function applyTable({ owed, label = 'Apply to', onChange, kept = new Map() }) {
  const body = h('tbody');
  const inputs = [];
  let manual = false;
  for (const [accountId, due] of owed) {
    const input = moneyInput({ cents: 0, 'aria-label': `Amount applied to ${accName(accountId)}`, cls: 'sm' });
    input.addEventListener('input', () => {
      manual = true;
      onChange?.();
    });
    inputs.push({ accountId, due, input });
    body.append(h('tr', h('td', accName(accountId)), h('td.r', h('span.num', money(Math.max(0, due)))), h('td.r.tx-apply-cell', input)));
  }
  const node = h(
    'div.tx-apply',
    h('div.tx-apply-head', h('span.field-label', label)),
    owed.length
      ? h('div.table-wrap', h('table.table.tx-apply-table', h('thead', h('tr', h('th', { scope: 'col' }, 'Account'), h('th.r', { scope: 'col' }, 'Owed'), h('th.r', { scope: 'col' }, 'Applied'))), body))
      : h('p.subtle.tx-apply-empty', 'Nothing is owed right now. The full amount will be held as a prepayment.'),
  );
  Object.defineProperty(node, 'allocations', { get: () => inputs.map((i) => ({ accountId: i.accountId, amount: i.input.cents })).filter((a) => a.amount > 0) });
  Object.defineProperty(node, 'manual', { get: () => manual, set: (v) => (manual = v) });
  /** A row applied above what is owed on it, flagged for the error message. */
  node.overApplied = () => {
    for (const i of inputs) i.input.removeAttribute('aria-invalid');
    // An edited transaction may keep what it already applied, even if a
    // later credit lowered what is owed on that charge.
    const row = inputs.find((i) => i.input.cents > Math.max(i.due, kept.get(i.accountId) || 0));
    if (!row) return null;
    row.input.setAttribute('aria-invalid', 'true');
    row.input.focus();
    return `${accName(row.accountId)} is owed ${money(row.due)}, so no more than that can be applied to it.`;
  };
  node.suggest = (amount) => {
    const map = new Map(owed);
    const s = suggestAllocation(map, amount, accountsById());
    for (const i of inputs) i.input.cents = s.find((x) => x.accountId === i.accountId)?.amount || 0;
    manual = false;
    onChange?.();
  };
  node.fill = (allocs) => {
    for (const i of inputs) i.input.cents = allocs.find((x) => x.accountId === i.accountId)?.amount || 0;
  };
  return node;
}

/** What a transaction being edited applied to each kind of charge: Map(accountId -> cents). */
function keptBy(old) {
  const out = new Map();
  for (const x of old?.lines || []) if (x.accountId === ACC.ar && x.amount < 0) out.set(x.forAccountId, (out.get(x.forAccountId) || 0) - x.amount);
  return out;
}

// ---- Lease dialogs -----------------------------------------------------------------------

/** Receive a payment on a lease. */
export function receivePaymentDialog({ leaseId = null, txId = null } = {}) {
  const old = txId ? store().get('transactions', txId) : null;
  let lease = lookup.lease(old?.leaseId || leaseId);
  const today = app.today();
  const amount = moneyInput({ cents: 0, required: true, 'aria-label': 'Amount' });
  const when = dateInput(old?.date || today, { required: true });
  const method = methodSelect(old?.method || 'check');
  const ref = textInput({ value: old?.ref || '', placeholder: 'Check or confirmation number' });
  const memo = textInput({ value: old?.memo || '', placeholder: 'Shown on the receipt' });
  const payer = textInput({ value: old?.payer || '' });
  const bank = bankSelect({ value: old?.bankAccountId || '' });
  const applyWrap = h('div');
  const summary = h('div.tx-summary', { 'aria-live': 'polite' });
  let apply = null;
  const after = h('label.check', h('input', { type: 'checkbox', name: 'printAfter' }), 'Print a receipt after saving');

  const refreshSummary = () => {
    if (!apply) return summary.replaceChildren();
    const total = amount.cents;
    const used = allocated(apply.allocations);
    summary.className = 'tx-summary';
    if (used > total) {
      summary.classList.add('bad');
      summary.replaceChildren(icon('alert', 16), h('span', `Applied amounts are ${money(used - total)} more than the payment.`));
    } else if (total > used) {
      summary.replaceChildren(icon('info', 16), h('span', `${money(used)} applied. ${money(total - used)} will be held as a prepayment and used for future charges.`));
    } else summary.replaceChildren(icon('check', 16), h('span', `${money(used)} applied in full.`));
  };

  const setLease = (l) => {
    lease = l;
    const info = app.ledger().lease(l.id);
    // When editing, add back what this payment already paid.
    const owed = new Map(info.byAccount);
    for (const a of old ? old.lines.filter((x) => x.accountId === ACC.ar) : []) owed.set(a.forAccountId, (owed.get(a.forAccountId) || 0) - a.amount);
    const kept = keptBy(old);
    // Rows for what is owed, and for what this payment already paid even if
    // nothing is owed there now (so editing keeps it).
    const rows = [...owed.entries()].filter(([id, v]) => v > 0 || kept.has(id));
    apply = applyTable({ owed: rows, onChange: refreshSummary, kept });
    applyWrap.replaceChildren(apply);
    if (!old) {
      amount.cents = Math.max(0, info.balance);
      bank.value = leaseBank(l);
      const names = lookup.tenants(l.tenantIds).map(tenantName);
      payer.value = names.join(', ');
    } else amount.cents = txTotal(old);
    if (old) apply.fill(old.lines.filter((x) => x.accountId === ACC.ar).map((x) => ({ accountId: x.forAccountId, amount: -x.amount })));
    else apply.suggest(amount.cents);
    refreshSummary();
  };
  amount.addEventListener('input', () => {
    if (apply && !apply.manual) apply.suggest(amount.cents);
    refreshSummary();
  });

  return txDialog({
    title: old ? 'Edit payment' : 'Receive payment',
    size: 'wide',
    submitLabel: old ? 'Save changes' : 'Save payment',
    body: () => {
      const node = h(
        'div.stack',
        leaseSection(lease, setLease),
        h('div.form-grid.three', field('Amount', amount, { required: true }), field('Date received', when, { required: true }), field('Payment method', method)),
        h('div.form-grid.three', field('Reference', ref), field('Received from', payer), field('Deposit to', bank)),
        field('Memo', memo),
        applyWrap,
        h('div.row.tx-apply-foot', summary, h('div.grow'), h('button.btn.ghost.sm', { type: 'button', onClick: () => apply?.suggest(amount.cents) }, icon('refresh', 14), 'Apply automatically')),
        old ? null : after,
      );
      if (lease) setLease(lease);
      return node;
    },
    submit: async ({ error, form }) => {
      if (!lease) return error('Choose a lease.'), false;
      const total = amount.cents;
      if (!(total > 0)) return error('Enter an amount greater than zero.'), false;
      if (allocated(apply.allocations) > total) return error('The amounts applied add up to more than the payment.'), false;
      const over = apply.overApplied();
      if (over) return error(`${over} Anything not applied is held as prepaid rent.`), false;
      const tx = keep(old, buildPayment({ lease, date: when.value, amount: total, allocations: apply.allocations, bankAccountId: bank.value, method: method.value, ref: ref.value, memo: memo.value, payer: payer.value.trim() }));
      const problem = editProblem(old, tx);
      if (problem) return error(problem), false;
      const saved = store().put('transactions', tx);
      if (form.querySelector('[name=printAfter]')?.checked) setTimeout(() => printReceipt(saved.id), 50);
      savedToast(old ? 'Payment updated' : `Payment of ${money(total)} recorded`, saved, { receipt: true });
      return saved;
    },
  });
}

/** Charge a lease. */
export function chargeDialog({ leaseId = null, txId = null, items = [] } = {}) {
  const old = txId ? store().get('transactions', txId) : null;
  let lease = lookup.lease(old?.leaseId || leaseId);
  const accounts = chargeableAccounts(store().all('accounts'));
  const when = dateInput(old?.date, { required: true });
  const due = dateInput(old?.dueDate || old?.date);
  const ref = textInput({ value: old?.ref || '' });
  const memo = textInput({ value: old?.memo || '', placeholder: 'e.g. Utility reimbursement for September' });
  const oldItems = old ? old.lines.filter((l) => l.accountId === ACC.ar).map((l) => ({ accountId: l.forAccountId, amount: l.amount, memo: l.memo })) : items;
  const rows = amountRows({ items: oldItems.length ? oldItems : [{ accountId: ACC.rent }], accounts, addLabel: 'Add another charge' });
  // A due date set apart from the charge date stays put when the date moves.
  if (old?.dueDate && old.dueDate !== old.date) due.dataset.touched = '1';
  when.addEventListener('change', () => {
    if (!due.dataset.touched) due.value = when.value;
  });
  due.addEventListener('input', () => (due.dataset.touched = '1'));
  return txDialog({
    title: old ? 'Edit charge' : 'Enter a charge',
    size: 'wide',
    submitLabel: old ? 'Save changes' : 'Save charge',
    body: () => h('div.stack', leaseSection(lease, (l) => (lease = l)), h('div.form-grid.three', field('Date', when, { required: true }), field('Due date', due), field('Reference', ref)), field('Memo', memo), rows),
    submit: ({ error }) => {
      if (!lease) return error('Choose a lease.'), false;
      if (!rows.items.length) return error('Enter an amount for at least one line.'), false;
      const tx = keep(old, buildCharge({ lease, date: when.value, dueDate: due.value || when.value, items: rows.items, memo: memo.value || rows.items.map((i) => i.memo || accName(i.accountId)).join(', '), ref: ref.value }));
      const problem = editProblem(old, tx);
      if (problem) return error(problem), false;
      const saved = store().put('transactions', tx);
      savedToast(old ? 'Charge updated' : `Charged ${money(rows.total)}`, saved);
      return saved;
    },
  });
}

/** Waive or reduce charges. */
export function creditDialog({ leaseId = null, txId = null } = {}) {
  const old = txId ? store().get('transactions', txId) : null;
  let lease = lookup.lease(old?.leaseId || leaseId);
  const accounts = chargeableAccounts(store().all('accounts')).filter((a) => a.type === 'income');
  const when = dateInput(old?.date, { required: true });
  const memo = textInput({ value: old?.memo || '', placeholder: 'Reason, e.g. Rent concession for repairs', required: true });
  let rows;
  const rowsWrap = h('div');
  const build = (l) => {
    const owed = l ? [...app.ledger().lease(l.id).byAccount.entries()].filter(([id, v]) => v > 0 && accounts.some((a) => a.id === id)) : [];
    const items = old ? old.lines.filter((x) => x.accountId === ACC.ar).map((x) => ({ accountId: x.forAccountId, amount: -x.amount })) : owed.length ? owed.slice(0, 1).map(([accountId]) => ({ accountId })) : [{ accountId: ACC.rent }];
    rows = amountRows({ items, accounts, addLabel: 'Add another line' });
    rowsWrap.replaceChildren(rows);
  };
  build(lease);
  return txDialog({
    title: old ? 'Edit credit' : 'Issue a credit',
    size: 'wide',
    submitLabel: old ? 'Save changes' : 'Save credit',
    body: () => h('div.stack', leaseSection(lease, (l) => ((lease = l), build(l))), h('p.subtle', 'A credit lowers what the tenant owes without recording money received.'), h('div.form-grid', field('Date', when, { required: true }), field('Reason', memo, { required: true })), rowsWrap),
    submit: ({ error }) => {
      if (!lease) return error('Choose a lease.'), false;
      if (!rows.items.length) return error('Enter an amount for at least one line.'), false;
      const tx = keep(old, buildCredit({ lease, date: when.value, items: rows.items, memo: memo.value }));
      const problem = editProblem(old, tx);
      if (problem) return error(problem), false;
      const saved = store().put('transactions', tx);
      savedToast(old ? 'Credit updated' : `Credit of ${money(rows.total)} issued`, saved);
      return saved;
    },
  });
}

/** Pay money back to a tenant from prepaid credit or their deposit. */
export function refundDialog({ leaseId = null, txId = null } = {}) {
  const old = txId ? store().get('transactions', txId) : null;
  let lease = lookup.lease(old?.leaseId || leaseId);
  const oldFrom = old?.lines?.find((l) => l.amount > 0)?.accountId || null;
  let from = oldFrom || ACC.prepaid;
  const amount = moneyInput({ cents: 0, required: true, 'aria-label': 'Amount' });
  const when = dateInput(old?.date, { required: true });
  const method = methodSelect(old?.method || 'check');
  const ref = textInput({ value: old?.ref || '', placeholder: 'Check number' });
  const payee = textInput({ value: old?.payee || '' });
  const memo = textInput({ value: old?.memo || '' });
  const bank = bankSelect({ value: old?.bankAccountId || '' });
  const avail = h('p.subtle.tx-available', { 'aria-live': 'polite' });
  const available = () => {
    if (!lease) return 0;
    const info = app.ledger().lease(lease.id);
    const base = from === ACC.depositsHeld ? info.deposits : info.prepaid;
    // When editing, what this refund already took comes back to its own source.
    return base + (old && from === oldFrom ? txTotal(old) : 0);
  };
  const refresh = () => {
    avail.textContent = lease ? `${money(available())} available to refund from ${from === ACC.depositsHeld ? 'the security deposit' : 'prepaid credit'}.` : '';
  };
  const fromCtl = segmented({
    label: 'Refund from',
    value: from,
    items: [
      { value: ACC.prepaid, label: 'Credit balance' },
      { value: ACC.depositsHeld, label: 'Security deposit' },
    ],
    onChange: (v) => {
      from = v;
      if (!old) {
        amount.cents = available();
        bank.value = v === ACC.depositsHeld ? usableBank(app.settings().accounting?.depositBankId, bank.value) : leaseBank(lease);
      }
      refresh();
    },
  });
  const setLease = (l) => {
    lease = l;
    if (!old) {
      const info = app.ledger().lease(l.id);
      if (!info.prepaid && info.deposits) from = ACC.depositsHeld;
      amount.cents = available();
      payee.value = lookup.tenants(l.tenantIds).map(tenantName).join(', ');
      bank.value = from === ACC.depositsHeld ? usableBank(app.settings().accounting?.depositBankId, leaseBank(l)) : leaseBank(l);
      fromCtl.querySelectorAll('[role=radio]').forEach((b, i) => b.setAttribute('aria-checked', String((i === 0 ? ACC.prepaid : ACC.depositsHeld) === from)));
    } else amount.cents = txTotal(old);
    refresh();
  };
  return txDialog({
    title: old ? 'Edit refund' : 'Refund a tenant',
    size: 'wide',
    submitLabel: old ? 'Save changes' : 'Save refund',
    body: () => {
      const node = h('div.stack', leaseSection(lease, setLease), h('div.field', h('span.field-label', 'Refund from'), fromCtl), avail, h('div.form-grid.three', field('Amount', amount, { required: true }), field('Date', when, { required: true }), field('Pay from', bank)), h('div.form-grid.three', field('Payment method', method), field('Check or reference', ref), field('Pay to', payee)), field('Memo', memo));
      if (lease) setLease(lease);
      return node;
    },
    submit: ({ error }) => {
      if (!lease) return error('Choose a lease.'), false;
      if (!(amount.cents > 0)) return error('Enter an amount greater than zero.'), false;
      if (amount.cents > available()) return error(`Only ${money(available())} is available to refund.`), false;
      const tx = keep(old, buildRefund({ lease, date: when.value, amount: amount.cents, fromAccountId: from, bankAccountId: bank.value, method: method.value, ref: ref.value, memo: memo.value || (from === ACC.depositsHeld ? 'Security deposit refund' : 'Refund of credit balance'), payee: payee.value }));
      const problem = editProblem(old, tx);
      if (problem) return error(problem), false;
      const saved = store().put('transactions', tx);
      savedToast(old ? 'Refund updated' : `Refund of ${money(amount.cents)} recorded`, saved);
      return saved;
    },
  });
}

/** Use the held security deposit to pay what the tenant owes. */
export function applyDepositDialog({ leaseId = null, txId = null } = {}) {
  const old = txId ? store().get('transactions', txId) : null;
  let lease = lookup.lease(old?.leaseId || leaseId);
  const when = dateInput(old?.date, { required: true });
  const memo = textInput({ value: old?.memo || 'Security deposit applied' });
  const tableWrap = h('div');
  const summary = h('p.subtle', { 'aria-live': 'polite' });
  let apply = null;
  let cap = 0;
  const refresh = () => {
    const used = apply ? allocated(apply.allocations) : 0;
    summary.textContent = `${money(cap)} held. Applying ${money(used)}, leaving ${money(Math.max(0, cap - used))} to refund or keep.`;
  };
  const setLease = (l) => {
    lease = l;
    const info = app.ledger().lease(l.id);
    const owed = new Map(info.byAccount);
    owed.delete(ACC.depositsHeld);
    if (old) for (const x of old.lines.filter((y) => y.accountId === ACC.ar)) owed.set(x.forAccountId, (owed.get(x.forAccountId) || 0) - x.amount);
    cap = info.deposits + (old ? txTotal(old) : 0);
    const kept = keptBy(old);
    const rows = [...owed.entries()].filter(([id, v]) => v > 0 || kept.has(id));
    apply = applyTable({ owed: rows, label: 'Apply to charges', onChange: refresh, kept });
    tableWrap.replaceChildren(apply);
    if (old) apply.fill(old.lines.filter((x) => x.accountId === ACC.ar).map((x) => ({ accountId: x.forAccountId, amount: -x.amount })));
    else apply.suggest(Math.min(cap, rows.reduce((s, [, v]) => s + v, 0)));
    refresh();
  };
  return txDialog({
    title: old ? 'Edit deposit application' : 'Apply security deposit',
    size: 'wide',
    submitLabel: old ? 'Save changes' : 'Apply deposit',
    body: () => {
      const node = h('div.stack', leaseSection(lease, setLease), h('div.form-grid', field('Date', when, { required: true }), field('Memo', memo)), tableWrap, summary);
      if (lease) setLease(lease);
      return node;
    },
    submit: ({ error }) => {
      if (!lease) return error('Choose a lease.'), false;
      const items = apply.allocations;
      const used = allocated(items);
      if (!used) return error('Enter an amount to apply.'), false;
      if (used > cap) return error(`Only ${money(cap)} of deposit is held.`), false;
      const over = apply.overApplied();
      if (over) return error(over), false;
      const tx = keep(old, buildApplyDeposit({ lease, date: when.value, items, memo: memo.value }));
      const problem = editProblem(old, tx);
      if (problem) return error(problem), false;
      const saved = store().put('transactions', tx);
      savedToast(`Applied ${money(used)} of the deposit`, saved);
      return saved;
    },
  });
}

// ---- Bills and expenses ---------------------------------------------------------------------

/**
 * Line items with property, unit, account, description and amount, for
 * bills and expenses. Returns a node with `.items` and `.total`.
 */
function expenseRows({ items = [], defaultAccount = ACC.repairs, onChange } = {}) {
  const accounts = expenseAccounts(store().all('accounts'));
  const list = h('div.tx-rows');
  const rows = [];
  const total = h('strong.num');
  const recalc = () => {
    total.textContent = money(rows.reduce((s, r) => s + r.amount.cents, 0));
    onChange?.();
  };
  const add = (it = {}) => {
    const prop = propertySelect({ value: it.propertyId || '', empty: 'No property', 'aria-label': 'Property' });
    let unit = unitSelect({ propertyId: it.propertyId, value: it.unitId || '', empty: 'All units', 'aria-label': 'Unit' });
    const unitCell = h('div.tx-cell-unit', unit);
    prop.addEventListener('change', () => {
      unit = unitSelect({ propertyId: prop.value, value: '', empty: 'All units', 'aria-label': 'Unit' });
      unitCell.replaceChildren(unit);
      row.unit = unit;
    });
    const acc = accountSelect({ value: it.accountId || defaultAccount, filter: (a) => accounts.some((x) => x.id === a.id), 'aria-label': 'Expense account' });
    const memo = textInput({ value: it.memo || '', placeholder: 'Description', 'aria-label': 'Description' });
    const amount = moneyInput({ cents: it.amount || 0, 'aria-label': 'Amount' });
    amount.addEventListener('input', recalc);
    const row = { prop, unit, acc, memo, amount };
    const node = h(
      'div.tx-row.tx-row-expense',
      prop,
      unitCell,
      acc,
      memo,
      amount,
      h('button.icon-btn', {
        type: 'button',
        'aria-label': 'Remove line',
        onClick: () => {
          if (rows.length === 1) return;
          rows.splice(rows.indexOf(row), 1);
          node.remove();
          recalc();
        },
      }, icon('x', 16)),
    );
    rows.push(row);
    list.append(node);
    recalc();
    return row;
  };
  (items.length ? items : [{}]).forEach(add);
  const wrap = h(
    'div.tx-lines',
    h('div.tx-row.tx-row-expense.tx-row-head', { 'aria-hidden': 'true' }, h('span', 'Property'), h('span', 'Unit'), h('span', 'Account'), h('span', 'Description'), h('span.r', 'Amount'), h('span')),
    list,
    h('div.row', h('button.btn.ghost.sm', { type: 'button', onClick: () => add({ propertyId: rows[rows.length - 1]?.prop.value, accountId: rows[rows.length - 1]?.acc.value }).memo.focus() }, icon('plus', 14), 'Add line')),
    h('div.tx-rows-total', h('span.grow', 'Total'), total),
  );
  Object.defineProperty(wrap, 'items', {
    get: () => rows.map((r) => ({ propertyId: r.prop.value || null, unitId: r.unit.value || null, accountId: r.acc.value, memo: r.memo.value.trim(), amount: r.amount.cents })).filter((r) => r.amount > 0),
  });
  Object.defineProperty(wrap, 'total', { get: () => rows.reduce((s, r) => s + r.amount.cents, 0) });
  wrap.setDefaultAccount = (id) => {
    for (const r of rows) if (!r.amount.cents && id) r.acc.value = id;
  };
  return wrap;
}

/** Create or edit a vendor bill. */
export function billDialog({ billId = null, vendorId = null, propertyId = null, unitId = null, workOrderId = null, items = null, memo: memoText = '' } = {}) {
  const old = billId ? store().get('transactions', billId) : null;
  const paid = old ? app.ledger().bill(old.id).paid : 0;
  const vendor = vendorSelect({ value: old?.vendorId || vendorId || '', required: true });
  const billDate = dateInput(old?.date, { required: true });
  const due = dateInput(old?.dueDate || addDays(old?.date || app.today(), 30));
  const ref = textInput({ value: old?.ref || '', placeholder: 'Vendor invoice number' });
  const memo = textInput({ value: old?.memo || memoText, placeholder: 'What the bill is for' });
  const vAcc = lookup.vendor(old?.vendorId || vendorId)?.accountId;
  const startItems = old
    ? old.lines.filter((l) => l.accountId !== ACC.ap).map((l) => ({ propertyId: l.propertyId, unitId: l.unitId, accountId: l.accountId, memo: l.memo, amount: l.amount }))
    : items || [{ propertyId, unitId, accountId: vAcc || ACC.repairs, memo: memoText }];
  const rows = expenseRows({ items: startItems, defaultAccount: vAcc || ACC.repairs });
  vendor.addEventListener('change', () => rows.setDefaultAccount(lookup.vendor(vendor.value)?.accountId));
  // A bill's own due date (not the usual 30 days) stays put when its date moves.
  if (old?.dueDate && old.dueDate !== addDays(old.date, 30)) due.dataset.touched = '1';
  billDate.addEventListener('change', () => {
    if (!due.dataset.touched) due.value = addDays(billDate.value, 30);
  });
  due.addEventListener('input', () => (due.dataset.touched = '1'));
  const woId = old?.workOrderId || workOrderId;
  return txDialog({
    title: old ? 'Edit bill' : 'Record a bill',
    size: 'wide',
    submitLabel: old ? 'Save changes' : 'Save bill',
    body: () =>
      h(
        'div.stack',
        paid ? h('div.notice.warning', icon('warning', 16), h('span', `${money(paid)} has been paid on this bill, so its amounts cannot change. Void the payments first to edit it.`)) : null,
        h('div.form-grid', field('Vendor', vendor, { required: true }), field('Reference', ref)),
        h('div.form-grid.three', field('Bill date', billDate, { required: true }), field('Due date', due), field('Memo', memo)),
        woId ? h('p.subtle', icon('wrench', 14), ` Linked to work order ${store().get('workOrders', woId)?.number || ''}`) : null,
        rows,
      ),
    submit: ({ error }) => {
      if (paid) return error('This bill has payments. Void them before changing it.'), false;
      if (!vendor.value) return error('Choose a vendor.'), false;
      if (!rows.items.length) return error('Enter an amount for at least one line.'), false;
      const tx = keep(old, buildBill({ vendorId: vendor.value, date: billDate.value, dueDate: due.value || billDate.value, items: rows.items, memo: memo.value, ref: ref.value, workOrderId: woId || undefined }));
      const saved = store().put('transactions', tx);
      if (woId && store().get('workOrders', woId)) store().patch('workOrders', woId, { billId: saved.id });
      toast(old ? 'Bill updated' : `Bill for ${money(rows.total)} recorded`, { action: { label: 'View', run: () => navigate(`/bills/${saved.id}`) } });
      return saved;
    },
  });
}

/** Pay one or more unpaid bills. */
export function payBillsDialog({ vendorId = null, billIds = null } = {}) {
  const today = app.today();
  const ledger = app.ledger();
  const all = store()
    .all('transactions')
    .filter((t) => t.kind === 'bill' && !t.voided && ledger.bill(t.id).balance > 0)
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const byId = new Map(all.map((b) => [b.id, b]));
  const vendorFilter = vendorSelect({ value: vendorId || '', empty: 'All vendors', 'aria-label': 'Vendor' });
  const when = dateInput(today, { required: true });
  const bank = bankSelect();
  const method = methodSelect('check');
  const ref = textInput({ placeholder: 'First check number' });
  const memo = textInput({ placeholder: 'Optional' });
  const listWrap = h('div');
  const totalEl = h('strong.num');
  const state = new Map(); // billId -> { checked, input }
  for (const b of all) state.set(b.id, { checked: billIds ? billIds.includes(b.id) : !!vendorId && b.vendorId === vendorId, input: moneyInput({ cents: ledger.bill(b.id).balance, 'aria-label': 'Amount to pay', cls: 'sm' }) });
  // Only the bills on screen are paid; ones a vendor filter hides stay
  // ticked for when they are shown again, but are not part of this payment.
  const visible = () => all.filter((b) => !vendorFilter.value || b.vendorId === vendorFilter.value);
  const recalc = () => (totalEl.textContent = money(visible().map((b) => state.get(b.id)).filter((s) => s.checked).reduce((t, s) => t + s.input.cents, 0)));
  const draw = () => {
    const shown = visible();
    if (!shown.length) {
      listWrap.replaceChildren(h('p.subtle.tx-apply-empty', 'There are no unpaid bills to pay.'));
      return recalc();
    }
    const allBox = h('input', { type: 'checkbox', 'aria-label': 'Select all bills', checked: shown.every((b) => state.get(b.id).checked) });
    allBox.addEventListener('change', () => {
      for (const b of shown) state.get(b.id).checked = allBox.checked;
      draw();
    });
    listWrap.replaceChildren(
      h(
        'div.table-wrap.tx-bills',
        h(
          'table.table',
          h('thead', h('tr', h('th.check-col', allBox), h('th', { scope: 'col' }, 'Vendor'), h('th', { scope: 'col' }, 'Due'), h('th', { scope: 'col' }, 'Reference'), h('th.r', { scope: 'col' }, 'Balance'), h('th.r', { scope: 'col' }, 'Pay'))),
          h(
            'tbody',
            shown.map((b) => {
              const s = state.get(b.id);
              const box = h('input', { type: 'checkbox', checked: s.checked, 'aria-label': `Pay bill ${b.ref || ''} from ${displayName(lookup.vendor(b.vendorId))}` });
              box.addEventListener('change', () => {
                s.checked = box.checked;
                recalc();
              });
              s.input.oninput = () => {
                if (s.input.cents && !s.checked) {
                  s.checked = true;
                  box.checked = true;
                }
                recalc();
              };
              const overdue = billStatus(b, ledger.bill(b.id), today) === 'overdue';
              return h(
                'tr',
                h('td.check-col', box),
                h('td', displayName(lookup.vendor(b.vendorId)), b.memo ? h('div.sub', b.memo) : null),
                h('td', h(overdue ? 'span.owed' : 'span', fmtDate(b.dueDate))),
                h('td', b.ref || ''),
                h('td.r', h('span.num', money(ledger.bill(b.id).balance))),
                h('td.r.tx-apply-cell', s.input),
              );
            }),
          ),
        ),
      ),
    );
    recalc();
  };
  vendorFilter.addEventListener('change', draw);
  draw();
  return txDialog({
    title: 'Pay bills',
    size: 'wide',
    submitLabel: 'Record payments',
    body: () => h('div.stack', field('Show bills from', vendorFilter), listWrap, h('div.tx-rows-total', h('span.grow', 'Total to pay'), totalEl), h('div.form-grid.three', field('Payment date', when, { required: true }), field('Pay from', bank), field('Method', method)), h('div.form-grid', field('Check or reference', ref, { hint: 'Numbers count up for each vendor paid' }), field('Memo', memo))),
    submit: ({ error }) => {
      const selections = visible()
        .map((b) => [b.id, state.get(b.id)])
        .filter(([, s]) => s.checked)
        .map(([billId, s]) => ({ billId, amount: s.input.cents }));
      if (!selections.some((s) => s.amount > 0)) return error('Select at least one bill to pay.'), false;
      for (const s of selections) if (s.amount > ledger.bill(s.billId).balance) return error('A payment is larger than what is owed on its bill.'), false;
      const groups = groupByVendor(selections, byId);
      const startNo = /^\d+$/.test(ref.value.trim()) ? Number(ref.value.trim()) : null;
      const saved = [];
      let i = 0;
      for (const [vid, allocations] of groups) {
        const r = startNo !== null ? String(startNo + i) : ref.value.trim();
        i++;
        saved.push(store().put('transactions', buildBillPayment({ vendorId: vid, date: when.value, bankAccountId: bank.value, method: method.value, ref: r, memo: memo.value, allocations, bills: byId, previous: [...new Set(allocations.flatMap((x) => ledger.bill(x.billId).payments))] })));
      }
      const total = saved.reduce((s, t) => s + t.allocations.reduce((a, x) => a + x.amount, 0), 0);
      toast(`Paid ${money(total)} to ${saved.length} ${saved.length === 1 ? 'vendor' : 'vendors'}`);
      return saved.length === 1 ? saved[0] : saved;
    },
  });
}

/** Pay an expense directly from a bank account. */
export function expenseDialog({ txId = null, vendorId = null, propertyId = null } = {}) {
  const old = txId ? store().get('transactions', txId) : null;
  const vendor = vendorSelect({ value: old?.vendorId || vendorId || '', empty: 'No vendor (enter a payee)' });
  const payee = textInput({ value: old?.payee || '', placeholder: 'e.g. Hardware store' });
  const when = dateInput(old?.date, { required: true });
  const bank = bankSelect({ value: old?.bankAccountId || '' });
  const method = methodSelect(old?.method || 'card');
  const ref = textInput({ value: old?.ref || '' });
  const memo = textInput({ value: old?.memo || '' });
  const vAcc = lookup.vendor(old?.vendorId || vendorId)?.accountId;
  const rows = expenseRows({
    items: old ? old.lines.filter((l) => l.amount > 0).map((l) => ({ propertyId: l.propertyId, unitId: l.unitId, accountId: l.accountId, memo: l.memo, amount: l.amount })) : [{ propertyId, accountId: vAcc || ACC.repairs }],
    defaultAccount: vAcc || ACC.repairs,
  });
  vendor.addEventListener('change', () => rows.setDefaultAccount(lookup.vendor(vendor.value)?.accountId));
  return txDialog({
    title: old ? 'Edit expense' : 'Record an expense',
    size: 'wide',
    submitLabel: old ? 'Save changes' : 'Save expense',
    body: () => h('div.stack', h('p.subtle', 'For money already paid without a bill, such as a card purchase.'), h('div.form-grid', field('Vendor', vendor), field('Payee', payee)), h('div.form-grid.three', field('Date', when, { required: true }), field('Paid from', bank), field('Method', method)), h('div.form-grid', field('Reference', ref), field('Memo', memo)), rows),
    submit: ({ error }) => {
      if (!vendor.value && !payee.value.trim()) return error('Choose a vendor or enter a payee.'), false;
      if (!rows.items.length) return error('Enter an amount for at least one line.'), false;
      const saved = store().put('transactions', keep(old, buildExpense({ vendorId: vendor.value || null, payee: payee.value.trim() || displayName(lookup.vendor(vendor.value)), date: when.value, bankAccountId: bank.value, method: method.value, items: rows.items, memo: memo.value, ref: ref.value })));
      savedToast(old ? 'Expense updated' : `Expense of ${money(rows.total)} recorded`, saved);
      return saved;
    },
  });
}

/** Move money between two bank accounts. */
export function transferDialog({ txId = null } = {}) {
  const old = txId ? store().get('transactions', txId) : null;
  const fromBank = bankSelect({ value: old?.lines?.find((l) => l.amount < 0)?.accountId || '' });
  const toBank = bankSelect({ value: old?.lines?.find((l) => l.amount > 0)?.accountId || app.settings().accounting?.depositBankId || '' });
  const amount = moneyInput({ cents: old ? txTotal(old) : 0, required: true });
  const when = dateInput(old?.date, { required: true });
  const prop = propertySelect({ value: old?.propertyId || '', empty: 'No property' });
  const memo = textInput({ value: old?.memo || '' });
  return txDialog({
    title: old ? 'Edit transfer' : 'Transfer between accounts',
    submitLabel: old ? 'Save changes' : 'Save transfer',
    body: () => h('div.stack', h('div.form-grid', field('From', fromBank), field('To', toBank)), h('div.form-grid', field('Amount', amount, { required: true }), field('Date', when, { required: true })), h('div.form-grid', field('Property', prop), field('Memo', memo))),
    submit: ({ error }) => {
      if (fromBank.value === toBank.value) return error('Choose two different accounts.'), false;
      if (!(amount.cents > 0)) return error('Enter an amount greater than zero.'), false;
      const saved = store().put('transactions', keep(old, buildTransfer({ date: when.value, fromAccountId: fromBank.value, toAccountId: toBank.value, amount: amount.cents, propertyId: prop.value || null, memo: memo.value })));
      savedToast(old ? 'Transfer updated' : `Transferred ${money(amount.cents)}`, saved);
      return saved;
    },
  });
}

/** Balanced general journal entry. */
export function journalDialog({ txId = null } = {}) {
  const old = txId ? store().get('transactions', txId) : null;
  const when = dateInput(old?.date, { required: true });
  const memo = textInput({ value: old?.memo || '', required: true, placeholder: 'What this entry records' });
  const ref = textInput({ value: old?.ref || '' });
  const list = h('div.tx-rows');
  const rows = [];
  const diffEl = h('div.tx-journal-diff', { 'aria-live': 'polite' });
  const totals = () => rows.map((r) => ({ debit: r.debit.cents, credit: r.credit.cents }));
  const recalc = () => {
    const d = journalDifference(totals());
    const debits = totals().reduce((s, r) => s + r.debit, 0);
    const credits = totals().reduce((s, r) => s + r.credit, 0);
    diffEl.className = `tx-journal-diff${d ? ' bad' : ''}`;
    diffEl.replaceChildren(h('span.grow', d ? `Out of balance by ${money(Math.abs(d))}` : 'Balanced'), h('span.num', `Debits ${money(debits)}`), h('span.num', `Credits ${money(credits)}`));
  };
  const add = (l = {}) => {
    const acc = accountSelect({ value: l.accountId || '', empty: 'Account', 'aria-label': 'Account' });
    const prop = propertySelect({ value: l.propertyId || '', empty: 'No property', 'aria-label': 'Property' });
    const memoIn = textInput({ value: l.memo || '', placeholder: 'Description', 'aria-label': 'Description' });
    // Named in the field too: on phones the column headings are hidden.
    const debit = moneyInput({ cents: l.amount > 0 ? l.amount : 0, 'aria-label': 'Debit', placeholder: 'Debit' });
    const credit = moneyInput({ cents: l.amount < 0 ? -l.amount : 0, 'aria-label': 'Credit', placeholder: 'Credit' });
    debit.addEventListener('input', () => (debit.cents && (credit.value = ''), recalc()));
    credit.addEventListener('input', () => (credit.cents && (debit.value = ''), recalc()));
    // Links the editor does not show (lease, unit, what a receivable is for)
    // ride along so editing an entry keeps them.
    const row = { acc, prop, memo: memoIn, debit, credit, links: { leaseId: l.leaseId, unitId: l.unitId, forAccountId: l.forAccountId, vendorId: l.vendorId, ownerId: l.ownerId } };
    const node = h('div.tx-row.tx-row-journal', acc, prop, memoIn, debit, credit, h('button.icon-btn', { type: 'button', 'aria-label': 'Remove line', onClick: () => (rows.length > 2 ? (rows.splice(rows.indexOf(row), 1), node.remove(), recalc()) : null) }, icon('x', 16)));
    rows.push(row);
    list.append(node);
    recalc();
    return row;
  };
  (old?.lines?.length ? old.lines : [{}, {}]).forEach(add);
  return txDialog({
    title: old ? 'Edit journal entry' : 'Journal entry',
    size: 'wide',
    submitLabel: old ? 'Save changes' : 'Save entry',
    body: () =>
      h(
        'div.stack',
        h('div.form-grid.three', field('Date', when, { required: true }), field('Memo', memo, { required: true }), field('Reference', ref)),
        h('div.tx-lines', h('div.tx-row.tx-row-journal.tx-row-head', { 'aria-hidden': 'true' }, h('span', 'Account'), h('span', 'Property'), h('span', 'Description'), h('span.r', 'Debit'), h('span.r', 'Credit'), h('span')), list, h('div.row', h('button.btn.ghost.sm', { type: 'button', onClick: () => add().acc.focus() }, icon('plus', 14), 'Add line')), diffEl),
      ),
    submit: ({ error }) => {
      const lines = rows.filter((r) => r.acc.value && (r.debit.cents || r.credit.cents)).map((r) => ({ ...r.links, accountId: r.acc.value, propertyId: r.prop.value || null, memo: r.memo.value.trim(), debit: r.debit.cents, credit: r.credit.cents }));
      if (lines.length < 2) return error('Enter at least two lines with an account and an amount.'), false;
      if (journalDifference(lines)) return error('Debits and credits must be equal.'), false;
      const tx = keep(old, buildJournal({ date: when.value, lines, memo: memo.value, ref: ref.value }));
      // An entry made for a lease (a deposit moved to a renewal) stays linked to it.
      if (old?.leaseId && tx.lines.some((l) => l.leaseId === old.leaseId)) Object.assign(tx, { leaseId: old.leaseId, propertyId: old.propertyId ?? null });
      const problem = editProblem(old, tx);
      if (problem) return error(problem), false;
      const saved = store().put('transactions', tx);
      savedToast(old ? 'Journal entry updated' : 'Journal entry saved', saved);
      return saved;
    },
  });
}

/** Owner contribution (money in) or distribution (money out). */
export function ownerTransactionDialog({ kind = 'distribution', ownerId = null, propertyId = null, txId = null } = {}) {
  const old = txId ? store().get('transactions', txId) : null;
  let k = old?.kind || kind;
  const owners = store().all('owners').slice().sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const owner = select({ value: old?.ownerId || ownerId || owners[0]?.id || '', options: owners.map((o) => ({ value: o.id, label: displayName(o) })), required: true });
  const propOptions = () => {
    const owned = store().all('properties').filter((p) => (p.owners || []).some((o) => o.ownerId === owner.value));
    return owned.length ? owned : store().all('properties');
  };
  let prop = select({ value: old?.propertyId || propertyId || '', options: propOptions().map((p) => ({ value: p.id, label: p.name })) });
  const propCell = h('div', field('Property', prop));
  owner.addEventListener('change', () => {
    const next = select({ value: '', options: propOptions().map((p) => ({ value: p.id, label: p.name })) });
    propCell.replaceChildren(field('Property', next));
    prop = next;
  });
  const amount = moneyInput({ cents: old ? txTotal(old) : 0, required: true });
  const when = dateInput(old?.date, { required: true });
  const bank = bankSelect({ value: old?.bankAccountId || '' });
  const method = methodSelect(old?.method || 'ach');
  const ref = textInput({ value: old?.ref || '' });
  const memo = textInput({ value: old?.memo || '' });
  const kindCtl = segmented({
    label: 'Type',
    value: k,
    items: [
      { value: 'distribution', label: 'Distribution (pay owner)' },
      { value: 'contribution', label: 'Contribution (owner pays in)' },
    ],
    onChange: (v) => (k = v),
  });
  return txDialog({
    title: old ? 'Edit owner transaction' : 'Owner contribution or distribution',
    submitLabel: old ? 'Save changes' : 'Save',
    body: () => h('div.stack', owners.length ? null : h('div.notice.warning', icon('warning', 16), h('span', 'Add a rental owner first.')), h('div.field', h('span.field-label', 'Type'), kindCtl), h('div.form-grid', field('Owner', owner, { required: true }), propCell), h('div.form-grid.three', field('Amount', amount, { required: true }), field('Date', when, { required: true }), field('Bank account', bank)), h('div.form-grid.three', field('Method', method), field('Reference', ref), field('Memo', memo))),
    submit: ({ error }) => {
      if (!owner.value) return error('Choose an owner.'), false;
      if (!(amount.cents > 0)) return error('Enter an amount greater than zero.'), false;
      const saved = store().put('transactions', keep(old, buildOwnerTransaction({ kind: k, ownerId: owner.value, propertyId: prop.value || null, date: when.value, amount: amount.cents, bankAccountId: bank.value, method: method.value, memo: memo.value || (k === 'contribution' ? 'Owner contribution' : 'Owner distribution'), ref: ref.value })));
      savedToast(`${k === 'contribution' ? 'Contribution' : 'Distribution'} of ${money(amount.cents)} recorded`, saved);
      return saved;
    },
  });
}

/** Change only the date, reference and memo (for kinds without their own editor). */
function detailsDialog(tx) {
  const when = dateInput(tx.date, { required: true });
  const ref = textInput({ value: tx.ref || '' });
  const memo = textarea({ value: tx.memo || '', rows: 2 });
  return txDialog({
    title: `Edit ${kindLabel(tx.kind).toLowerCase()}`,
    body: () => h('div.stack', h('p.subtle', 'Amounts on this transaction cannot be edited. To change them, void it and record it again.'), h('div.form-grid', field('Date', when, { required: true }), field('Reference', ref)), field('Memo', memo)),
    submit: () => store().patch('transactions', tx.id, { date: when.value, ref: ref.value.trim(), memo: memo.value.trim() }),
  });
}

// ---- Edit, void, print ------------------------------------------------------------------------

/** Open the right editor for any transaction. */
/** The bank account whose finished reconciliation includes this transaction, if any. */
function reconciledIn(tx) {
  const banks = new Set(store().all('accounts').filter((a) => a.bank).map((a) => a.id));
  for (const id of new Set((tx.lines || []).map((l) => l.accountId).filter((a) => banks.has(a)))) if (reconciledIds(store(), id).has(tx.id)) return lookup.account(id);
  return null;
}

function reconciledNotice(bank) {
  toast(`This transaction is part of a finished reconciliation of ${bank?.name || 'a bank account'}. Undo that reconciliation before changing it.`, { type: 'error' });
}

export function editTransaction(txId) {
  const tx = store().get('transactions', txId);
  if (!tx) return Promise.resolve(null);
  if (tx.voided) {
    toast('Restore this transaction before editing it.', { type: 'error' });
    return Promise.resolve(null);
  }
  const bank = reconciledIn(tx);
  if (bank) {
    reconciledNotice(bank);
    return Promise.resolve(null);
  }
  switch (tx.kind) {
    case 'payment':
      return receivePaymentDialog({ txId });
    case 'charge':
      return chargeDialog({ txId });
    case 'credit':
      return creditDialog({ txId });
    case 'refund':
      return refundDialog({ txId });
    case 'apply-deposit':
      return applyDepositDialog({ txId });
    case 'bill':
      return billDialog({ billId: txId });
    case 'expense':
      return expenseDialog({ txId });
    case 'transfer':
      return transferDialog({ txId });
    case 'journal':
      return journalDialog({ txId });
    case 'contribution':
    case 'distribution':
      return ownerTransactionDialog({ txId });
    default:
      return detailsDialog(tx);
  }
}

/** Void (or restore) a transaction. A voided transaction no longer affects any balance. */
export async function voidTransaction(txId) {
  const tx = store().get('transactions', txId);
  if (!tx) return null;
  if (tx.voided) return restoreTransaction(tx);
  const bank = reconciledIn(tx);
  if (bank) {
    reconciledNotice(bank);
    return null;
  }
  if (tx.kind === 'bill' && app.ledger().bill(tx.id).paid > 0) {
    await confirmDialog({ title: 'This bill has payments', message: 'Void the payments made on this bill first, then void the bill.', confirmLabel: 'OK', cancelLabel: 'Close' });
    return null;
  }
  // A payment whose prepaid rent or deposit was already used elsewhere.
  const problem = changeProblem(store().all('transactions'), { ...tx, voided: true }, { action: 'Voiding it' });
  if (problem) {
    await confirmDialog({ title: `This ${kindLabel(tx.kind).toLowerCase()} can't be voided yet`, message: problem, confirmLabel: 'OK', cancelLabel: 'Close' });
    return null;
  }
  const ok = await confirmDialog({
    title: `Void this ${kindLabel(tx.kind).toLowerCase()}?`,
    message: `${money(txTotal(tx))} on ${fmtDate(tx.date)}. It stays in the history marked as void but no longer affects any balance.`,
    confirmLabel: 'Void',
    danger: true,
  });
  if (!ok) return null;
  const saved = store().patch('transactions', txId, { voided: true, voidedAt: new Date().toISOString() });
  toast(`${kindLabel(tx.kind)} voided`, { action: { label: 'Undo', run: () => restoreTransaction(store().get('transactions', txId)) } });
  return saved;
}

/** Undo a void, unless something recorded since makes that impossible. */
function restoreTransaction(tx) {
  const problem = restoreProblem(store().all('transactions'), tx);
  if (problem) {
    toast(problem, { type: 'error' });
    return null;
  }
  const saved = store().patch('transactions', tx.id, { voided: false, voidedAt: null });
  toast(`${kindLabel(tx.kind)} restored`);
  return saved;
}

/** The receipt as a node (also used for the on-screen preview). */
export function receiptNode(tx) {
  const s = app.settings();
  const lease = lookup.lease(tx.leaseId);
  const property = lookup.property(tx.propertyId || lease?.propertyId);
  const applied = (tx.lines || []).filter((l) => l.accountId === ACC.ar && l.amount < 0);
  const held = -(tx.lines || []).filter((l) => l.accountId === ACC.prepaid).reduce((a, l) => a + l.amount, 0);
  const balance = lease ? app.ledger().lease(lease.id).balance : 0;
  return h(
    'article.receipt',
    h(
      'header.receipt-head',
      h('div', h('div.receipt-company', s.company?.name || 'Property Management'), s.company?.address ? h('div.receipt-small', { style: { whiteSpace: 'pre-line' } }, s.company.address) : null, [s.company?.phone, s.company?.email].filter(Boolean).length ? h('div.receipt-small', [s.company.phone, s.company.email].filter(Boolean).join(' · ')) : null),
      h('div.receipt-title', h('div', 'Payment receipt'), h('div.receipt-small', `Receipt ${tx.ref ? 'for reference ' + tx.ref : tx.id.slice(-8).toUpperCase()}`)),
    ),
    h(
      'dl.receipt-meta',
      h('dt', 'Received from'),
      h('dd', tx.payer || lookup.tenantNames(lease) || ''),
      h('dt', 'Property'),
      h('dd', lease ? lookup.leaseLabel(lease) : property?.name || ''),
      property?.address ? [h('dt', 'Address'), h('dd', formatAddress(property.address))] : null,
      h('dt', 'Date'),
      h('dd', fmtDate(tx.date, { month: 'long', day: 'numeric', year: 'numeric' })),
      h('dt', 'Payment method'),
      h('dd', [methodLabel(tx.method), tx.ref ? `#${tx.ref}` : ''].filter(Boolean).join(' ') || 'Not recorded'),
    ),
    h('div.receipt-amount', h('span', 'Amount received'), h('strong', money(txTotal(tx)))),
    applied.length || held
      ? h(
          'table.receipt-lines',
          h('thead', h('tr', h('th', 'Applied to'), h('th.r', 'Amount'))),
          h(
            'tbody',
            applied.map((l) => h('tr', h('td', accName(l.forAccountId)), h('td.r', money(-l.amount)))),
            held ? h('tr', h('td', 'Held as prepayment'), h('td.r', money(held))) : null,
          ),
        )
      : null,
    tx.memo ? h('p.receipt-memo', tx.memo) : null,
    lease ? h('p.receipt-balance', balance > 0 ? `Balance remaining on the account: ${money(balance)}` : balance < 0 ? `Credit on the account: ${money(-balance)}` : 'The account is paid in full.') : null,
    s.receipts?.footer ? h('footer.receipt-foot', s.receipts.footer) : null,
  );
}

/** Print a payment receipt (or save it as PDF from the print dialog). */
export function printReceipt(txId) {
  const tx = store().get('transactions', txId);
  if (!tx) return;
  printNode(receiptNode(tx), `Receipt ${fmtDate(tx.date)}`);
}

/** Print any node through the shared #print-root container. */
export function printNode(node, title) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = h('div#print-root', { 'aria-hidden': 'true' });
    document.body.append(root);
  }
  root.replaceChildren(node);
  document.body.classList.add('print-sheet');
  const prev = document.title;
  if (title) document.title = title;
  const cleanup = () => {
    document.title = prev;
    // Remove the container, so a later print of a report (or the browser's
    // own print) is not hidden behind an empty sheet.
    root.remove();
    document.body.classList.remove('print-sheet');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  try {
    window.print();
  } catch {
    cleanup();
  }
}

/** Plain text of a receipt for email. */
export function receiptText(tx) {
  const lease = lookup.lease(tx.leaseId);
  const lines = [
    `Hello ${lookup.tenants(lease?.tenantIds || [])[0]?.firstName || ''},`.replace(' ,', ','),
    '',
    `We received your payment of ${money(txTotal(tx))} on ${fmtDate(tx.date)}${tx.method ? ` by ${methodLabel(tx.method).toLowerCase()}` : ''}${tx.ref ? ` (reference ${tx.ref})` : ''}.`,
  ];
  for (const l of (tx.lines || []).filter((x) => x.accountId === ACC.ar && x.amount < 0)) lines.push(`  ${accName(l.forAccountId)}: ${money(-l.amount)}`);
  if (lease) {
    const bal = app.ledger().lease(lease.id).balance;
    lines.push('', bal > 0 ? `Remaining balance: ${money(bal)}` : bal < 0 ? `Credit on your account: ${money(-bal)}` : 'Your account is paid in full.');
  }
  const s = app.settings();
  if (s.receipts?.footer) lines.push('', s.receipts.footer);
  if (s.company?.name) lines.push('', s.company.name);
  return lines.join('\n');
}

/** Email a receipt through the compose dialog. */
export async function emailReceipt(txId) {
  const tx = store().get('transactions', txId);
  if (!tx) return;
  const lease = lookup.lease(tx.leaseId);
  const to = lookup.tenants(lease?.tenantIds || []).filter((t) => t.emails?.[0]).map((t) => ({ name: tenantName(t), email: t.emails[0], tenantId: t.id }));
  try {
    const m = await import('../compose.js');
    return m.composeEmail({ to, subject: `Payment receipt, ${fmtDate(tx.date)}`, body: receiptText(tx), related: { leaseId: lease?.id, propertyId: lease?.propertyId } });
  } catch (err) {
    console.error(err);
    toast('Email is not available right now. Print the receipt instead.', { type: 'error' });
  }
}

export { centsToInput, accountLabel };
