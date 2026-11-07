/** Home: today's work, the pipeline at a glance, and what needs attention. */
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { emptyState, statusPill } from '../ui/components.js';
import { agendaItems, setAgendaComplete, agendaHref } from '../core/agenda.js';
import { addDays, formatDate, formatTimeRange, startOfMonth, addMonths, endOfMonth, monthLabel } from '../core/dates.js';
import { clientName, shortAddress } from '../core/format.js';
import { requestStatus, quoteStatus, jobStatus, invoiceStatus, invoiceBalance, amountToInvoice } from '../core/status.js';
import { computeTotals } from '../core/totals.js';
import { money, teamAvatars } from './common.js';
import { formatMoneyShort } from '../core/money.js';
import { toast } from '../ui/toast.js';

export function render(ctx) {
  const store = app.store;
  const page = h('div.page.home');

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const who = store.all('team').find((m) => m.role === 'owner')?.name?.split(' ')[0] || app.user?.username || '';

  page.append(
    h(
      'header.page-header',
      h('div.titles', h('div.subtle.home-date', formatDate(app.today(), { weekday: 'long', month: 'long', day: 'numeric' })), h('h1', `${greeting}${who ? ', ' + who : ''}`)),
    ),
    ctx.live(() => setupChecklist(), ['clients', 'quotes', 'products', 'settings', 'team']),
    ctx.live(() => pipeline(), ['requests', 'quotes', 'jobs', 'invoices', 'payments']),
    h(
      'div.home-grid',
      h('div.home-main', ctx.live(() => todayCard(), ['jobs', 'requests', 'events', 'team', 'clients'])),
      h('div.home-side', ctx.live(() => [performanceCard(), attentionCard()], ['invoices', 'payments', 'jobs', 'quotes', 'clients'])),
    ),
  );
  return { node: page, title: 'Home' };
}

function pipeline() {
  const store = app.store;
  const today = app.today();
  const payments = store.all('payments');
  const invoices = store.all('invoices');

  const reqs = store.all('requests').map((r) => requestStatus(r, today));
  const newReqs = reqs.filter((s) => s === 'new').length;
  const assessToday = store.all('requests').filter((r) => r.assessment?.date === today && !r.assessment.completedAt).length;
  const overdueReq = reqs.filter((s) => s === 'assessment_overdue').length;

  const quotes = store.all('quotes');
  const qs = quotes.map((q) => [q, quoteStatus(q)]);
  const approved = qs.filter(([, s]) => s === 'approved');
  const awaiting = qs.filter(([, s]) => s === 'awaiting_response');
  const changes = qs.filter(([, s]) => s === 'changes_requested');
  const draftQ = qs.filter(([, s]) => s === 'draft');
  const sum = (list) => list.reduce((s, [d]) => s + computeTotals(d).total, 0);

  const jobs = store.all('jobs').map((j) => [j, jobStatus(j, today, invoices)]);
  const toInvoice = jobs.filter(([, s]) => s === 'requires_invoicing');
  const active = jobs.filter(([, s]) => ['late', 'today', 'upcoming', 'active', 'unscheduled'].includes(s));
  const late = jobs.filter(([, s]) => s === 'late');

  const inv = invoices.map((i) => [i, invoiceStatus(i, today, payments)]);
  const awaitingPay = inv.filter(([, s]) => s === 'awaiting_payment' || s === 'past_due');
  const pastDue = inv.filter(([, s]) => s === 'past_due');
  const drafts = inv.filter(([, s]) => s === 'draft');
  const owed = awaitingPay.reduce((s, [i]) => s + Math.max(0, invoiceBalance(i, payments)), 0);

  const stage = (key, label, ic, href, primary, lines) =>
    h(
      'a.stage',
      { href, 'data-stage': key },
      h('div.stage-head', h('span.stage-icon', icon(ic, 16)), h('span.stage-label', label), icon('arrow-up-right', 15, 'stage-go')),
      h('div.stage-primary', h('span.stage-num', String(primary.n)), h('span.stage-text', primary.label)),
      h(
        'ul.stage-lines',
        lines.filter(Boolean).map((l) => h(`li${l.tone ? '.' + l.tone : ''}`, h('span.grow', l.label), h('span.num', l.value))),
      ),
    );

  return h(
    'section.pipeline',
    { 'aria-label': 'Workflow' },
    stage('requests', 'Requests', 'inbox', '#/requests', { n: newReqs, label: 'New' }, [
      { label: 'Assessments today', value: assessToday },
      overdueReq ? { label: 'Overdue', value: overdueReq, tone: 'danger' } : null,
    ]),
    stage('quotes', 'Quotes', 'file-pen', '#/quotes', { n: approved.length, label: 'Approved' }, [
      { label: `Awaiting response`, value: `${awaiting.length} · ${formatMoneyShort(sum(awaiting))}` },
      changes.length ? { label: 'Changes requested', value: changes.length, tone: 'danger' } : { label: 'Drafts', value: draftQ.length },
    ]),
    stage('jobs', 'Jobs', 'hammer', '#/jobs', { n: toInvoice.length, label: 'Requires invoicing' }, [
      { label: 'Active', value: active.length },
      late.length ? { label: 'Late', value: late.length, tone: 'danger' } : null,
    ]),
    stage('invoices', 'Invoices', 'receipt-text', '#/invoices', { n: awaitingPay.length, label: 'Awaiting payment' }, [
      { label: 'Owed to you', value: money(owed) },
      pastDue.length ? { label: 'Past due', value: pastDue.length, tone: 'danger' } : { label: 'Drafts', value: drafts.length },
    ]),
  );
}

function todayCard() {
  const store = app.store;
  const today = app.today();
  const items = agendaItems(store, { from: today, to: today });
  const tomorrow = agendaItems(store, { from: addDays(today, 1), to: addDays(today, 1) });
  const done = items.filter((i) => i.completed).length;
  const visitValue = items
    .filter((i) => i.kind === 'visit')
    .reduce((s, i) => {
      const job = store.get('jobs', i.jobId);
      if (!job) return s;
      const perVisit = job.billing === 'per_visit' ? computeTotals(job).total : 0;
      return s + perVisit;
    }, 0);

  const head = h(
    'div.card-head',
    h('h2.grow', "Today's appointments"),
    items.length ? h('span.subtle.hide-mobile', `${done} of ${items.length} done`) : null,
    h('a.btn.sm', { href: '#/schedule' }, icon('calendar-days', 15), 'Schedule'),
  );

  let body;
  if (!items.length) {
    body = emptyState({
      compact: true,
      icon: 'calendar-check',
      title: 'Nothing scheduled today',
      text: tomorrow.length ? `Tomorrow has ${tomorrow.length} appointment${tomorrow.length === 1 ? '' : 's'}.` : 'Schedule a job or add a task to plan your day.',
      actions: [h('a.btn', { href: '#/jobs/new' }, icon('plus', 16), 'New job')],
      headingLevel: 3,
    });
  } else {
    const progress = h('div.progress', { role: 'progressbar', 'aria-label': 'Appointments completed', 'aria-valuemin': '0', 'aria-valuemax': String(items.length), 'aria-valuenow': String(done) }, h('span', { style: { width: `${(done / items.length) * 100}%` } }));
    body = h(
      'div',
      h('div.today-summary', progress, visitValue ? h('span.subtle', `${money(visitValue)} in per-visit work today`) : null),
      h('ul.list.agenda-list', items.map((it) => h('li', agendaRow(it)))),
    );
  }
  return h('section.card', head, h('div.card-body.flush', body));
}

export function agendaRow(it) {
  const store = app.store;
  const client = lookup.client(it.clientId);
  const property = client ? lookup.property(client, it.propertyId) : null;
  const href = agendaHref(it);
  const check = h('input.agenda-check', {
    type: 'checkbox',
    checked: it.completed,
    'aria-label': `Mark ${it.title} ${it.completed ? 'not done' : 'done'}`,
    onChange: (e) => {
      setAgendaComplete(store, it, e.target.checked);
      if (e.target.checked) toast(`${it.kind === 'visit' ? 'Visit' : it.kind === 'assessment' ? 'Assessment' : 'Item'} marked complete`);
    },
  });
  const kindLabel = { visit: 'Visit', assessment: 'Assessment', task: 'Task', event: 'Event' }[it.kind];
  const titleNode = href ? h('a.agenda-title', { href }, it.title) : h('span.agenda-title', it.title);
  return h(
    `div.agenda-row${it.completed ? '.done' : ''}`,
    h('div.agenda-time', h('span', it.start ? formatTimeRange(it.start, it.end).split(' - ')[0] : 'Anytime'), it.end ? h('span.subtle', formatTimeRange(it.end)) : null),
    h('span.agenda-bar', { 'data-kind': it.kind }),
    h(
      'div.grow.agenda-body',
      titleNode,
      h(
        'div.agenda-meta',
        h('span.kind', kindLabel),
        client ? h('span', clientName(client)) : null,
        property ? h('span.truncate', shortAddress(property)) : null,
      ),
    ),
    teamAvatars(it.assignees),
    h('label.agenda-check-wrap', { title: it.completed ? 'Mark not done' : 'Mark done' }, check),
  );
}

function performanceCard() {
  const store = app.store;
  const today = app.today();
  const payments = store.all('payments').filter((p) => !p.voided);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const start = startOfMonth(addMonths(today, -i));
    const end = endOfMonth(start);
    const total = payments.filter((p) => p.date >= start && p.date <= end).reduce((s, p) => s + p.amount, 0);
    months.push({ start, total, label: formatDate(start, { month: 'short' }) });
  }
  const thisMonth = months[5].total;
  const lastMonth = months[4].total;
  const change = lastMonth ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;
  const max = Math.max(1, ...months.map((m) => m.total));

  // Plain boxes rather than a stretched SVG, so the month labels keep their
  // shape at any card width.
  const chart = h(
    'div.mini-chart',
    {
      role: 'img',
      'aria-label': `Payments received by month: ${months.map((m) => `${m.label} ${money(m.total)}`).join(', ')}`,
    },
    months.map((m, i) =>
      h(
        'div.mini-bar',
        { title: `${m.label}: ${money(m.total)}` },
        h('span.mini-bar-track', h('span.mini-bar-fill', { style: { height: `${Math.max(2, (Math.max(0, m.total) / max) * 100)}%`, background: i === 5 ? 'var(--accent)' : 'var(--accent-soft-2)' } })),
        h('span.mini-bar-label', m.label),
      ),
    ),
  );

  return h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Revenue'), h('a.btn.sm.ghost', { href: '#/reports' }, 'Reports', icon('arrow-right', 14))),
    h(
      'div.card-body.stack',
      h(
        'div',
        h('div.subtle', { style: { fontSize: '13px' } }, `Collected in ${monthLabel(today)}`),
        h(
          'div.row',
          { style: { alignItems: 'baseline', gap: '10px' } },
          h('span.big-number', money(thisMonth)),
          change !== null ? h(`span.delta${change >= 0 ? '.up' : '.down'}`, icon(change >= 0 ? 'trending-up' : 'trending-down', 14), `${Math.abs(change)}% vs last month`) : null,
        ),
      ),
      chart,
    ),
  );
}

function attentionCard() {
  const store = app.store;
  const today = app.today();
  const payments = store.all('payments');
  const invoices = store.all('invoices');
  const rows = [];
  for (const inv of invoices) {
    if (invoiceStatus(inv, today, payments) === 'past_due') rows.push({ href: `#/invoices/${inv.id}`, title: `Invoice #${inv.number}`, sub: clientName(lookup.client(inv.clientId)), status: 'past_due', amount: invoiceBalance(inv, payments), sort: 0 });
  }
  for (const job of store.all('jobs')) {
    const s = jobStatus(job, today, invoices);
    if (s === 'requires_invoicing') rows.push({ href: `#/jobs/${job.id}`, title: `Job #${job.number}: ${job.title || 'Untitled'}`, sub: clientName(lookup.client(job.clientId)), status: s, amount: amountToInvoice(job), sort: 1 });
    if (s === 'late') rows.push({ href: `#/jobs/${job.id}`, title: `Job #${job.number}: ${job.title || 'Untitled'}`, sub: clientName(lookup.client(job.clientId)), status: s, sort: 2 });
  }
  for (const q of store.all('quotes')) {
    const s = quoteStatus(q);
    if (s === 'changes_requested' || s === 'approved') rows.push({ href: `#/quotes/${q.id}`, title: `Quote #${q.number}: ${q.title || 'Untitled'}`, sub: clientName(lookup.client(q.clientId)), status: s, amount: computeTotals(q).total, sort: 3 });
  }
  rows.sort((a, b) => a.sort - b.sort);
  return h(
    'section.card',
    h('div.card-head', h('h2.grow', 'Needs attention'), rows.length ? h('span.count.subtle', String(rows.length)) : null),
    h(
      'div.card-body.flush',
      rows.length
        ? h(
            'ul.list',
            rows.slice(0, 8).map((r) =>
              h(
                'li',
                h(
                  'a.list-item',
                  { href: r.href },
                  h('div.grow', { style: { minWidth: '0' } }, h('div.title.truncate', r.title), h('div.meta.truncate', r.sub)),
                  h('div', { style: { textAlign: 'right' } }, statusPill(r.status), r.amount ? h('div.meta.money', { style: { marginTop: '4px' } }, money(r.amount)) : null),
                ),
              ),
            ),
          )
        : emptyState({ compact: true, icon: 'circle-check', title: 'All caught up', text: 'Nothing is overdue or waiting on you.', headingLevel: 3 }),
    ),
  );
}

function setupChecklist() {
  const store = app.store;
  const s = store.state.settings;
  if (s.setupDismissed || app.demo) return null;
  const steps = [
    { done: !!s.company.name, label: 'Add your business details', href: '#/settings', icon: 'building' },
    { done: store.all('products').length > 0, label: 'Add the services you offer', href: '#/settings/products', icon: 'package' },
    { done: store.all('team').length > 1, label: 'Add your team', href: '#/settings/team', icon: 'users' },
    { done: store.all('clients').length > 0, label: 'Add your first client', href: '#/clients/new', icon: 'user-plus' },
    { done: store.all('quotes').length > 0, label: 'Send your first quote', href: '#/quotes/new', icon: 'file-pen' },
  ];
  const remaining = steps.filter((x) => !x.done).length;
  if (!remaining) return null;
  return h(
    'section.card.setup',
    { 'aria-labelledby': 'setup-title' },
    h(
      'div.card-head',
      h('h2.grow#setup-title', 'Get set up', h('span.count', ` ${steps.length - remaining} of ${steps.length}`)),
      h('button.btn.sm.ghost', { type: 'button', onClick: () => store.saveSettings({ setupDismissed: true }) }, 'Dismiss'),
    ),
    h(
      'ol.setup-steps',
      steps.map((st) =>
        h(
          `li${st.done ? '.done' : ''}`,
          h(
            'a',
            { href: st.href },
            h('span.step-icon', icon(st.done ? 'check' : st.icon, 16)),
            h('span', st.label),
            st.done ? h('span.sr-only', '(done)') : null,
          ),
        ),
      ),
    ),
  );
}
