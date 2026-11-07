/**
 * Money movements: payments on bills, trust deposits and withdrawals, and
 * bank accounts. Every movement writes transactions so account balances and
 * the trust ledger are always derived from the same records.
 */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, meId } from '../app.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { field, textInput, textarea, select, moneyInput, checkbox, segmented } from '../ui/components.js';
import { matterPicker, contactPicker } from './common.js';
import { billBalance, billTotals, checkTrustWithdrawal, matterAccountBalance } from '../core/finance.js';
import { formatMoney } from '../core/money.js';
import { today } from '../core/dates.js';
import { PAYMENT_METHODS } from '../core/settings.js';
import { contactName } from '../core/format.js';
import { where } from '../core/derive.js';

const store = () => app.store;

function accountOptions(type) {
  return app.store
    .all('accounts')
    .filter((a) => a.type === type)
    .map((a) => ({ value: a.id, label: a.name }));
}

function needAccount(type) {
  if (lookup.defaultAccount(type)) return true;
  toast(`Add a ${type} account first (Accounts, New account).`, { type: 'error', duration: 7000 });
  return false;
}

/**
 * Undo for deleted transactions. Putting back a trust withdrawal must not
 * overdraw the matter if its funds were used in the meantime.
 */
function restoreTransactions(txs, restoreFirst = () => {}) {
  const trustIds = new Set(accountOptions('trust').map((o) => o.value));
  const all = store().all('transactions');
  for (const t of txs) {
    if (t.type !== 'withdrawal' || !trustIds.has(t.accountId) || !t.matterId) continue;
    const check = checkTrustWithdrawal({ matterId: t.matterId, accountId: t.accountId, amountCents: t.amountCents, transactions: all, date: t.date });
    if (!check.ok) {
      toast(`This cannot be undone: the matter now has only ${formatMoney(check.available)} in trust.`, { type: 'error', duration: 7000 });
      return;
    }
  }
  restoreFirst();
  for (const t of txs) store().restore('transactions', t);
}

// ---- Payments ----------------------------------------------------------------------

/**
 * Record a payment on a bill. Paying from trust moves the money out of the
 * matter's trust funds (checked against the available balance) and into the
 * operating account.
 */
export function openPaymentDialog({ billId = null, matterId = null, method: initialMethod = 'check' } = {}) {
  // Each bill's own payments, so listing open bills is not bills times payments.
  const balanceOf = (b) => billBalance(b, where(store(), 'payments', 'billId', b.id));
  const open = store()
    .all('bills')
    .filter((b) => (!matterId || b.matterId === matterId) && balanceOf(b) > 0);
  if (!open.length) {
    toast(matterId ? 'This matter has no unpaid bills.' : 'There are no unpaid bills.', { type: 'info' });
    return Promise.resolve(null);
  }
  // Only bills with a balance are offered; a settled billId falls back to the first.
  let bill = open.find((b) => b.id === billId) || open[0];
  const billSel = select({
    name: 'billId',
    value: bill.id,
    options: open.map((b) => ({ value: b.id, label: `Bill #${b.number} · ${lookup.contactName(b.clientId)} · ${formatMoney(balanceOf(b))} due` })),
  });
  const amount = moneyInput({ name: 'amount', cents: balanceOf(bill) });
  const method = select({ name: 'method', value: initialMethod, options: PAYMENT_METHODS.map((m) => ({ value: m.id, label: m.label })) });
  const trustAcct = select({ name: 'trustAccountId', value: lookup.defaultAccount('trust')?.id || '', options: accountOptions('trust') });
  const opAcct = select({ name: 'accountId', value: lookup.defaultAccount('operating')?.id || '', options: [{ value: '', label: 'Not tracked' }, ...accountOptions('operating')] });
  const info = h('div.notice.info', { hidden: true });
  const trustField = field('Pay from trust account', trustAcct);
  const depositField = field('Deposit into', opAcct);
  function sync() {
    bill = store().get('bills', billSel.value);
    const fromTrust = method.value === 'trust';
    trustField.hidden = !fromTrust;
    info.hidden = !fromTrust;
    if (fromTrust) {
      const avail = matterAccountBalance(bill.matterId, trustAcct.value, store().all('transactions'));
      info.replaceChildren(icon('vault', 16), h('span', `Trust funds available for this matter: `, h('strong', formatMoney(avail))));
    }
  }
  billSel.addEventListener('change', () => {
    sync();
    amount.cents = billBalance(bill, store().all('payments'));
  });
  method.addEventListener('change', sync);
  trustAcct.addEventListener('change', sync);
  sync();
  return formDialog({
    title: 'Record payment',
    body: h(
      'div.stack',
      field('Bill', billSel, { required: true }),
      h('div.grid-2', field('Amount', amount, { required: true }), field('Date', textInput({ name: 'date', type: 'date', value: today() }), { required: true })),
      h('div.grid-2', field('Method', method), field('Reference', textInput({ name: 'reference', placeholder: 'Check or confirmation number' }))),
      trustField,
      info,
      depositField,
      field('Note', textInput({ name: 'note' })),
    ),
    submitLabel: 'Record payment',
    onSubmit: (fd) => {
      // The bill may have been paid, voided, or deleted since the dialog opened.
      bill = store().get('bills', billSel.value);
      if (!bill) {
        toast('This bill was deleted.', { type: 'error' });
        return false;
      }
      const cents = amount.cents;
      const balance = billBalance(bill, store().all('payments'));
      if (cents <= 0 || cents > balance) {
        amount.setAttribute('aria-invalid', 'true');
        toast(cents > balance ? `The payment is more than the ${formatMoney(balance)} owed on this bill.` : 'Enter an amount greater than zero.', { type: 'error' });
        return false;
      }
      const fromTrust = fd.get('method') === 'trust';
      if (fromTrust) {
        if (!needAccount('trust')) return false;
        const check = checkTrustWithdrawal({ matterId: bill.matterId, accountId: fd.get('trustAccountId'), amountCents: cents, transactions: store().all('transactions'), date: fd.get('date') });
        if (!check.ok) {
          toast(`${check.reason} Available: ${formatMoney(check.available)}.`, { type: 'error', duration: 7000 });
          return false;
        }
      }
      const date = fd.get('date');
      const pay = store().put('payments', {
        date,
        billId: bill.id,
        matterId: bill.matterId,
        contactId: bill.clientId,
        amountCents: cents,
        method: fd.get('method'),
        reference: String(fd.get('reference') || '').trim(),
        note: String(fd.get('note') || '').trim(),
        accountId: fromTrust ? fd.get('trustAccountId') : fd.get('accountId') || null,
        recordedBy: meId(),
      });
      const txs = [];
      const desc = `Payment for bill #${bill.number}`;
      if (fromTrust)
        txs.push({
          accountId: fd.get('trustAccountId'),
          type: 'withdrawal',
          date,
          amountCents: cents,
          matterId: bill.matterId,
          contactId: bill.clientId,
          description: desc,
          paymentId: pay.id,
          billId: bill.id,
          reference: pay.reference,
        });
      if (fd.get('accountId'))
        txs.push({
          accountId: fd.get('accountId'),
          type: 'deposit',
          date,
          amountCents: cents,
          matterId: bill.matterId,
          contactId: bill.clientId,
          description: desc,
          paymentId: pay.id,
          billId: bill.id,
          reference: pay.reference,
        });
      if (txs.length) store().bulkPut('transactions', txs);
      const left = balance - cents;
      toast(left > 0 ? `Payment recorded. ${formatMoney(left)} still owed.` : `Bill #${bill.number} is paid in full.`);
      return pay;
    },
  });
}

/** Delete a payment and the account transactions it created. */
export async function deletePayment(pay) {
  const ok = await confirmDialog({
    title: 'Delete payment?',
    message: `This removes the ${formatMoney(pay.amountCents)} payment and its account transactions. The bill becomes unpaid by that amount.`,
    confirmLabel: 'Delete payment',
    danger: true,
  });
  if (!ok) return false;
  const linked = store()
    .all('transactions')
    .filter((t) => t.paymentId === pay.id);
  store().remove('payments', pay.id);
  store().bulkRemove(
    'transactions',
    linked.map((t) => t.id),
  );
  toast('Payment deleted', {
    action: {
      label: 'Undo',
      run: () => {
        // Another payment (or a void) may have settled the bill meanwhile.
        const bill = pay.billId ? store().get('bills', pay.billId) : null;
        if (pay.billId && (!bill || billBalance(bill, store().all('payments')) < Number(pay.amountCents))) {
          toast('This cannot be undone: the bill no longer owes that amount.', { type: 'error', duration: 7000 });
          return;
        }
        restoreTransactions(linked, () => store().restore('payments', pay));
      },
    },
  });
  return true;
}

// ---- Trust ------------------------------------------------------------------------------

/**
 * Trust money in and out. type: 'deposit' | 'withdrawal' | 'transfer'
 * (transfer moves earned funds from trust to the operating account).
 */
export function openTrustDialog({ type = 'deposit', matterId = '', accountId = '' } = {}) {
  if (!needAccount('trust')) return Promise.resolve(null);
  let kind = type;
  const acct = select({ name: 'accountId', value: accountId || lookup.defaultAccount('trust')?.id, options: accountOptions('trust') });
  const opAcct = select({ name: 'opAccountId', value: lookup.defaultAccount('operating')?.id || '', options: [{ value: '', label: 'Not tracked' }, ...accountOptions('operating')] });
  const matter = matterPicker({ value: matterId, required: true, onChange: () => syncAvail() });
  const avail = h('div.notice.info');
  const amount = moneyInput({ name: 'amount' });
  const payee = textInput({ name: 'payee', placeholder: 'Who receives the funds' });
  const contact = contactPicker({ name: 'contactId', value: lookup.matter(matterId)?.clientId || '', label: 'Received from' });
  const method = select({ name: 'method', value: 'bank', options: PAYMENT_METHODS.filter((m) => m.id !== 'trust').map((m) => ({ value: m.id, label: m.label })) });
  const contactField = field('Received from', contact);
  const methodField = field('Method', method);
  const payeeField = field('Paid to', payee);
  const opField = field('Into operating account', opAcct);
  function syncAvail() {
    const m = lookup.matter(matter.value);
    if (m && !contact.value && m.clientId) contact.value = m.clientId;
    const bal = m ? matterAccountBalance(m.id, acct.value, store().all('transactions')) : 0;
    avail.replaceChildren(icon('vault', 16), h('span', m ? ['Trust funds held for this matter: ', h('strong', formatMoney(bal))] : 'Choose a matter to see its trust balance.'));
  }
  function sync() {
    contactField.hidden = kind !== 'deposit';
    methodField.hidden = kind !== 'deposit';
    payeeField.hidden = kind !== 'withdrawal';
    opField.hidden = kind !== 'transfer';
    syncAvail();
  }
  acct.addEventListener('change', syncAvail);
  sync();
  const titles = { deposit: 'Trust deposit', withdrawal: 'Trust withdrawal', transfer: 'Transfer trust to operating' };
  return formDialog({
    title: 'Trust transaction',
    body: h(
      'div.stack',
      segmented({
        label: 'Transaction type',
        value: kind,
        items: [
          { value: 'deposit', label: 'Deposit' },
          { value: 'withdrawal', label: 'Withdrawal' },
          { value: 'transfer', label: 'To operating' },
        ],
        onChange: (v) => {
          kind = v;
          sync();
        },
      }),
      h('div.grid-2', field('Trust account', acct, { required: true }), field('Date', textInput({ name: 'date', type: 'date', value: today() }), { required: true })),
      field('Matter', matter, { required: true }),
      avail,
      h('div.grid-2', field('Amount', amount, { required: true }), field('Reference', textInput({ name: 'reference', placeholder: 'Check or wire number' }))),
      contactField,
      methodField,
      payeeField,
      opField,
      field('Description', textarea({ name: 'description', rows: 2 })),
    ),
    submitLabel: 'Record transaction',
    onSubmit: (fd) => {
      const m = lookup.matter(matter.value);
      if (!m) {
        matter.input.setAttribute('aria-invalid', 'true');
        matter.input.focus();
        return false;
      }
      const cents = amount.cents;
      if (cents <= 0) {
        amount.setAttribute('aria-invalid', 'true');
        amount.focus();
        return false;
      }
      const accountId = fd.get('accountId');
      if (kind !== 'deposit') {
        const check = checkTrustWithdrawal({ matterId: m.id, accountId, amountCents: cents, transactions: store().all('transactions'), date: fd.get('date') });
        if (!check.ok) {
          toast(`${check.reason} Available: ${formatMoney(check.available)}.`, { type: 'error', duration: 7000 });
          return false;
        }
      }
      const date = fd.get('date');
      const reference = String(fd.get('reference') || '').trim();
      const base = { date, matterId: m.id, reference, recordedBy: meId() };
      const description = String(fd.get('description') || '').trim();
      if (kind === 'deposit') {
        store().put('transactions', {
          ...base,
          accountId,
          type: 'deposit',
          amountCents: cents,
          contactId: contact.value || m.clientId || null,
          method: fd.get('method'),
          description: description || 'Trust deposit',
        });
      } else if (kind === 'withdrawal') {
        store().put('transactions', {
          ...base,
          accountId,
          type: 'withdrawal',
          amountCents: cents,
          contactId: m.clientId || null,
          payee: String(fd.get('payee') || '').trim(),
          description: description || 'Trust withdrawal',
        });
      } else {
        const link = `tr-${Date.now().toString(36)}`;
        const txs = [{ ...base, accountId, type: 'withdrawal', amountCents: cents, contactId: m.clientId || null, description: description || 'Transfer to operating', transferId: link }];
        if (fd.get('opAccountId'))
          txs.push({
            ...base,
            accountId: fd.get('opAccountId'),
            type: 'deposit',
            amountCents: cents,
            contactId: m.clientId || null,
            description: description || 'Transfer from trust',
            transferId: link,
          });
        store().bulkPut('transactions', txs);
      }
      toast(`${titles[kind]} of ${formatMoney(cents)} recorded for ${m.displayNumber || 'the matter'}`);
      return true;
    },
  });
}

/**
 * Delete a transaction. Trust deposits that later withdrawals depend on
 * cannot be removed if that would overdraw the matter.
 */
export async function deleteTransaction(tx) {
  if (tx.paymentId) {
    toast('This transaction belongs to a payment. Delete the payment from its bill instead.', { type: 'info', duration: 6000 });
    return false;
  }
  const account = store().get('accounts', tx.accountId);
  const group = tx.transferId
    ? store()
        .all('transactions')
        .filter((t) => t.transferId === tx.transferId)
    : [tx];
  const overdraws = () => {
    if (account?.type !== 'trust' || tx.type !== 'deposit' || !tx.matterId) return false;
    // Without this deposit, the matter's ledger must stay at or above zero from its date on.
    const { available: remaining } = checkTrustWithdrawal({ matterId: tx.matterId, accountId: tx.accountId, amountCents: 1, transactions: store().all('transactions'), ignoreTxIds: [tx.id], date: tx.date });
    if (remaining < 0) toast('Deleting this deposit would leave the matter with a negative trust balance.', { type: 'error', duration: 7000 });
    return remaining < 0;
  };
  if (overdraws()) return false;
  const ok = await confirmDialog({
    title: 'Delete transaction?',
    message: `This removes the ${formatMoney(tx.amountCents)} ${tx.type} from the ledger${group.length > 1 ? ' along with its linked transfer entry' : ''}.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  // A withdrawal may have been recorded while the question was open.
  if (!ok || overdraws()) return false;
  store().bulkRemove(
    'transactions',
    group.map((t) => t.id),
  );
  toast('Transaction deleted', { action: { label: 'Undo', run: () => restoreTransactions(group) } });
  return true;
}

// ---- Accounts ---------------------------------------------------------------------------

export function openAccountDialog({ account = null, type = 'trust' } = {}) {
  const a = account;
  const opening = moneyInput({ name: 'opening', cents: a?.openingBalanceCents || 0 });
  return formDialog({
    title: a ? 'Edit account' : 'New bank account',
    body: h(
      'div.stack',
      field('Account name', textInput({ name: 'name', value: a?.name || (type === 'trust' ? 'Client trust account' : 'Operating account'), autofocus: true }), { required: true }),
      h(
        'div.grid-2',
        field(
          'Type',
          select({
            name: 'type',
            value: a?.type || type,
            disabled: !!a,
            options: [
              { value: 'trust', label: 'Trust (client funds)' },
              { value: 'operating', label: 'Operating' },
            ],
          }),
        ),
        field('Institution', textInput({ name: 'institution', value: a?.institution || '' })),
        field('Last 4 digits', textInput({ name: 'last4', value: a?.last4 || '', maxlength: '4', inputmode: 'numeric', pattern: '[0-9]{0,4}' })),
        field('Opening balance', opening, {
          hint: a?.type === 'trust' || (!a && type === 'trust') ? 'Record existing client funds as deposits on each matter instead.' : null,
        }),
      ),
      checkbox({ name: 'isDefault', label: 'Default account for this type', checked: a ? !!a.isDefault : !lookup.defaultAccount(type) }),
    ),
    submitLabel: a ? 'Save changes' : 'Create account',
    onSubmit: (fd) => {
      const t = a?.type || fd.get('type');
      const rec = store().put('accounts', {
        ...(a || {}),
        name: String(fd.get('name')).trim(),
        type: t,
        institution: String(fd.get('institution') || '').trim(),
        last4: String(fd.get('last4') || '')
          .replace(/\D/g, '')
          .slice(0, 4),
        openingBalanceCents: opening.cents,
        isDefault: !!fd.get('isDefault'),
      });
      if (rec.isDefault) for (const o of store().all('accounts')) if (o.id !== rec.id && o.type === t && o.isDefault) store().patch('accounts', o.id, { isDefault: false });
      toast(a ? 'Account updated' : 'Account created');
      return rec;
    },
  });
}

/** Short summary of a bill for headers and selects. */
export function billSummary(bill) {
  const t = billTotals(bill);
  return `Bill #${bill.number} · ${contactName(lookup.contact(bill.clientId))} · ${formatMoney(t.total)}`;
}
