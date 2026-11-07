/** Dated cash exercises and cancellations, with the original warrant retained. */
import { el } from './dom.js';
import { field, flagInvalid, authorizedWarning } from './bits.js';
import { openModal } from './modal.js';
import { toast } from './toast.js';
import { openSecurityForm } from './securityform.js';
import { store, isRefusal } from '../lib/store.js';
import { warrantExercised, warrantRemaining } from '../lib/captable.js';
import { shares, money, amountValue, countLabel } from '../lib/format.js';
import { parseNum, todayISO } from '../lib/util.js';

export function openWarrantActions(warrant) {
  if (!warrant) return;
  const today = todayISO();
  const available = Math.max(0, warrant.quantity - (warrant.cancelled || 0)
    - warrantExercised(warrant, store.securities));
  const expired = !!warrant.expires && warrant.expires < today;
  const latest = expired ? warrant.expires : today;
  /* An expired warrant opens on cancelling what is left, dated the expiry:
     the usual end of a lapsed warrant, and what settles its needs-attention
     item. Opened on a full exercise instead, one press issued a certificate
     for every right the row had just called lapsed. */
  const operation = el('select.input', {},
    el('option', { value: 'exercise', selected: !expired }, 'Record cash exercise'),
    el('option', { value: 'cancel', selected: expired }, 'Cancel unexercised rights'));
  const date = el('input.input', { type: 'date', required: true,
    min: warrant.date || '', max: warrant.expires || '', value: latest < warrant.date ? warrant.date : latest });
  const quantity = el('input.input', { type: 'text', inputmode: 'numeric', required: true,
    autocomplete: 'off', value: amountValue(available) });
  const summary = el('p.small.muted', { role: 'status' });
  // The certificate lands in the warrant's own class; said here when that takes it past the charter.
  const overrun = authorizedWarning();
  const save = el('button.btn.btn-primary', { type: 'submit', disabled: available === 0 }, 'Record exercise');
  const update = () => {
    save.textContent = operation.value === 'exercise' ? 'Record exercise' : 'Cancel rights';
    const exercising = operation.value === 'exercise' && available > 0;
    overrun.sync(store.db, warrant.classId, exercising ? Math.max(0, parseNum(quantity.value) || 0) : 0);
    if (available === 0) {
      summary.textContent = 'Every right on this warrant has been exercised or cancelled.';
      return;
    }
    summary.textContent = operation.value === 'exercise'
      ? `${money(Math.max(0, parseNum(quantity.value) || 0) * warrant.strike)} exercise cost. A linked share certificate will be issued.`
      : 'Cancelled rights leave the fully diluted count on this date. Earlier snapshots retain them.';
  };
  operation.addEventListener('change', update);
  quantity.addEventListener('input', update);
  update();
  const error = el('p.small.neg', { role: 'alert', hidden: true });
  const form = el('form', { onsubmit: async (event) => {
    event.preventDefault();
    const n = parseNum(quantity.value);
    if (!Number.isSafeInteger(n) || n <= 0 || n > available) {
      flagInvalid(quantity, available === 1 ? 'Only 1 share is left to record' : `Enter between 1 and ${shares(available)} whole shares`);
      quantity.focus(); return;
    }
    save.disabled = true; error.hidden = true;
    try {
      const action = operation.value;
      const result = await (action === 'exercise'
        ? store.exerciseWarrant(warrant.id, { quantity: n, date: date.value })
        : store.cancelWarrant(warrant.id, { quantity: n, date: date.value }));
      store.logActivity(`${shares(n)} warrant ${n === 1 ? 'share' : 'shares'} ${action === 'exercise' ? 'exercised' : 'cancelled'} on ${warrant.label}`, 'check');
      toast(action === 'exercise' ? 'Warrant exercised and shares issued' : 'Warrant rights cancelled',
        action === 'cancel' ? { action: { label: 'Undo', onClick: async () => {
          try { await result.undo(); toast('Cancellation undone'); }
          catch (err) {
            toast(isRefusal(err) ? err.message : 'Couldn’t undo. Check your connection',
              { icon: isRefusal(err) ? 'alert' : 'wifiOff' });
          }
        } } } : {});
      modal.close();
    } catch (err) {
      console.error(err);
      // The store's own sentence when it declined; a failed write is a connection problem, not a rule.
      error.textContent = isRefusal(err) ? err.message : 'Couldn’t save. Check your connection';
      error.hidden = false; save.disabled = false;
    }
  } },
  el('p.confirm-message', {}, `${countLabel(warrantRemaining(warrant, store.securities, today), 'right')} outstanding today. `
    + `${shares(warrantExercised(warrant, store.securities))} exercised; ${shares(warrant.cancelled || 0)} cancelled.`),
  expired
    ? el('p.small.muted', {}, 'Expired rights are excluded from current ownership. Cancelling what is left, dated the expiration, settles the needs-attention item; an exercise that happened before the expiration can still be recorded.') : null,
  field('Action', operation),
  el('div.form-grid', {}, field('Transaction date', date), field('Warrant shares', quantity)),
  summary, overrun.node, error,
  el('div.row.row-end', {},
    el('button.btn.btn-ghost', { type: 'button', onclick: () => {
      modal.close(); openSecurityForm({ existing: store.security(warrant.id) });
    } }, 'Edit terms'), save));
  const modal = openModal({ title: `Manage ${warrant.label}`, content: form });
}
