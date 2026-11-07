/** Jobs list. */
import { h } from '../ui/dom.js';
import { app, lookup } from '../app.js';
import { statusPill } from '../ui/components.js';
import { renderList } from './listview.js';
import { jobStatus, openVisits, amountToInvoice } from '../core/status.js';
import { computeTotals } from '../core/totals.js';
import { clientName, formatAddress, pluralize } from '../core/format.js';
import { formatDate, relativeDay } from '../core/dates.js';
import { describeSchedule } from '../core/recurrence.js';
import { money, teamAvatars } from './common.js';
import { formatMoneyShort } from '../core/money.js';

const ACTIVE = ['late', 'today', 'upcoming', 'unscheduled', 'active'];

function nextVisit(job) {
  return openVisits(job).find((v) => v.date) || null;
}

export function render(ctx) {
  const total = (j) => computeTotals(j).total;
  const today = app.today();
  return renderList(ctx, {
    coll: 'jobs',
    title: 'Jobs',
    newHref: '#/jobs/new',
    newLabel: 'New job',
    watch: ['invoices'],
    searchPlaceholder: 'Search number, title or client',
    defaultSort: { id: 'next', dir: 'asc' },
    statusOf: (j) => jobStatus(j, app.today(), app.store.all('invoices')),
    filters: [
      { id: 'active', label: 'Active', match: (s) => ACTIVE.includes(s) },
      { id: 'requires_invoicing', label: 'Requires invoicing', match: (s) => s === 'requires_invoicing' },
      { id: 'late', label: 'Late', match: (s) => s === 'late' },
      { id: 'today', label: 'Today', match: (s) => s === 'today' },
      { id: 'upcoming', label: 'Upcoming', match: (s) => s === 'upcoming' },
      { id: 'unscheduled', label: 'Unscheduled', match: (s) => s === 'unscheduled' },
      { id: 'recurring', label: 'Recurring', match: (s, j) => ACTIVE.includes(s) && j.schedule?.repeat && j.schedule.repeat !== 'none' },
      { id: 'completed', label: 'Completed', match: (s) => s === 'completed' },
      { id: 'archived', label: 'Archived', match: (s) => s === 'archived' },
      { id: 'all', label: 'All', match: () => true },
    ],
    stats: (all, statusOf) => {
      const by = (s) => all.filter((j) => statusOf(j) === s);
      const toInvoice = by('requires_invoicing');
      const late = by('late');
      const active = all.filter((j) => ACTIVE.includes(statusOf(j)));
      const unscheduled = by('unscheduled');
      return [
        { label: 'Requires invoicing', value: formatMoneyShort(toInvoice.reduce((s, j) => s + amountToInvoice(j), 0)), sub: pluralize(toInvoice.length, 'job'), filter: 'requires_invoicing', tone: toInvoice.length ? 'warning' : null },
        { label: 'Late', value: String(late.length), sub: 'Visits past their date', filter: 'late', tone: late.length ? 'danger' : null },
        { label: 'Active', value: String(active.length), sub: 'Scheduled or in progress', filter: 'active' },
        { label: 'Unscheduled', value: String(unscheduled.length), sub: 'Need a date', filter: 'unscheduled' },
      ];
    },
    searchText: (j) => `#${j.number} ${j.title || ''} ${clientName(lookup.client(j.clientId))}`,
    columns: (statusOf) => [
      { id: 'client', label: 'Client', sort: (j) => clientName(lookup.client(j.clientId)).toLowerCase(), cls: 'primary-cell', render: (j) => h('span', clientName(lookup.client(j.clientId)), h('span.sub', { style: { display: 'block' } }, formatAddress(lookup.property(lookup.client(j.clientId), j.propertyId)) || '')) },
      { id: 'number', label: 'Job', sort: (j) => j.number, render: (j) => h('span', h('span', { style: { fontWeight: '600' } }, `#${j.number}`), h('span.sub', { style: { display: 'block' } }, j.title || 'Untitled')) },
      {
        id: 'next',
        label: 'Schedule',
        sort: (j) => nextVisit(j)?.date || (j.closedAt ? 'zz' : 'zy'),
        render: (j) => {
          const v = nextVisit(j);
          const recurring = j.schedule?.repeat && j.schedule.repeat !== 'none';
          return h('span', h('span.nowrap', v ? relativeDay(v.date, today) : j.schedule?.start ? 'No open visits' : 'Unscheduled'), recurring ? h('span.sub', { style: { display: 'block' } }, describeSchedule(j.schedule, { end: false })) : null);
        },
      },
      { id: 'team', label: 'Team', render: (j) => teamAvatars(j.assignees || []) },
      { id: 'status', label: 'Status', sort: (j) => statusOf(j), render: (j) => statusPill(statusOf(j)) },
      { id: 'total', label: 'Total', align: 'r', sort: (j) => total(j), render: (j) => h('span.money', money(total(j))) },
    ],
    mobile: (j, s) => {
      const v = nextVisit(j);
      return h(
        'a.mobile-row',
        { href: `#/jobs/${j.id}` },
        h('div.grow', { style: { minWidth: '0' } }, h('div.m-title', clientName(lookup.client(j.clientId))), h('div.m-sub', `#${j.number} · ${j.title || 'Untitled'}`), h('div.m-sub', v ? `Next: ${formatDate(v.date)}` : 'No upcoming visit')),
        h('div.m-end', statusPill(s), h('span.money', { style: { fontSize: '13px', fontWeight: '600' } }, money(total(j)))),
      );
    },
    empty: { icon: 'hammer', title: 'Create your first job', text: 'Jobs hold the work you have won: visits on the schedule, the crew assigned, and what to invoice.' },
  });
}
