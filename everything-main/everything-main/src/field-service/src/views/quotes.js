/** Quotes list. */
import { h } from '../ui/dom.js';
import { app, lookup } from '../app.js';
import { statusPill } from '../ui/components.js';
import { renderList } from './listview.js';
import { quoteStatus } from '../core/status.js';
import { computeTotals } from '../core/totals.js';
import { clientName, formatAddress, pluralize } from '../core/format.js';
import { addDays, formatDate, localDate } from '../core/dates.js';
import { clientLink, money } from './common.js';
import { formatMoneyShort } from '../core/money.js';

const OPEN = ['draft', 'awaiting_response', 'changes_requested', 'approved'];

export function render(ctx) {
  const total = (q) => computeTotals(q).total;
  return renderList(ctx, {
    coll: 'quotes',
    title: 'Quotes',
    newHref: '#/quotes/new',
    newLabel: 'New quote',
    searchPlaceholder: 'Search number, title or client',
    defaultSort: { id: 'number', dir: 'desc' },
    statusOf: (q) => quoteStatus(q),
    filters: [
      { id: 'open', label: 'All open', match: (s) => OPEN.includes(s) },
      { id: 'draft', label: 'Draft', match: (s) => s === 'draft' },
      { id: 'awaiting_response', label: 'Awaiting response', match: (s) => s === 'awaiting_response' },
      { id: 'changes_requested', label: 'Changes requested', match: (s) => s === 'changes_requested' },
      { id: 'approved', label: 'Approved', match: (s) => s === 'approved' },
      { id: 'converted', label: 'Converted', match: (s) => s === 'converted' },
      { id: 'archived', label: 'Archived', match: (s) => s === 'archived' },
      { id: 'all', label: 'All', match: () => true },
    ],
    stats: (all, statusOf) => {
      const since = addDays(app.today(), -30);
      const recent = all.filter((q) => localDate(q.sentAt) >= since);
      const converted = recent.filter((q) => ['approved', 'converted'].includes(statusOf(q)));
      const sum = (list) => list.reduce((s, q) => s + total(q), 0);
      const awaiting = all.filter((q) => statusOf(q) === 'awaiting_response');
      const approved = all.filter((q) => statusOf(q) === 'approved');
      return [
        { label: 'Awaiting response', value: formatMoneyShort(sum(awaiting)), sub: pluralize(awaiting.length, 'quote'), filter: 'awaiting_response' },
        { label: 'Approved, not scheduled', value: formatMoneyShort(sum(approved)), sub: pluralize(approved.length, 'quote'), filter: 'approved', tone: approved.length ? 'success' : null },
        { label: 'Conversion rate', value: recent.length ? `${Math.round((converted.length / recent.length) * 100)}%` : 'None yet', sub: 'Sent in the past 30 days' },
        { label: 'Sent', value: String(recent.length), sub: `Past 30 days, ${formatMoneyShort(sum(recent))}` },
      ];
    },
    searchText: (q) => `#${q.number} ${q.title || ''} ${clientName(lookup.client(q.clientId))}`,
    columns: (statusOf) => [
      { id: 'client', label: 'Client', sort: (q) => clientName(lookup.client(q.clientId)).toLowerCase(), cls: 'primary-cell', render: (q) => h('span', clientName(lookup.client(q.clientId)), h('span.sub', { style: { display: 'block' } }, formatAddress(lookup.property(lookup.client(q.clientId), q.propertyId)) || '')) },
      { id: 'number', label: 'Quote', sort: (q) => q.number, render: (q) => h('span', h('span', { style: { fontWeight: '600' } }, `#${q.number}`), h('span.sub', { style: { display: 'block' } }, q.title || 'Untitled')) },
      { id: 'created', label: 'Created', sort: (q) => q.createdAt || '', render: (q) => h('span.nowrap', formatDate(q.createdAt)) },
      { id: 'status', label: 'Status', sort: (q) => statusOf(q), render: (q) => statusPill(statusOf(q)) },
      { id: 'total', label: 'Total', align: 'r', sort: (q) => total(q), render: (q) => h('span.money', money(total(q))) },
    ],
    mobile: (q, s) =>
      h(
        'a.mobile-row',
        { href: `#/quotes/${q.id}` },
        h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', clientName(lookup.client(q.clientId))), h('div.m-sub', `#${q.number} · ${q.title || 'Untitled'}`)),
        h('div.m-end', statusPill(s), h('span.money', { style: { fontSize: '13px', fontWeight: '600' } }, money(total(q)))),
      ),
    empty: { icon: 'file-pen', title: 'Create your first quote', text: 'Quotes show clients exactly what the work costs. Once approved, turn one into a job in a click.' },
  });
}
