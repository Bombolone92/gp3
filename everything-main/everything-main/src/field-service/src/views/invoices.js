/** Invoices list. */
import { h } from '../ui/dom.js';
import { app, lookup } from '../app.js';
import { statusPill } from '../ui/components.js';
import { openMenu } from '../ui/menu.js';
import { renderList } from './listview.js';
import { invoiceStatus, invoiceBalance } from '../core/status.js';
import { computeTotals } from '../core/totals.js';
import { clientName, pluralize } from '../core/format.js';
import { formatDate, diffDays, addDays } from '../core/dates.js';
import { money } from './common.js';
import { formatMoneyShort } from '../core/money.js';
import { downloadText, toCSV } from '../core/csv.js';
import { statusLabel } from '../core/status.js';

export function render(ctx) {
  const store = app.store;
  const total = (i) => computeTotals(i).total;
  const balance = (i) => invoiceBalance(i, store.all('payments'));
  // Read the date on each redraw: the list refreshes past midnight.
  return renderList(ctx, {
    coll: 'invoices',
    title: 'Invoices',
    newHref: '#/invoices/new',
    newLabel: 'New invoice',
    watch: ['payments'],
    searchPlaceholder: 'Search number, subject or client',
    defaultSort: { id: 'number', dir: 'desc' },
    statusOf: (i) => invoiceStatus(i, app.today(), store.all('payments')),
    filters: [
      { id: 'all', label: 'All', match: () => true },
      { id: 'draft', label: 'Draft', match: (s) => s === 'draft' },
      { id: 'open', label: 'Unpaid', match: (s) => s === 'awaiting_payment' || s === 'past_due' },
      { id: 'past_due', label: 'Past due', match: (s) => s === 'past_due' },
      { id: 'paid', label: 'Paid', match: (s) => s === 'paid' },
      { id: 'bad_debt', label: 'Bad debt', match: (s) => s === 'bad_debt' },
    ],
    stats: (all, statusOf) => {
      const by = (pred) => all.filter((i) => pred(statusOf(i)));
      const pastDue = by((s) => s === 'past_due');
      const awaiting = by((s) => s === 'awaiting_payment');
      const drafts = by((s) => s === 'draft');
      const sumBal = (list) => list.reduce((s, i) => s + Math.max(0, balance(i)), 0);
      const issued30 = all.filter((i) => i.sentAt && i.issueDate >= addDays(app.today(), -30));
      return [
        { label: 'Past due', value: formatMoneyShort(sumBal(pastDue)), sub: pluralize(pastDue.length, 'invoice'), filter: 'past_due', tone: pastDue.length ? 'danger' : null },
        { label: 'Awaiting payment', value: formatMoneyShort(sumBal(awaiting)), sub: pluralize(awaiting.length, 'invoice'), filter: 'open' },
        { label: 'Drafts', value: formatMoneyShort(drafts.reduce((s, i) => s + total(i), 0)), sub: `${drafts.length} not sent`, filter: 'draft' },
        { label: 'Issued', value: formatMoneyShort(issued30.reduce((s, i) => s + total(i), 0)), sub: `Past 30 days, ${pluralize(issued30.length, 'invoice')}` },
      ];
    },
    searchText: (i) => `#${i.number} ${i.subject || ''} ${clientName(lookup.client(i.clientId))}`,
    columns: (statusOf) => [
      { id: 'client', label: 'Client', sort: (i) => clientName(lookup.client(i.clientId)).toLowerCase(), cls: 'primary-cell', render: (i) => clientName(lookup.client(i.clientId)) },
      { id: 'number', label: 'Invoice', sort: (i) => i.number, render: (i) => h('span', h('span', { style: { fontWeight: '600' } }, `#${i.number}`), h('span.sub', { style: { display: 'block' } }, i.subject || '')) },
      { id: 'due', label: 'Due date', sort: (i) => i.dueDate || '', render: (i) => {
        const s = statusOf(i);
        const late = s === 'past_due' ? diffDays(i.dueDate, app.today()) : 0;
        return h('span', h('span.nowrap', formatDate(i.dueDate)), late ? h('span.sub', { style: { display: 'block', color: 'var(--danger)' } }, `${late} day${late === 1 ? '' : 's'} late`) : null);
      } },
      { id: 'status', label: 'Status', sort: (i) => statusOf(i), render: (i) => statusPill(statusOf(i)) },
      { id: 'total', label: 'Total', align: 'r', sort: (i) => total(i), render: (i) => h('span.money', money(total(i))) },
      { id: 'balance', label: 'Balance', align: 'r', sort: (i) => balance(i), render: (i) => h('span.money', { style: { fontWeight: '600' } }, money(Math.max(0, balance(i)))) },
    ],
    mobile: (i, s) =>
      h(
        'a.mobile-row',
        { href: `#/invoices/${i.id}` },
        h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', clientName(lookup.client(i.clientId))), h('div.m-sub', `#${i.number} · Due ${formatDate(i.dueDate)}`)),
        // A paid invoice's balance is always zero, so show what it was for instead.
        h('div.m-end', statusPill(s), h('span.money', { style: { fontSize: '13px', fontWeight: '600' } }, money(s === 'paid' ? total(i) : Math.max(0, balance(i))))),
      ),
    moreMenu: (btn) =>
      openMenu(btn, [
        {
          label: 'Export invoices to CSV',
          icon: 'file-down',
          run: () => {
            const payments = store.all('payments');
            const today = app.today();
            const rows = [['Number', 'Client', 'Subject', 'Issued', 'Due', 'Status', 'Total', 'Balance']];
            for (const i of store.all('invoices')) rows.push([i.number, clientName(lookup.client(i.clientId)), i.subject || '', i.issueDate, i.dueDate, statusLabel(invoiceStatus(i, today, payments)), (total(i) / 100).toFixed(2), (Math.max(0, invoiceBalance(i, payments)) / 100).toFixed(2)]);
            downloadText(`invoices-${today}.csv`, toCSV(rows));
          },
        },
      ]),
    empty: { icon: 'receipt-text', title: 'Create your first invoice', text: 'Bill clients for completed work and track what is paid and what is still owed.' },
  });
}

