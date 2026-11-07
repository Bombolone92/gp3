/** Deposit, transfer, credit card payment, and journal entry. */
import { el, clear } from '../ui/dom.js';
import { field, textInput, textArea, selectInput, moneyInput, dateInput } from '../ui/fields.js';
import { toast } from '../ui/toast.js';
import { openFrame } from './frame.js';
import { contactPicker, accountPicker, lineGrid, filledLines, attachmentsBlock, headline, recentMenu } from './common.js';
import { store } from '../lib/store.js';
import { newId } from '../lib/ids.js';
import { TXN_TYPES, PAYMENT_METHODS } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { today, formatDate } from '../lib/dates.js';
import { txnMoreActions } from './actions.js';
import { openRecurringFromTxn } from './recurring.js';

const ANY_ACCOUNT = null;

// ---------------------------------------------------------------- deposit

export function openDepositForm({ id = null, draft = null, onSaved = null } = {}) {
  const existing = id ? store.txn(id) : null;
  const doc = existing ? structuredClone(existing) : {
    id: newId(), type: 'deposit', date: today(), accountId: store.accountsOfType('bank')[0]?.id || null, lines: [], memo: '', attachments: [], ...(draft || {}),
  };
  if (!doc.id) doc.id = newId();
  const paymentLines = (doc.lines || []).filter((l) => l.paymentId);
  const otherLines = (doc.lines || []).filter((l) => !l.paymentId).map((l) => ({ ...l }));
  // Only payments still waiting for this deposit can be in it, at what they
  // are now: a duplicated deposit must not deposit its payments again, and a
  // payment voided or changed since is dropped or updated.
  const waiting = new Map(store.undepositedItems(existing?.id).map((t) => [t.id, t]));
  const selected = new Map();
  let stale = false;
  for (const l of paymentLines) {
    const t = waiting.get(l.paymentId);
    if (!t) { stale = true; continue; }
    const amount = store.total(t);
    if (amount !== l.amount) stale = true;
    selected.set(l.paymentId, { ...l, amount });
  }
  let dirty = !!draft || stale;
  const touch = () => { dirty = true; };
  const head = headline('Amount');

  const acct = accountPicker({ value: doc.accountId, types: ['bank', 'otherCurrentAsset'], ariaLabel: 'Deposit to account', onChange: (v) => { doc.accountId = v; touch(); } });
  const date = dateInput({ value: doc.date, ariaLabel: 'Date', required: true, onChange: (v) => { doc.date = v; touch(); } });

  // Undeposited payments
  const pendingBox = el('div');
  function paintPending() {
    clear(pendingBox);
    const items = store.undepositedItems(existing?.id);
    if (!items.length) {
      pendingBox.append(el('p.field-hint', {}, 'No payments are waiting in Undeposited Funds.'));
      return;
    }
    const table = el('table.grid.apply-table', { 'aria-label': 'Payments waiting to be deposited' });
    table.append(el('thead', {}, el('tr', {},
      el('th.check-cell', { scope: 'col' }, el('span.sr-only', {}, 'Include')),
      el('th', { scope: 'col' }, 'Received from'), el('th', { scope: 'col' }, 'Date'), el('th', { scope: 'col' }, 'Type'), el('th', { scope: 'col' }, 'Payment method'), el('th.num', { scope: 'col' }, 'Amount'))));
    const tb = el('tbody');
    for (const t of items) {
      const amt = store.total(t);
      const cb = el('input', { type: 'checkbox', checked: selected.has(t.id), 'aria-label': `Include payment from ${store.contactName(t.contactId)} on ${formatDate(t.date)}` });
      cb.addEventListener('change', () => {
        if (cb.checked) selected.set(t.id, { paymentId: t.id, contactId: t.contactId, amount: amt, desc: `${TXN_TYPES[t.type].label}${t.ref ? ` ${t.ref}` : ''}` });
        else selected.delete(t.id);
        touch();
        refresh();
      });
      tb.append(el('tr', {}, el('td.check-cell', {}, cb), el('td', {}, store.contactName(t.contactId)), el('td', {}, formatDate(t.date)), el('td', {}, TXN_TYPES[t.type].label), el('td', {}, t.paymentMethod || ''), el('td.num', {}, formatMoney(amt))));
    }
    table.append(tb);
    pendingBox.append(el('div.table-wrap', {}, el('div.table-scroll', {}, table)));
  }
  paintPending();

  const makeLine = () => ({ contactId: null, accountId: null, desc: '', method: '', ref: '', amount: 0 });
  const grid = lineGrid({
    ariaLabel: 'Add funds to this deposit',
    lines: otherLines,
    makeLine,
    onChange: () => { touch(); refresh(); },
    columns: [
      { key: 'from', label: 'Received from', width: '20%', cell: (line, row) => contactPicker({ kind: 'any', value: line.contactId, ariaLabel: `Received from, line ${row.index + 1}`, onChange: (v) => { line.contactId = v; row.changed(); } }).root },
      { key: 'acct', label: 'Account', width: '24%', cell: (line, row) => accountPicker({ value: line.accountId, types: ANY_ACCOUNT, ariaLabel: `Account, line ${row.index + 1}`, onChange: (v) => { line.accountId = v; row.changed(); } }).root },
      { key: 'desc', label: 'Description', cell: (line, row) => { const i = textInput({ value: line.desc || '', ariaLabel: `Description, line ${row.index + 1}` }); i.addEventListener('input', () => { line.desc = i.value; row.changed(); }); return i; } },
      { key: 'method', label: 'Payment method', width: '14%', cell: (line, row) => selectInput({ options: [['', ''], ...PAYMENT_METHODS.map((m) => [m, m])], value: line.method || '', ariaLabel: `Payment method, line ${row.index + 1}`, onChange: (v) => { line.method = v; row.changed(); } }) },
      { key: 'amount', label: 'Amount', width: '130px', align: 'right', cell: (line, row) => moneyInput({ value: line.amount || null, allowNegative: true, ariaLabel: `Amount, line ${row.index + 1}`, onChange: (v) => { line.amount = v || 0; row.changed(); } }).root },
    ],
  });

  const cashBackAcct = accountPicker({ value: doc.cashBackAccountId || null, types: ['bank', 'otherCurrentAsset', 'expense', 'equity'], ariaLabel: 'Cash back goes to', onChange: (v) => { doc.cashBackAccountId = v; touch(); } });
  const cashBack = moneyInput({ value: doc.cashBack || null, ariaLabel: 'Cash back amount', onChange: (v) => { doc.cashBack = v || 0; touch(); refresh(); } });
  const totals = el('dl.doc-totals');
  function refresh() {
    const sumSel = [...selected.values()].reduce((a, l) => a + l.amount, 0);
    const sumOther = otherLines.reduce((a, l) => a + (l.amount || 0), 0);
    const total = sumSel + sumOther - (doc.cashBack || 0);
    clear(totals);
    totals.append(el('div.tot-row', {}, el('dt', {}, 'Other funds total'), el('dd.money', {}, formatMoney(sumOther))));
    totals.append(el('div.tot-row', {}, el('dt', {}, 'Payments selected'), el('dd.money', {}, formatMoney(sumSel))));
    if (doc.cashBack) totals.append(el('div.tot-row', {}, el('dt', {}, 'Cash back'), el('dd.money', {}, `-${formatMoney(doc.cashBack)}`)));
    totals.append(el('div.tot-row.tot-total', {}, el('dt', {}, 'Total'), el('dd.money', {}, formatMoney(total))));
    head.set(total);
  }
  refresh();
  const memo = textArea({ value: doc.memo || '', rows: 2, ariaLabel: 'Memo' });
  memo.addEventListener('input', () => { doc.memo = memo.value; touch(); });
  const depositFiles = attachmentsBlock(doc, touch);

  const body = el('div.doc-sheet', {},
    el('div.doc-band', {},
      el('div.doc-party', {}, field('Account', acct, { required: true })),
      el('div.doc-side', {}, head.node, el('div.doc-meta', {}, field('Date', date, { required: true })))),
    doc.voided ? el('div.banner.banner-info', {}, el('strong', {}, 'This deposit is void.')) : null,
    el('section.doc-lines', { 'aria-label': 'Payments to deposit' }, el('h2.doc-section-title', {}, 'Payments waiting to be deposited'), pendingBox),
    el('section.doc-lines', { 'aria-label': 'Other money in' }, el('h2.doc-section-title', {}, 'Other money in this deposit'), grid.root),
    el('div.doc-bottom', {},
      el('div.doc-notes', {}, field('Memo', memo), el('div.form-grid', {}, field('Cash back goes to', cashBackAcct), field('Cash back amount', cashBack)), depositFiles),
      totals));

  const frame = openFrame({
    title: 'Deposit',
    body,
    // A void transaction is kept for the record; it cannot be edited.
    readOnly: !!existing?.voided,
    isDirty: () => dirty,
    onAddLine: () => grid.addLine(),
    history: recentMenu('deposit', async (tid) => { if (await frame.requestClose()) openDepositForm({ id: tid }); }),
    onRecurring: () => openRecurringFromTxn({ ...doc, lines: filledLines(otherLines) }),
    more: txnMoreActions(existing, { reopen: (t) => openDepositForm({ id: t.id }), close: () => frame.requestClose() }),
    onSave: (mode) => {
      const record = { ...doc, lines: [...selected.values(), ...filledLines(otherLines)] };
      const saved = store.saveTxn(record);
      dirty = false;
      depositFiles.commit();
      toast('Deposit saved');
      onSaved?.(saved);
      if (mode === 'new') { frame.close(); openDepositForm(); }
      else if (mode === 'stay') { frame.close(); openDepositForm({ id: saved.id }); }
      return true;
    },
  });
  return frame;
}

// --------------------------------------------------------------- transfer

export function openTransferForm({ type = 'transfer', id = null, draft = null, onSaved = null } = {}) {
  const cc = type === 'ccPayment';
  const existing = id ? store.txn(id) : null;
  const doc = existing ? structuredClone(existing) : cc
    ? { id: newId(), type, date: today(), ccAccountId: store.accountsOfType('creditCard')[0]?.id || null, bankAccountId: store.accountsOfType('bank')[0]?.id || null, amount: 0, memo: '', ...(draft || {}) }
    : { id: newId(), type, date: today(), fromId: store.accountsOfType('bank')[0]?.id || null, toId: store.accountsOfType('bank')[1]?.id || null, amount: 0, memo: '', ...(draft || {}) };
  if (!doc.id) doc.id = newId();
  let dirty = !!draft;
  const touch = () => { dirty = true; };
  const head = headline(cc ? 'Payment amount' : 'Transfer amount');
  head.set(doc.amount || 0);
  const balHint = (getId) => {
    const h = el('div.field-hint');
    const paint = () => { const v = getId(); h.textContent = v ? `Balance ${formatMoney(store.accountBalance(v))}` : ''; };
    paint();
    return { h, paint };
  };
  const fromBal = balHint(() => (cc ? doc.bankAccountId : doc.fromId));
  const toBal = balHint(() => (cc ? doc.ccAccountId : doc.toId));
  const from = accountPicker({ value: cc ? doc.bankAccountId : doc.fromId, types: cc ? ['bank'] : ['bank', 'creditCard', 'otherCurrentAsset', 'otherCurrentLiability', 'longTermLiability', 'equity', 'fixedAsset', 'otherAsset'], ariaLabel: cc ? 'Bank account' : 'Transfer funds from', onChange: (v) => { if (cc) doc.bankAccountId = v; else doc.fromId = v; fromBal.paint(); touch(); } });
  const to = accountPicker({ value: cc ? doc.ccAccountId : doc.toId, types: cc ? ['creditCard'] : ['bank', 'creditCard', 'otherCurrentAsset', 'otherCurrentLiability', 'longTermLiability', 'equity', 'fixedAsset', 'otherAsset'], ariaLabel: cc ? 'Credit card' : 'Transfer funds to', onChange: (v) => { if (cc) doc.ccAccountId = v; else doc.toId = v; toBal.paint(); touch(); } });
  const payee = cc ? contactPicker({ kind: 'vendor', value: doc.contactId, ariaLabel: 'Payee', placeholder: 'Card issuer (optional)', onChange: (v) => { doc.contactId = v; touch(); } }) : null;
  const amount = moneyInput({ value: doc.amount || null, ariaLabel: cc ? 'Amount' : 'Transfer amount', onChange: (v) => { doc.amount = v || 0; head.set(doc.amount); touch(); } });
  const date = dateInput({ value: doc.date, ariaLabel: 'Date', required: true, onChange: (v) => { doc.date = v; touch(); } });
  const memo = textArea({ value: doc.memo || '', rows: 2, ariaLabel: 'Memo' });
  memo.addEventListener('input', () => { doc.memo = memo.value; touch(); });

  const body = el('div.doc-sheet.doc-narrow', {},
    el('div.doc-band', {},
      el('div.doc-party', {},
        cc ? field('Which credit card did you pay?', to, { required: true }) : el('div', {}, field('Transfer funds from', from, { required: true }), fromBal.h),
        cc ? toBal.h : null,
        cc ? field('Payee', payee) : el('div', {}, field('Transfer funds to', to, { required: true }), toBal.h),
        cc ? el('div', {}, field('What did you use to make this payment?', from, { required: true }), fromBal.h) : null),
      el('div.doc-side', {}, head.node, el('div.doc-meta', {}, field('Amount', amount, { required: true }), field('Date', date, { required: true })))),
    doc.voided ? el('div.banner.banner-info', {}, el('strong', {}, `This ${TXN_TYPES[type].label.toLowerCase()} is void.`)) : null,
    el('div.doc-bottom', {}, el('div.doc-notes', {}, field('Memo', memo)), el('div')));

  const meta = TXN_TYPES[type];
  const frame = openFrame({
    title: meta.label,
    body,
    // A void transaction is kept for the record; it cannot be edited.
    readOnly: !!existing?.voided,
    isDirty: () => dirty,
    history: recentMenu(type, async (tid) => { if (await frame.requestClose()) openTransferForm({ type, id: tid }); }),
    onRecurring: () => openRecurringFromTxn({ ...doc }),
    more: txnMoreActions(existing, { reopen: (t) => openTransferForm({ type: t.type, id: t.id }), close: () => frame.requestClose() }),
    onSave: (mode) => {
      const saved = store.saveTxn({ ...doc });
      dirty = false;
      toast(`${meta.label} saved`);
      onSaved?.(saved);
      if (mode === 'new') { frame.close(); openTransferForm({ type }); }
      else if (mode === 'stay') { frame.close(); openTransferForm({ type, id: saved.id }); }
      return true;
    },
  });
  return frame;
}

// ---------------------------------------------------------------- journal

export function openJournalForm({ id = null, draft = null, onSaved = null } = {}) {
  const existing = id ? store.txn(id) : null;
  const doc = existing ? structuredClone(existing) : { id: newId(), type: 'journal', date: today(), num: store.nextNumber('journal'), lines: [], memo: '', attachments: [], ...(draft || {}) };
  if (!doc.id) doc.id = newId();
  const lines = (doc.lines || []).map((l) => ({ ...l }));
  let dirty = !!draft;
  const touch = () => { dirty = true; };
  const date = dateInput({ value: doc.date, ariaLabel: 'Journal date', required: true, onChange: (v) => { doc.date = v; touch(); } });
  const num = textInput({ value: doc.num || '', ariaLabel: 'Journal no.' });
  num.addEventListener('input', () => { doc.num = num.value.trim(); touch(); });
  const totals = el('dl.doc-totals');

  const amountCell = (key) => (line, row) => {
    const m = moneyInput({ value: line[key] || null, ariaLabel: `${key === 'debit' ? 'Debit' : 'Credit'}, line ${row.index + 1}`, onChange: (v) => {
      line[key] = v || 0;
      // A line is a debit or a credit, not both.
      if (v) {
        const other = key === 'debit' ? 'credit' : 'debit';
        if (line[other]) {
          line[other] = 0;
          m.root.closest('tr')?.querySelector(`[data-k="${other}"]`)?.dispatchEvent(new CustomEvent('external', { detail: null }));
        }
      }
      row.changed();
    } });
    m.input.dataset.k = key;
    m.input.addEventListener('external', (e) => { m.value = e.detail; });
    return m.root;
  };

  const grid = lineGrid({
    ariaLabel: 'Journal lines',
    lines,
    makeLine: () => ({ accountId: null, debit: 0, credit: 0, desc: '', contactId: null }),
    isBlank: (l) => !l.accountId && !l.debit && !l.credit && !l.desc && !l.contactId,
    onChange: () => { touch(); refresh(); },
    columns: [
      { key: 'acct', label: 'Account', width: '28%', cell: (line, row) => { const picker = accountPicker({ value: line.accountId, ariaLabel: `Account, line ${row.index + 1}`, onChange: (v) => {
        line.accountId = v;
        // Picking an account on an empty line fills the amount that balances
        // the entry, as accountants expect.
        const others = lines.filter((l) => l !== line);
        const gap = others.reduce((a, l) => a + (l.debit || 0) - (l.credit || 0), 0);
        if (v && !line.debit && !line.credit && gap) {
          if (gap > 0) line.credit = gap; else line.debit = -gap;
          const tr = picker.root.closest('tr');
          tr?.querySelector('[data-k="debit"]')?.dispatchEvent(new CustomEvent('external', { detail: line.debit || null }));
          tr?.querySelector('[data-k="credit"]')?.dispatchEvent(new CustomEvent('external', { detail: line.credit || null }));
        }
        row.changed();
      } }); return picker.root; } },
      { key: 'debit', label: 'Debits', width: '130px', align: 'right', cell: amountCell('debit') },
      { key: 'credit', label: 'Credits', width: '130px', align: 'right', cell: amountCell('credit') },
      { key: 'desc', label: 'Description', cell: (line, row) => { const i = textInput({ value: line.desc || '', ariaLabel: `Description, line ${row.index + 1}` }); i.addEventListener('input', () => { line.desc = i.value; row.changed(); }); return i; } },
      { key: 'name', label: 'Name', width: '20%', cell: (line, row) => contactPicker({ kind: 'any', value: line.contactId, ariaLabel: `Name, line ${row.index + 1}`, onChange: (v) => { line.contactId = v; row.changed(); } }).root },
    ],
  });

  function refresh() {
    const d = lines.reduce((a, l) => a + (l.debit || 0), 0);
    const c = lines.reduce((a, l) => a + (l.credit || 0), 0);
    clear(totals);
    totals.append(el('div.tot-row', {}, el('dt', {}, 'Total debits'), el('dd.money', {}, formatMoney(d))));
    totals.append(el('div.tot-row', {}, el('dt', {}, 'Total credits'), el('dd.money', {}, formatMoney(c))));
    if (d !== c) totals.append(el('div.tot-row.tot-warn', { role: 'status' }, el('dt', {}, 'Out of balance'), el('dd.money', {}, formatMoney(Math.abs(d - c)))));
  }
  refresh();
  const memo = textArea({ value: doc.memo || '', rows: 2, ariaLabel: 'Memo' });
  memo.addEventListener('input', () => { doc.memo = memo.value; touch(); });

  const journalFiles = attachmentsBlock(doc, touch);
  const body = el('div.doc-sheet', {},
    el('div.doc-band.doc-band-plain', {}, el('div.doc-meta.doc-meta-inline', {}, field('Journal date', date, { required: true }), field('Journal no.', num))),
    doc.voided ? el('div.banner.banner-info', {}, el('strong', {}, 'This journal entry is void.')) : null,
    el('section.doc-lines', { 'aria-label': 'Journal lines' }, grid.root),
    el('div.doc-bottom', {}, el('div.doc-notes', {}, field('Memo', memo), journalFiles), totals));

  const frame = openFrame({
    title: existing ? `Journal entry #${doc.num || ''}` : 'Journal entry',
    body,
    // A void transaction is kept for the record; it cannot be edited.
    readOnly: !!existing?.voided,
    isDirty: () => dirty,
    onAddLine: () => grid.addLine(),
    history: recentMenu('journal', async (tid) => { if (await frame.requestClose()) openJournalForm({ id: tid }); }),
    onRecurring: () => openRecurringFromTxn({ ...doc, lines: filledLines(lines).map(stripSuggest) }),
    more: txnMoreActions(existing, { reopen: (t) => openJournalForm({ id: t.id }), close: () => frame.requestClose() }),
    onSave: (mode) => {
      const record = { ...doc, lines: filledLines(lines, (l) => !l.accountId && !l.debit && !l.credit).map(stripSuggest) };
      const saved = store.saveTxn(record);
      dirty = false;
      journalFiles.commit();
      toast('Journal entry saved');
      onSaved?.(saved);
      if (mode === 'new') { frame.close(); openJournalForm(); }
      else if (mode === 'stay') { frame.close(); openJournalForm({ id: saved.id }); }
      return true;
    },
  });
  return frame;
}

function stripSuggest(l) {
  const c = { ...l };
  delete c._suggest;
  return c;
}
