/** Requests list. */
import { h } from '../ui/dom.js';
import { app, lookup } from '../app.js';
import { statusPill } from '../ui/components.js';
import { renderList } from './listview.js';
import { requestStatus } from '../core/status.js';
import { clientName, formatAddress } from '../core/format.js';
import { formatDate, addDays, timeAgo, localDate } from '../core/dates.js';

const OPEN = ['new', 'assessment_scheduled', 'assessment_overdue', 'assessment_complete'];

export function render(ctx) {
  return renderList(ctx, {
    coll: 'requests',
    title: 'Requests',
    newHref: '#/requests/new',
    newLabel: 'New request',
    searchPlaceholder: 'Search title, details or client',
    defaultSort: { id: 'received', dir: 'desc' },
    statusOf: (r) => requestStatus(r, app.today()),
    filters: [
      { id: 'open', label: 'Open', match: (s) => OPEN.includes(s) },
      { id: 'new', label: 'New', match: (s) => s === 'new' },
      { id: 'assessment_scheduled', label: 'Assessment scheduled', match: (s) => s === 'assessment_scheduled' },
      { id: 'assessment_overdue', label: 'Overdue', match: (s) => s === 'assessment_overdue' },
      { id: 'assessment_complete', label: 'Assessment complete', match: (s) => s === 'assessment_complete' },
      { id: 'converted', label: 'Converted', match: (s) => s === 'converted' },
      { id: 'archived', label: 'Archived', match: (s) => s === 'archived' },
      { id: 'all', label: 'All', match: () => true },
    ],
    stats: (all, statusOf) => {
      const since = addDays(app.today(), -30);
      const recent = all.filter((r) => localDate(r.createdAt) >= since);
      const converted = recent.filter((r) => statusOf(r) === 'converted');
      return [
        { label: 'New', value: String(all.filter((r) => statusOf(r) === 'new').length), sub: 'Waiting for a reply', filter: 'new' },
        { label: 'Assessments', value: String(all.filter((r) => statusOf(r) === 'assessment_scheduled').length), sub: 'Scheduled', filter: 'assessment_scheduled' },
        { label: 'Overdue', value: String(all.filter((r) => statusOf(r) === 'assessment_overdue').length), sub: 'Assessment date passed', filter: 'assessment_overdue', tone: all.some((r) => statusOf(r) === 'assessment_overdue') ? 'danger' : null },
        { label: 'Conversion rate', value: recent.length ? `${Math.round((converted.length / recent.length) * 100)}%` : 'None yet', sub: 'Past 30 days' },
      ];
    },
    searchText: (r) => `#${r.number} ${r.title || ''} ${r.details || ''} ${clientName(lookup.client(r.clientId))}`,
    columns: (statusOf) => [
      { id: 'client', label: 'Client', sort: (r) => clientName(lookup.client(r.clientId)).toLowerCase(), cls: 'primary-cell', render: (r) => h('span', clientName(lookup.client(r.clientId)), h('span.sub', { style: { display: 'block' } }, formatAddress(lookup.property(lookup.client(r.clientId), r.propertyId)) || '')) },
      { id: 'title', label: 'Request', sort: (r) => r.title || '', render: (r) => h('span', h('span', { style: { fontWeight: '600' } }, r.title || 'Untitled'), h('span.sub', { style: { display: 'block' } }, `#${r.number || ''} · ${r.source || ''}`)) },
      { id: 'received', label: 'Received', sort: (r) => r.createdAt || '', render: (r) => h('span.nowrap', timeAgo(r.createdAt)) },
      { id: 'assessment', label: 'Assessment', sort: (r) => r.assessment?.date || '', render: (r) => (r.assessment?.date ? h('span.nowrap', formatDate(r.assessment.date)) : h('span.subtle', 'None')) },
      { id: 'status', label: 'Status', sort: (r) => statusOf(r), render: (r) => statusPill(statusOf(r)) },
    ],
    mobile: (r, s) =>
      h(
        'a.mobile-row',
        { href: `#/requests/${r.id}` },
        h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', r.title || 'Untitled'), h('div.m-sub', `${clientName(lookup.client(r.clientId))} · ${timeAgo(r.createdAt)}`)),
        h('div.m-end', statusPill(s)),
      ),
    empty: { icon: 'inbox', title: 'No requests yet', text: 'Requests capture new work as it comes in. Schedule an assessment, then turn it into a quote or a job.' },
  });
}
