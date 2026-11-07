/** Make recurring: turn a transaction into a schedule. */
import { el } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { field, textInput, selectInput, dateInput } from '../ui/fields.js';
import { toast } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { TXN_TYPES, withoutSnapshots } from '../lib/txn.js';
import { INTERVALS } from '../lib/recurring.js';
import { today, addMonths } from '../lib/dates.js';

export const RECURRING_TYPES = ['invoice', 'expense', 'check', 'bill', 'salesReceipt', 'deposit', 'transfer', 'journal', 'estimate', 'creditMemo', 'vendorCredit', 'ccPayment', 'purchaseOrder', 'refundReceipt', 'ccCredit'];

export function templateOf(doc) {
  // Each occurrence takes the tax rate and item accounts current on its date.
  const t = withoutSnapshots(structuredClone(doc));
  for (const k of ['id', 'num', 'date', 'dueDate', 'createdAt', 'updatedAt', 'attachments', 'applied', 'voided', 'expiryDate', 'status', 'estimateId', 'bankLineId']) delete t[k];
  return t;
}

export function openRecurringForm({ rule = null, doc = null } = {}) {
  return new Promise((resolve) => {
    const r = rule ? structuredClone(rule) : {
      name: doc ? `${TXN_TYPES[doc.type].label}${doc.contactId ? ` for ${store.contactName(doc.contactId)}` : ''}` : '',
      type: doc?.type || 'invoice',
      template: doc ? templateOf(doc) : { type: 'invoice', lines: [] },
      interval: 'month', every: 1,
      startDate: addMonths(doc?.date || today(), 1), endDate: null, maxCount: null,
      mode: 'scheduled', daysBefore: 0, active: true, count: 0,
    };
    let saved = null;
    const name = textInput({ value: r.name });
    name.addEventListener('input', () => { r.name = name.value; });
    const mode = selectInput({ options: [['scheduled', 'Scheduled: create it automatically'], ['reminder', 'Reminder: remind me to review it']], value: r.mode, onChange: (v) => { r.mode = v; } });
    const interval = selectInput({ options: INTERVALS, value: r.interval, onChange: (v) => { r.interval = v; } });
    const every = textInput({ value: String(r.every || 1), inputMode: 'numeric' });
    every.addEventListener('input', () => { r.every = Math.max(1, parseInt(every.value, 10) || 1); });
    const start = dateInput({ value: r.nextDate || r.startDate, required: true, onChange: (v) => { r.startDate = v; r.nextDate = v; } });
    const end = dateInput({ value: r.endDate, onChange: (v) => { r.endDate = v; } });
    const err = el('p.field-error', { role: 'alert', hidden: true });
    const save = () => {
      const fail = (text) => { err.hidden = false; err.textContent = text; };
      if (!r.name.trim()) return fail('Give the template a name.');
      // Without a date the template would never run; ending before it starts, likewise.
      const first = r.nextDate || r.startDate;
      if (!first) return fail(rule ? 'Choose the next date.' : 'Choose a start date.');
      if (r.endDate && r.endDate < first) return fail(`The end date is before the ${rule ? 'next' : 'start'} date.`);
      if (!r.nextDate) r.nextDate = r.startDate;
      saved = store.put('recurring', r);
      toast('Recurring template saved');
      dlg.close();
    };
    const dlg = openDialog({
      title: rule ? 'Edit recurring template' : 'Make recurring',
      body: el('div.stack', {}, err,
        field('Template name', name, { required: true }),
        el('p.field-hint', {}, `Type: ${TXN_TYPES[r.type].label}. The transaction's lines, amounts, and names are copied into the template.`),
        field('How it runs', mode),
        el('div.form-grid', {}, field('Interval', interval), field('Every', every, { hint: 'For example every 2 months' }), field(rule ? 'Next date' : 'Start date', start, { required: true }), field('End date (optional)', end))),
      footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, 'Cancel'), el('button.btn.btn-primary', { type: 'button', onclick: save }, 'Save template')),
      initialFocus: name,
      onClose: () => resolve(saved),
    });
  });
}

export function openRecurringFromTxn(doc) {
  if (!RECURRING_TYPES.includes(doc.type)) {
    toast('This kind of transaction cannot be made recurring.');
    return null;
  }
  return openRecurringForm({ doc });
}
