/**
 * Customer payment and bill payment (vendors): one form. Pick the
 * contact, see their open documents oldest first, and apply money (and any
 * unapplied credits) to them. Typing the amount received spreads it over the
 * oldest documents; ticking a document applies its open balance.
 */
import { el, clear } from '../ui/dom.js';
import { field, textInput, textArea, selectInput, moneyInput, dateInput } from '../ui/fields.js';
import { toast } from '../ui/toast.js';
import { openFrame } from './frame.js';
import { contactPicker, accountPicker, headline, attachmentsBlock, recentMenu } from './common.js';
import { store } from '../lib/store.js';
import { newId } from '../lib/ids.js';
import { TXN_TYPES, PAYMENT_METHODS } from '../lib/txn.js';
import { formatMoney } from '../lib/money.js';
import { today, formatDate } from '../lib/dates.js';
import { txnMoreActions } from './actions.js';

export function openPaymentForm({ type = 'payment', id = null, draft = null, onSaved = null } = {}) {
  const ar = type === 'payment';
  const meta = TXN_TYPES[type];
  const docType = ar ? 'invoice' : 'bill';
  const creditType = ar ? 'creditMemo' : 'vendorCredit';
  const existing = id ? store.txn(id) : null;
  const preselect = draft?.preselect || null;
  const doc = existing ? structuredClone(existing) : {
    id: newId(), type, date: today(), contactId: null, amount: 0, applied: [], memo: '', attachments: [],
    ...(ar
      ? { depositToId: store.settings.paymentsToUndeposited ? store.roleAccount('undeposited') : store.accountsOfType('bank')[0]?.id || store.roleAccount('undeposited') }
      : { accountId: store.accountsOfType('bank')[0]?.id || null }),
    ...(draft || {}),
  };
  delete doc.preselect;
  if (!doc.id) doc.id = newId();
  let dirty = !!draft;
  let amountTouched = !!existing;
  // Typing the amount spreads it over the oldest documents, except on a saved
  // payment, whose applications the user chose (until its contact changes).
  let spread = !existing;
  const touch = () => { dirty = true; };
  const head = headline(ar ? 'Amount received' : 'Total payment');

  // applied amounts per document, and per credit
  let rows = [];
  let creditRows = [];
  const applied = new Map((doc.applied || []).map((a) => [a.txnId, a.amount]));
  const creditUse = new Map();

  function loadRows() {
    rows = doc.contactId ? store.openDocs(doc.contactId, docType, existing?.id) : [];
    creditRows = doc.contactId ? store.openCredits(doc.contactId, creditType, null) : [];
    creditUse.clear();
  }

  // ---------------------------------------------------------------- header
  const contact = contactPicker({
    kind: ar ? 'customer' : 'vendor', value: doc.contactId, ariaLabel: ar ? 'Customer' : 'Vendor',
    onChange: (v) => {
      doc.contactId = v;
      applied.clear();
      spread = true;
      touch();
      loadRows();
      if (!amountTouched) doc.amount = 0;
      paint();
    },
  });
  const date = dateInput({ value: doc.date, ariaLabel: 'Payment date', required: true, onChange: (v) => { doc.date = v; touch(); } });
  const method = selectInput({ options: [['', 'Choose a method'], ...PAYMENT_METHODS.map((m) => [m, m])], value: doc.paymentMethod || '', ariaLabel: 'Payment method', onChange: (v) => { doc.paymentMethod = v; touch(); } });
  const ref = textInput({ value: doc.ref || doc.num || '', ariaLabel: ar ? 'Reference no.' : 'Ref no.' });
  ref.addEventListener('input', () => { doc.ref = ref.value; touch(); });
  const account = ar
    ? accountPicker({ value: doc.depositToId, types: ['bank', 'otherCurrentAsset', 'creditCard'], ariaLabel: 'Deposit to', onChange: (v) => { doc.depositToId = v; touch(); } })
    : accountPicker({ value: doc.accountId, types: ['bank', 'creditCard'], ariaLabel: 'Payment account', onChange: (v) => { doc.accountId = v; touch(); paintBal(); } });
  const bal = el('div.field-hint');
  const paintBal = () => { bal.textContent = !ar && doc.accountId ? `Balance ${formatMoney(store.accountBalance(doc.accountId))}` : ''; };
  paintBal();
  const amount = moneyInput({ value: doc.amount || null, ariaLabel: ar ? 'Amount received' : 'Payment amount', onChange: (v, final) => {
    doc.amount = v || 0;
    amountTouched = true;
    touch();
    if (final && spread) { autoApply(); syncChecks(); }
    paintTotals();
  } });

  // Spread the amount over the oldest documents.
  function autoApply() {
    let left = doc.amount;
    for (const r of rows) {
      const take = Math.max(0, Math.min(left, r.open));
      setApplied(r.txn.id, take);
      left -= take;
    }
  }

  // ----------------------------------------------------------------- tables
  // The tables are rebuilt only when the contact changes. Ticking a box or
  // typing a payment updates the cells in place, so focus and clicks never
  // land on a row that was just replaced.
  const tableBox = el('div');
  const creditBox = el('div');
  const totals = el('dl.doc-totals');
  let rowRefs = new Map(); // doc id -> { cb, pay, tr, open }
  let allCb = null;

  function setApplied(id, value, { fromInput = false } = {}) {
    const ref = rowRefs.get(id);
    const v = Math.max(0, Math.min(value || 0, ref ? ref.open : value || 0));
    applied.set(id, v);
    if (!ref) return;
    ref.cb.checked = v > 0;
    ref.tr.classList.toggle('is-selected', v > 0);
    if (!fromInput || document.activeElement !== ref.pay.input) ref.pay.value = v || null;
  }

  function syncChecks() {
    if (allCb) allCb.checked = rows.length > 0 && rows.every((r) => (applied.get(r.txn.id) || 0) > 0);
  }

  function docTable() {
    rowRefs = new Map();
    const table = el('table.grid.apply-table', { 'aria-label': ar ? 'Outstanding invoices' : 'Open bills' });
    allCb = el('input', { type: 'checkbox', 'aria-label': 'Apply to all' });
    allCb.addEventListener('change', () => {
      for (const r of rows) setApplied(r.txn.id, allCb.checked ? r.open : 0);
      syncAmount();
      paintTotals();
    });
    table.append(el('thead', {}, el('tr', {},
      el('th.check-cell', { scope: 'col' }, allCb),
      el('th', { scope: 'col' }, 'Description'),
      el('th', { scope: 'col' }, 'Due date'),
      el('th.num', { scope: 'col' }, 'Original amount'),
      el('th.num', { scope: 'col' }, 'Open balance'),
      el('th.num', { scope: 'col', style: { width: '150px' } }, 'Payment'))));
    const tb = el('tbody');
    for (const r of rows) {
      const label = `${TXN_TYPES[r.txn.type].label} ${r.txn.num || ''}`.trim();
      const cb = el('input', { type: 'checkbox', 'aria-label': `Apply to ${label}` });
      const pay = moneyInput({ value: null, ariaLabel: `Payment for ${label}`, onChange: (v) => {
        setApplied(r.txn.id, v, { fromInput: true });
        syncChecks();
        syncAmount();
        paintTotals();
      } });
      cb.addEventListener('change', () => {
        setApplied(r.txn.id, cb.checked ? r.open : 0);
        syncChecks();
        syncAmount();
        paintTotals();
      });
      const tr = el('tr', {},
        el('td.check-cell', {}, cb),
        el('td', {}, el('a', { href: `#/txn/${r.txn.id}` }, `${TXN_TYPES[r.txn.type].label} #${r.txn.num || ''}`), el('span.cell-sub', {}, ` (${formatDate(r.txn.date)})`)),
        el('td', {}, formatDate(r.txn.dueDate || r.txn.date)),
        el('td.num', {}, formatMoney(r.total)),
        el('td.num', {}, formatMoney(r.open)),
        el('td.num', {}, pay.root));
      rowRefs.set(r.txn.id, { cb, pay, tr, open: r.open });
      setApplied(r.txn.id, applied.get(r.txn.id) || 0);
      tb.append(tr);
    }
    table.append(tb);
    syncChecks();
    return el('div.table-wrap', {}, el('div.table-scroll', {}, table));
  }

  function creditTable() {
    if (!creditRows.length) return null;
    const table = el('table.grid.apply-table', { 'aria-label': 'Credits' });
    table.append(el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Credit'), el('th.num', { scope: 'col' }, 'Original amount'), el('th.num', { scope: 'col' }, 'Available'), el('th.num', { scope: 'col', style: { width: '150px' } }, 'Use'))));
    const tb = el('tbody');
    for (const c of creditRows) {
      const use = moneyInput({ value: creditUse.get(c.txn.id) || null, ariaLabel: `Use credit ${c.txn.num || ''}`, onChange: (v) => {
        creditUse.set(c.txn.id, Math.min(v || 0, c.open));
        syncAmount();
        paintTotals();
      } });
      tb.append(el('tr', {},
        el('td', {}, el('a', { href: `#/txn/${c.txn.id}` }, `${TXN_TYPES[c.txn.type].label} #${c.txn.num || ''}`), el('span.cell-sub', {}, ` (${formatDate(c.txn.date)})`)),
        el('td.num', {}, formatMoney(c.total)),
        el('td.num', {}, formatMoney(c.open)),
        el('td.num', {}, use.root)));
    }
    table.append(tb);
    return el('section', { 'aria-label': 'Credits' }, el('h2.doc-section-title', {}, 'Credits'), el('p.field-hint', {}, 'Credits you use are applied to the documents ticked above, oldest first.'), el('div.table-wrap', {}, table));
  }

  function syncAmount() {
    touch();
    const sumApplied = [...applied.values()].reduce((a, b) => a + b, 0);
    const credits = [...creditUse.values()].reduce((a, b) => a + b, 0);
    // Without a typed amount, the amount follows what is applied less credits used.
    if (!amountTouched || sumApplied - credits > doc.amount) {
      doc.amount = Math.max(0, sumApplied - credits);
      amount.value = doc.amount || null;
    }
  }

  function paintTotals() {
    clear(totals);
    const sumApplied = [...applied.values()].reduce((a, b) => a + b, 0);
    const credits = [...creditUse.values()].reduce((a, b) => a + b, 0);
    const toApply = doc.amount + credits;
    const row = (l, v, cls = '') => totals.append(el('div.tot-row', { class: cls }, el('dt', {}, l), el('dd.money', {}, formatMoney(v))));
    row('Amount to apply', toApply);
    row('Amount applied', sumApplied);
    if (toApply - sumApplied > 0) row(ar ? 'Amount to credit' : 'Unapplied', toApply - sumApplied, 'tot-total');
    head.set(doc.amount);
  }

  function paint() {
    clear(tableBox);
    allCb = null;
    rowRefs = new Map();
    if (!doc.contactId) {
      tableBox.append(el('div.empty', {}, el('p', {}, ar ? 'Choose a customer to see their open invoices.' : 'Choose a vendor to see their open bills.')));
    } else if (!rows.length) {
      tableBox.append(el('div.empty', {}, el('p', {}, ar ? 'This customer has no open invoices. The payment will be kept as a credit.' : 'This vendor has no open bills. The payment will be kept as a credit.')));
    } else tableBox.append(docTable());
    clear(creditBox);
    const ct = creditTable();
    if (ct) creditBox.append(ct);
    paintTotals();
  }

  loadRows();
  if (preselect) {
    const r = rows.find((x) => x.txn.id === preselect);
    if (r) { applied.set(r.txn.id, r.open); doc.amount = r.open; amount.value = r.open; }
  }
  paint();

  const attachments = attachmentsBlock(doc, touch);
  const memo = textArea({ value: doc.memo || '', rows: 2, ariaLabel: 'Memo' });
  memo.addEventListener('input', () => { doc.memo = memo.value; touch(); });

  const body = el('div.doc-sheet', {},
    el('div.doc-band', {},
      el('div.doc-party', {}, field(ar ? 'Customer' : 'Vendor', contact, { required: true })),
      el('div.doc-side', {}, head.node, el('div.doc-meta', {},
        field('Payment date', date, { required: true }),
        field('Payment method', method),
        field(ar ? 'Reference no.' : 'Ref no.', ref),
        el('div', {}, field(ar ? 'Deposit to' : 'Payment account', account, { required: true }), bal),
        field(ar ? 'Amount received' : 'Amount', amount)))),
    doc.voided ? el('div.banner.banner-info', {}, el('strong', {}, 'This payment is void.')) : null,
    el('section.doc-lines', { 'aria-label': ar ? 'Outstanding transactions' : 'Bills' }, el('h2.doc-section-title', {}, ar ? 'Outstanding transactions' : 'Bills'), tableBox),
    creditBox,
    el('div.doc-bottom', {}, el('div.doc-notes', {}, field('Memo', memo), attachments), totals));

  async function save(mode) {
    const credits = [...creditUse.entries()].filter(([, v]) => v > 0);
    // Credits go first: apply each to the ticked documents, oldest first,
    // then the money covers the rest.
    const remaining = new Map(applied);
    const creditWrites = [];
    for (const [cid, amt] of credits) {
      let left = amt;
      const credit = store.txn(cid);
      const list = [...(credit.applied || [])];
      for (const r of rows) {
        const want = remaining.get(r.txn.id) || 0;
        if (left <= 0 || want <= 0) continue;
        const take = Math.min(left, want);
        list.push({ txnId: r.txn.id, amount: take });
        remaining.set(r.txn.id, want - take);
        left -= take;
      }
      creditWrites.push({ ...credit, applied: list });
    }
    const record = { ...doc, applied: [...remaining.entries()].filter(([, v]) => v > 0).map(([txnId, amount]) => ({ txnId, amount })) };
    // Check everything before writing anything, so a refused payment never
    // leaves its credits applied.
    for (const c of creditWrites) store.assertTxn(c);
    // Only credits, and no money: there is no payment to save. A saved
    // payment emptied this way is still validated (and refused) as one below.
    if (!existing && record.amount <= 0 && !record.applied.length) {
      if (!creditWrites.length) throw new Error('Enter an amount or choose what to apply it to.');
      for (const c of creditWrites) store.saveTxn(c);
      toast('Credits applied');
      dirty = false;
      if (mode === 'new') { frame.close(); openPaymentForm({ type }); }
      else if (mode === 'stay') {
        // Start over from the books as they are now, so saving again cannot
        // apply the same credits a second time.
        applied.clear();
        loadRows();
        doc.amount = 0;
        amount.value = null;
        amountTouched = false;
        paint();
      }
      return true;
    }
    const sumApplied = record.applied.reduce((a, b) => a + b.amount, 0);
    if (sumApplied > record.amount) throw new Error('The payment is less than what is applied. Lower a payment or raise the amount.');
    store.assertTxn(record);
    for (const c of creditWrites) store.saveTxn(c);
    const saved = store.saveTxn(record);
    dirty = false;
    attachments.commit();
    toast(`${meta.label} saved`);
    onSaved?.(saved);
    if (mode === 'new') { frame.close(); openPaymentForm({ type }); }
    else if (mode === 'stay') { frame.close(); openPaymentForm({ type, id: saved.id }); }
    return true;
  }

  const frame = openFrame({
    title: ar ? (existing ? 'Payment' : 'Record payment') : existing ? 'Bill payment' : 'Pay bill',
    body,
    // A void transaction is kept for the record; it cannot be edited.
    readOnly: !!existing?.voided,
    onSave: save,
    isDirty: () => dirty,
    history: recentMenu(type, async (tid) => { if (await frame.requestClose()) openPaymentForm({ type, id: tid }); }),
    more: txnMoreActions(existing, { reopen: (t) => openPaymentForm({ type: t.type, id: t.id }), close: () => frame.requestClose() }),
  });
  return frame;
}

/**
 * Pay bills: every open bill across vendors, one payment account and date,
 * one bill payment per vendor.
 */
export function openPayBills() {
  const bills = [];
  const info = store.docInfo();
  for (const t of store.txns.values()) {
    if (t.type !== 'bill' || t.voided) continue;
    const open = info.open.get(t.id) || 0;
    if (open > 0) bills.push({ txn: t, open });
  }
  bills.sort((a, b) => (a.txn.dueDate || a.txn.date).localeCompare(b.txn.dueDate || b.txn.date));
  const pay = new Map();
  let accountId = store.accountsOfType('bank')[0]?.id || null;
  let date = today();
  let method = 'Check';
  let dirty = false;
  const head = headline('Total payment amount');
  const acct = accountPicker({ value: accountId, types: ['bank', 'creditCard'], ariaLabel: 'Payment account', onChange: (v) => { accountId = v; paintBal(); } });
  const bal = el('div.field-hint');
  const paintBal = () => { bal.textContent = accountId ? `Balance ${formatMoney(store.accountBalance(accountId))}` : ''; };
  paintBal();
  const dateIn = dateInput({ value: date, ariaLabel: 'Payment date', onChange: (v) => { date = v; } });
  const methodSel = selectInput({ options: PAYMENT_METHODS.map((m) => [m, m]), value: method, ariaLabel: 'Payment method', onChange: (v) => { method = v; } });
  const filterSel = selectInput({ options: [['all', 'All open bills'], ['overdue', 'Overdue only'], ['due7', 'Due in the next 7 days']], value: 'all', ariaLabel: 'Filter', onChange: () => paint() });
  const tableBox = el('div');
  const totalLine = el('dl.doc-totals');

  function paint() {
    clear(tableBox);
    const now = today();
    const f = filterSel.value;
    const list = bills.filter((b) => f === 'all' || (f === 'overdue' ? (b.txn.dueDate || b.txn.date) < now : (b.txn.dueDate || b.txn.date) <= addDaysISO(now, 7)));
    // Only bills on screen get paid.
    const visible = new Set(list.map((b) => b.txn.id));
    for (const id of [...pay.keys()]) if (!visible.has(id)) pay.delete(id);
    if (!list.length) {
      tableBox.append(el('div.empty', {}, el('h2', {}, 'No open bills'), el('p', {}, 'Bills you enter show up here until they are paid.')));
      paintTotal();
      return;
    }
    const table = el('table.grid.apply-table', { 'aria-label': 'Open bills' });
    table.append(el('thead', {}, el('tr', {},
      el('th.check-cell', { scope: 'col' }, el('span.sr-only', {}, 'Pay')),
      el('th', { scope: 'col' }, 'Vendor'), el('th', { scope: 'col' }, 'Ref no.'), el('th', { scope: 'col' }, 'Due date'),
      el('th.num', { scope: 'col' }, 'Open balance'), el('th.num', { scope: 'col', style: { width: '150px' } }, 'Payment'))));
    const tb = el('tbody');
    for (const b of list) {
      const overdue = (b.txn.dueDate || b.txn.date) < now;
      const cb = el('input', { type: 'checkbox', checked: (pay.get(b.txn.id) || 0) > 0, 'aria-label': `Pay bill from ${store.contactName(b.txn.contactId)}` });
      const amt = moneyInput({ value: pay.get(b.txn.id) || null, ariaLabel: `Payment for bill from ${store.contactName(b.txn.contactId)}`, onChange: (v, final) => {
        const capped = Math.min(v || 0, b.open);
        pay.set(b.txn.id, capped);
        if (final && (v || 0) > b.open) amt.value = capped;
        cb.checked = capped > 0;
        dirty = true;
        paintTotal();
      } });
      cb.addEventListener('change', () => { pay.set(b.txn.id, cb.checked ? b.open : 0); amt.value = cb.checked ? b.open : null; dirty = true; paintTotal(); });
      tb.append(el('tr', {},
        el('td.check-cell', {}, cb),
        el('td', {}, store.contactName(b.txn.contactId)),
        el('td', {}, el('a', { href: `#/txn/${b.txn.id}` }, b.txn.num || 'Bill')),
        el('td', {}, formatDate(b.txn.dueDate || b.txn.date), overdue ? el('span.badge.badge-negative', { style: { marginLeft: '8px' } }, 'Overdue') : null),
        el('td.num', {}, formatMoney(b.open)),
        el('td.num', {}, amt.root)));
    }
    table.append(tb);
    tableBox.append(el('div.table-wrap', {}, el('div.table-scroll', {}, table)));
    paintTotal();
  }

  function paintTotal() {
    const total = [...pay.values()].reduce((a, b) => a + b, 0);
    head.set(total);
    clear(totalLine);
    totalLine.append(el('div.tot-row.tot-total', {}, el('dt', {}, 'Total payment'), el('dd.money', {}, formatMoney(total))));
  }
  paint();

  const body = el('div.doc-sheet', {},
    el('div.doc-band', {},
      el('div.doc-party', {}, el('div', {}, field('Payment account', acct, { required: true }), bal), field('Show', filterSel)),
      el('div.doc-side', {}, head.node, el('div.doc-meta', {}, field('Payment date', dateIn), field('Payment method', methodSel)))),
    el('section.doc-lines', { 'aria-label': 'Open bills' }, tableBox),
    el('div.doc-bottom', {}, el('div'), totalLine));

  const frame = openFrame({
    title: 'Pay bills',
    body,
    hideSaveNew: true,
    isDirty: () => dirty,
    onSave: () => {
      if (!accountId) throw new Error('Choose the account to pay from.');
      const byVendor = new Map();
      for (const [billId, amt] of pay) {
        if (amt <= 0) continue;
        const b = store.txn(billId);
        if (!byVendor.has(b.contactId)) byVendor.set(b.contactId, []);
        byVendor.get(b.contactId).push({ txnId: billId, amount: amt });
      }
      if (!byVendor.size) throw new Error('Choose at least one bill to pay.');
      let n = 0;
      for (const [vendorId, list] of byVendor) {
        store.saveTxn({ type: 'billPayment', date, contactId: vendorId, accountId, paymentMethod: method, amount: list.reduce((a, b) => a + b.amount, 0), applied: list });
        n++;
      }
      dirty = false;
      toast(`${n} bill payment${n > 1 ? 's' : ''} recorded`);
      frame.close();
      return true;
    },
  });
  return frame;
}

function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
