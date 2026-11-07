/** Payments received, and the "record payment" dialog used everywhere. */
import { h, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { pageHeader, stat, searchBox, dataTable, emptyState, field, textInput, select, moneyInput, textarea, moreButton } from '../ui/components.js';
import { formDialog, confirmDialog } from '../ui/dialog.js';
import { openMenu } from '../ui/menu.js';
import { toast } from '../ui/toast.js';
import { clientName, matches, pluralize } from '../core/format.js';
import { formatDate, startOfMonth, addMonths, endOfMonth, addDays } from '../core/dates.js';
import { PAYMENT_METHODS } from '../core/settings.js';
import { invoiceBalance, invoiceStatus } from '../core/status.js';
import { recordPayment } from '../core/workflow.js';
import { money, clientPicker, rememberSort, saveSort } from './common.js';
import { downloadText, toCSV } from '../core/csv.js';
import { parseMoney } from '../core/money.js';

const methodLabel = (id) => PAYMENT_METHODS.find((m) => m.id === id)?.label || 'Other';

export function render(ctx) {
  const store = app.store;
  const paging = {};
  const state = { q: ctx.query.q || '', range: ['all', 'month', 'last', 'd30'].includes(ctx.query.range) ? ctx.query.range : 'all', sort: rememberSort('payments', { id: 'date', dir: 'desc' }) };
  const statsNode = h('div');
  const tableNode = h('div');
  // Built once: redrawing them while someone types or picks would drop focus.
  const toolbar = h(
    'div.toolbar',
    searchBox({ value: state.q, placeholder: 'Search client, reference or invoice', label: 'Search payments', onInput: (v) => ((state.q = v), draw()) }),
    h('div.grow'),
    select({
      value: state.range,
      cls: 'sm',
      'aria-label': 'Date range',
      style: { width: 'auto' },
      options: [
        { value: 'all', label: 'All time' },
        { value: 'month', label: 'This month' },
        { value: 'last', label: 'Last month' },
        { value: 'd30', label: 'Past 30 days' },
      ],
      onChange: (e) => ((state.range = e.target.value), draw()),
    }),
  );
  const body = h('div', statsNode, h('section.card.list-card', { 'aria-label': 'Payments list' }, toolbar, tableNode));

  const draw = () => {
    const today = app.today();
    const all = store.all('payments').filter((p) => !p.voided);
    const sum = (list) => list.reduce((s, p) => s + (p.amount || 0), 0);
    const monthStart = startOfMonth(today);
    const lastStart = startOfMonth(addMonths(today, -1));
    const thisMonth = all.filter((p) => p.date >= monthStart);
    const lastMonth = all.filter((p) => p.date >= lastStart && p.date <= endOfMonth(lastStart));
    const last30 = all.filter((p) => p.date >= addDays(today, -30));
    const payments = store.all('payments');
    const owed = store.all('invoices').reduce((s, i) => (['awaiting_payment', 'past_due'].includes(invoiceStatus(i, today, payments)) ? s + Math.max(0, invoiceBalance(i, payments)) : s), 0);

    const ranges = { all: () => true, month: (p) => p.date >= monthStart, last: (p) => p.date >= lastStart && p.date <= endOfMonth(lastStart), d30: (p) => p.date >= addDays(today, -30) };
    const rows = all.filter((p) => ranges[state.range](p) && (!state.q || matches(`${clientName(lookup.client(p.clientId))} ${p.reference || ''} ${methodLabel(p.method)} #${store.get('invoices', p.invoiceId)?.number || ''}`, state.q)));

    keepFocus(statsNode, () =>
      statsNode.replaceChildren(
        h(
          'div.stats.list-stats',
          stat({ label: 'This month', value: money(sum(thisMonth)), sub: pluralize(thisMonth.length, 'payment') }),
          stat({ label: 'Last month', value: money(sum(lastMonth)), sub: pluralize(lastMonth.length, 'payment') }),
          stat({ label: 'Past 30 days', value: money(sum(last30)), sub: 'Collected' }),
          stat({ label: 'Still owed', value: money(owed), sub: 'Open invoices', href: '#/invoices?status=open', tone: owed ? 'warning' : null }),
        ),
      ),
    );
    keepFocus(tableNode, () =>
      tableNode.replaceChildren(
        dataTable({
          caption: 'Payments',
          rows,
          paging,
          pagingKey: JSON.stringify([state.q, state.range, state.sort]),
          sort: state.sort,
          onSort: (s) => ((state.sort = s), saveSort('payments', s), draw()),
          columns: [
            { id: 'date', label: 'Date', sort: (p) => p.date, render: (p) => h('span.nowrap', formatDate(p.date)) },
            { id: 'client', label: 'Client', sort: (p) => clientName(lookup.client(p.clientId)), cls: 'primary-cell', render: (p) => h('a', { href: `#/clients/${p.clientId}` }, clientName(lookup.client(p.clientId))) },
            { id: 'invoice', label: 'Invoice', render: (p) => (p.invoiceId && store.get('invoices', p.invoiceId) ? h('a', { href: `#/invoices/${p.invoiceId}` }, `#${store.get('invoices', p.invoiceId).number}`) : h('span.subtle', 'Unapplied')) },
            { id: 'method', label: 'Method', sort: (p) => methodLabel(p.method), render: (p) => h('span', methodLabel(p.method), p.reference ? h('span.sub', { style: { display: 'block' } }, p.reference) : null) },
            { id: 'amount', label: 'Amount', align: 'r', sort: (p) => p.amount, render: (p) => h('span.money', { style: { fontWeight: '600' } }, money(p.amount)) },
            { id: 'actions', label: '', srLabel: 'Actions', align: 'r', render: (p) => moreButton((btn) => paymentMenu(btn, p), 'Payment actions') },
          ],
          mobile: (p) =>
            h(
              'div.mobile-row',
              h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', clientName(lookup.client(p.clientId))), h('div.m-sub', `${formatDate(p.date)} · ${methodLabel(p.method)}`)),
              h('div.m-end', h('span.money', { style: { fontWeight: '700' } }, money(p.amount)), moreButton((btn) => paymentMenu(btn, p), 'Payment actions')),
            ),
          empty: all.length
            ? emptyState({ compact: true, icon: 'search', title: 'No matching payments', headingLevel: 3 })
            : emptyState({ icon: 'wallet', title: 'No payments yet', text: 'Record payments against invoices to track what has been collected.', actions: [h('button.btn.primary', { type: 'button', onClick: () => recordPaymentDialog() }, icon('plus', 16), 'Record payment')], headingLevel: 3 }),
        }),
      ),
    );
  };
  draw();
  ctx.onDispose(store.subscribe((c) => (c.has('payments') || c.has('invoices') || c.has('clients')) && draw()));

  const exportCSV = () => {
    const rows = [['Date', 'Client', 'Invoice', 'Method', 'Reference', 'Amount']];
    for (const p of store.all('payments').filter((x) => !x.voided)) rows.push([p.date, clientName(lookup.client(p.clientId)), store.get('invoices', p.invoiceId)?.number || '', methodLabel(p.method), p.reference || '', (p.amount / 100).toFixed(2)]);
    downloadText(`payments-${app.today()}.csv`, toCSV(rows));
  };

  return {
    node: h(
      'div.page',
      pageHeader({
        title: 'Payments',
        actions: [moreButton((btn) => openMenu(btn, [{ label: 'Export payments to CSV', icon: 'file-down', run: exportCSV }])), h('button.btn.primary', { type: 'button', onClick: () => recordPaymentDialog() }, icon('plus', 16), 'Record payment')],
      }),
      body,
    ),
    title: 'Payments',
  };
}

function paymentMenu(anchor, p) {
  const store = app.store;
  openMenu(
    anchor,
    [
      { label: 'Edit payment', icon: 'pencil', run: () => recordPaymentDialog({ payment: p }) },
      {
        label: 'Delete payment',
        icon: 'trash',
        danger: true,
        run: async () => {
          if (!(await confirmDialog({ title: 'Delete this payment?', message: `${money(p.amount)} from ${clientName(lookup.client(p.clientId))} will be removed and the invoice balance goes back up.`, confirmLabel: 'Delete payment', danger: true }))) return;
          const removed = store.remove('payments', p.id);
          toast('Payment deleted', { action: { label: 'Undo', run: () => store.restore('payments', removed) } });
        },
      },
    ],
    { align: 'end' },
  );
}

/**
 * Record (or edit) a payment. Options: { invoiceId, clientId, payment }.
 * With only a client, the payment can be applied to one of their open
 * invoices.
 */
export async function recordPaymentDialog({ invoiceId = null, clientId = null, payment = null } = {}) {
  const store = app.store;
  const today = app.today();
  const payments = store.all('payments');
  let cid = payment?.clientId || clientId || (invoiceId ? store.get('invoices', invoiceId)?.clientId : null);
  let iid = payment?.invoiceId ?? invoiceId;

  const amount = moneyInput({ name: 'amount', cents: payment?.amount || 0, required: true });
  const invSelectWrap = h('div');
  const openInvoicesFor = (c) => store.all('invoices').filter((i) => i.clientId === c && (i.id === iid || ['awaiting_payment', 'past_due', 'draft'].includes(invoiceStatus(i, today, payments))));
  const drawInvoices = () => {
    if (!cid) return invSelectWrap.replaceChildren();
    const list = openInvoicesFor(cid);
    const sel = select({
      name: 'invoice',
      value: iid || '',
      options: [{ value: '', label: 'Do not apply to an invoice' }, ...list.map((i) => ({ value: i.id, label: `Invoice #${i.number}, ${money(Math.max(0, invoiceBalance(i, payments) + (payment && payment.invoiceId === i.id ? payment.amount : 0)))} due` }))],
    });
    sel.addEventListener('change', () => {
      iid = sel.value || null;
      const inv = store.get('invoices', iid);
      if (inv && !payment) amount.cents = Math.max(0, invoiceBalance(inv, payments));
    });
    invSelectWrap.replaceChildren(field('Apply to invoice', sel));
  };
  if (iid && !payment) {
    const inv = store.get('invoices', iid);
    if (inv) amount.cents = Math.max(0, invoiceBalance(inv, payments));
  }
  drawInvoices();

  const picker = cid
    ? h('div.picked-client', h('div.grow', h('div', { style: { fontWeight: '600' } }, clientName(lookup.client(cid)))))
    : clientPicker({
        value: null,
        onChange: (c) => {
          cid = c?.id || null;
          iid = null;
          drawInvoices();
        },
      });

  const result = await formDialog({
    title: payment ? 'Edit payment' : 'Record payment',
    submitLabel: payment ? 'Save payment' : 'Record payment',
    body: h(
      'div.stack',
      h('div.field', h('span.field-label', 'Client'), picker),
      invSelectWrap,
      h(
        'div.form-grid',
        field('Amount', amount),
        field('Date', textInput({ name: 'date', type: 'date', value: payment?.date || today, required: true })),
        field('Method', select({ name: 'method', value: payment?.method || 'card', options: PAYMENT_METHODS.map((m) => ({ value: m.id, label: m.label })) })),
        field('Reference', textInput({ name: 'reference', value: payment?.reference || '', placeholder: 'Check number, transaction ID' })),
        field('Notes', textarea({ name: 'notes', value: payment?.notes || '', rows: 2 }), { span2: true }),
      ),
    ),
    onSubmit: (fd) => {
      const cents = parseMoney(String(fd.get('amount') || ''));
      if (!cid) {
        toast('Choose a client first', { type: 'error' });
        return false;
      }
      if (!cents || cents <= 0) {
        toast('Enter an amount greater than zero', { type: 'error' });
        return false;
      }
      const data = { invoiceId: iid || null, clientId: cid, amount: cents, method: String(fd.get('method')), date: String(fd.get('date')), reference: String(fd.get('reference') || ''), notes: String(fd.get('notes') || '') };
      if (payment) store.put('payments', { ...payment, ...data });
      else recordPayment(store, data);
      const inv = iid ? store.get('invoices', iid) : null;
      const left = inv ? invoiceBalance(inv, store.all('payments')) : null;
      toast(payment ? 'Payment updated' : left !== null && left <= 0 ? `Payment recorded. Invoice #${inv.number} is paid in full.` : `Payment of ${money(cents)} recorded`);
      return true;
    },
  });
  return result;
}
