import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, canEdit } from '../app.js';
import { vehicleName, formatDecimal, pluralize } from '../core/format.js';
import { formatDate, relativeDays, addDays, lastMonths, monthShort, addInterval, formatTime } from '../core/dates.js';
import { reminderState, renewalState } from '../core/reminders.js';
import { issueOverdue, vehicleStatusMeta } from '../core/status.js';
import { costLines, monthlyCosts, sumBy, usageByVehicle } from '../core/costs.js';
import { inspectionsDue } from '../core/inspections.js';
import { formatMoneyShort } from '../core/money.js';
import { columnChart, stackBar } from '../ui/chart.js';
import { statusPill, pill } from '../ui/components.js';
import { money, vehicleThumb, miniEmpty, operatorOf } from './common.js';

const TONE_COLORS = { green: 'var(--success)', orange: 'var(--warning)', red: 'var(--danger)', blue: 'var(--info)', gray: 'var(--neutral)', purple: 'var(--purple)', teal: 'var(--teal)' };

export function render(ctx) {
  const greeting = (() => {
    const hr = new Date().getHours();
    return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  })();
  const header = ctx.live(
    () =>
      h(
        'header.page-header',
        h('div.titles', h('h1', app.settings().company.name || 'Fleet overview'), h('div.subtitle', `${greeting}${app.user ? `, ${app.user.username}` : ''}. Here is where your fleet stands today, ${formatDate(app.today(), { weekday: 'long', month: 'long', day: 'numeric' })}.`)),
        h(
          'div.actions',
          canEdit('inspections') ? h('a.btn', { href: '#/inspections/start' }, icon('clipboard-check', 16), 'Start inspection') : null,
          canEdit('issues') ? h('a.btn', { href: '#/issues/new' }, icon('warning', 16), 'Report issue') : null,
          canEdit('fuel') ? h('a.btn', { href: '#/fuel/new' }, icon('fuel', 16), 'Add fuel') : null,
        ),
      ),
    ['settings'],
  );
  const body = ctx.live(draw, ['vehicles', 'issues', 'reminders', 'renewals', 'workOrders', 'inspections', 'inspectionForms', 'fuel', 'serviceEntries', 'expenses', 'meters', 'settings', 'parts', 'assignments', 'contacts']);
  return { node: h('div.page.dashboard', header, body), title: 'Dashboard' };
}

function draw() {
  const store = app.store;
  const s = app.settings();
  const today = app.today();
  const vehicles = store.all('vehicles').filter((v) => !v.archived);
  if (!vehicles.length) return welcome();
  const vIds = new Set(vehicles.map((v) => v.id));

  // ---- Needs attention ----
  const issues = store.all('issues').filter((i) => i.status === 'open' && vIds.has(i.vehicleId));
  const overdueIssues = issues.filter((i) => issueOverdue(i, today, lookup.vehicle(i.vehicleId)));
  const rem = store.all('reminders').filter((r) => !r.archived && vIds.has(r.vehicleId)).map((r) => ({ r, st: reminderState(r, lookup.vehicle(r.vehicleId), today, s) }));
  const remOver = rem.filter((x) => x.st.status === 'overdue');
  const remSoon = rem.filter((x) => x.st.status === 'due_soon');
  const remVehOver = new Set(remOver.map((x) => x.r.vehicleId)).size;
  const remVehSoon = new Set(remSoon.map((x) => x.r.vehicleId)).size;
  // As in Needs attention: renewals of archived or deleted vehicles and contacts are left out.
  const activeOwner = (r) => (r.kind === 'contact' ? lookup.contact(r.contactId) && !lookup.contact(r.contactId).archived : vIds.has(r.vehicleId));
  const ren = store.all('renewals').filter((r) => !r.done && activeOwner(r)).map((r) => ({ r, st: renewalState(r, today, s) }));
  const renOver = ren.filter((x) => x.st.status === 'overdue');
  const renSoon = ren.filter((x) => x.st.status === 'due_soon');
  const wos = store.all('workOrders').filter((w) => w.status !== 'completed' && w.status !== 'cancelled' && vIds.has(w.vehicleId));
  const due = inspectionsDue(store.all('inspectionForms'), vehicles.filter((v) => vehicleStatusMeta(s, v.status).id === 'active' || v.status === 'active'), store.all('inspections'), today, addInterval);
  const overdueInsp = due.filter((d) => d.overdue);
  const recentSubs = store.all('inspections').filter((i) => i.date >= addDays(today, -6));
  const failedRecent = recentSubs.reduce((n, i) => n + (i.failed || 0), 0);

  const attention = h(
    'section.dash-section',
    { 'aria-labelledby': 'dash-attn' },
    h('div.dash-section-head', h('h2#dash-attn', 'Needs attention'), h('span.subtle', 'Items that need action to keep vehicles on the road')),
    h(
      'div.tile-grid',
      tile('Open issues', '#/issues', [num(issues.length, 'Open', issues.length ? 'orange' : null), num(overdueIssues.length, 'Overdue', overdueIssues.length ? 'red' : null)]),
      tile('Service reminders', '#/reminders', [num(remVehOver, 'Vehicles overdue', remVehOver ? 'red' : null), num(remVehSoon, 'Vehicles due soon', remVehSoon ? 'orange' : null)]),
      tile('Renewals', '#/renewals', [num(renOver.length, 'Overdue', renOver.length ? 'red' : null), num(renSoon.length, 'Due soon', renSoon.length ? 'orange' : null)]),
      tile('Work orders', '#/work-orders', [num(wos.filter((w) => w.status === 'open').length, 'Open', null), num(wos.filter((w) => w.status === 'in_progress').length, 'In progress', null), num(wos.filter((w) => w.status === 'on_hold').length, 'On hold', wos.some((w) => w.status === 'on_hold') ? 'orange' : null)]),
      tile('Inspections, last 7 days', '#/inspections', [num(recentSubs.length, 'Submitted', null), num(failedRecent, 'Failed items', failedRecent ? 'red' : null)]),
      tile('Scheduled inspections', '#/inspection-forms', [num(overdueInsp.length, 'Overdue', overdueInsp.length ? 'red' : null), num(due.filter((d) => d.dueDate === today).length, 'Due today', null)]),
    ),
  );

  // ---- Fleet status ----
  const statusParts = s.vehicleStatuses.map((st) => ({ label: st.label, value: vehicles.filter((v) => v.status === st.id).length, color: TONE_COLORS[st.color] || 'var(--neutral)', href: `#/vehicles?f_status=${st.id}` }));
  // Today's operator from the assignments; the stored one goes stale as days pass.
  const assigned = vehicles.filter((v) => operatorOf(v)).length;
  const fleetCard = h(
    'section.card.panel',
    { 'aria-labelledby': 'dash-fleet' },
    h('div.card-head', h('h2.grow#dash-fleet', 'Vehicle status'), h('a.btn.sm.ghost', { href: '#/vehicles' }, 'View all')),
    h(
      'div.card-body',
      stackBar(statusParts, { label: 'Vehicles by status' }),
      h('div.metric-row.top-gap', metricBox('Vehicles', vehicles.length), metricBox('Assigned', assigned), metricBox('Unassigned', vehicles.length - assigned)),
    ),
  );

  // ---- Costs ----
  const lines = costLines({ fuel: store.all('fuel'), serviceEntries: store.all('serviceEntries'), expenses: store.all('expenses') }).filter((l) => vIds.has(l.vehicleId));
  const months = lastMonths(today, 6);
  const series = monthlyCosts(lines, months);
  const m0 = `${today.slice(0, 7)}-01`;
  const prevStart = `${months[4]}-01`;
  const thisMonth = sumBy(lines, m0, today);
  const prevEnd = addDays(m0, -1);
  const lastMonth = sumBy(lines, prevStart, prevEnd);
  // The trend compares this month so far with the same days of last month;
  // against all of last month it would read as a drop for most of the month.
  const sameDay = `${months[4]}-${today.slice(8, 10)}`;
  const lastMonthToDate = sumBy(lines, prevStart, sameDay < prevEnd ? sameDay : prevEnd);
  // Cost per mile (or km) covers vehicles measured in the fleet's distance
  // unit; hour meters and vehicles in the other unit would mix units.
  const unit = s.units.distance;
  const inUnit = (id) => (lookup.vehicle(id)?.meterUnit || unit) === unit;
  const usage = usageByVehicle(store.all('meters').filter((m) => vIds.has(m.vehicleId) && inUnit(m.vehicleId)), addDays(today, -30), today);
  const dist = [...usage.values()].reduce((a, b) => a + b, 0);
  const cost30 = sumBy(lines.filter((l) => inUnit(l.vehicleId)), addDays(today, -30), today);
  const costCard = h(
    'section.card.panel.span-2',
    { 'aria-labelledby': 'dash-cost' },
    h('div.card-head', h('h2.grow#dash-cost', 'Operating costs'), h('a.btn.sm.ghost', { href: '#/reports/costs' }, 'Cost report')),
    h(
      'div.card-body',
      h(
        'div.metric-row',
        metricBox('This month', money(thisMonth), lastMonthToDate ? trend(thisMonth, lastMonthToDate) : null),
        metricBox('Last month', money(lastMonth)),
        metricBox(`Cost per ${unit}, 30 days`, dist > 0 ? money(Math.round(cost30 / dist)) : '-'),
        metricBox(`Distance, 30 days`, dist ? `${Math.round(dist).toLocaleString()} ${unit}` : '-'),
      ),
      columnChart({
        title: 'Operating costs by month',
        categories: months.map((m, i) => ({ label: monthShort(m).split(' ')[0], full: monthShort(m), values: [series.fuel[i], series.service[i], series.other[i]] })),
        series: [
          { name: 'Fuel', color: 'var(--series-1)' },
          { name: 'Service', color: 'var(--series-2)' },
          { name: 'Other', color: 'var(--series-3)' },
        ],
        stacked: true,
        height: 220,
        format: (c) => money(c),
        short: (c) => formatMoneyShort(c),
      }),
    ),
  );

  // ---- Lists ----
  const order = { overdue: 0, due_soon: 1, snoozed: 2, upcoming: 3 };
  const upcoming = rem
    .filter((x) => x.st.status === 'overdue' || x.st.status === 'due_soon')
    .sort((a, b) => order[a.st.status] - order[b.st.status] || String(a.st.nextDate || '').localeCompare(String(b.st.nextDate || '')))
    .slice(0, 6);
  const serviceCard = listPanel(
    'Upcoming service',
    '#/reminders',
    upcoming.map(({ r, st }) => {
      const v = lookup.vehicle(r.vehicleId);
      return h('a.dash-row', { href: `#/reminders/${r.id}` }, vehicleThumb(v, 'sm'), h('span.grow.truncate', h('span.row-title', lookup.taskName(r.taskId) || 'Service'), h('span.row-sub', vehicleName(v))), h('span.row-end', statusPill('reminder', st.status), h('span.row-sub', st.nextDate ? relativeDays(st.nextDate, today) : '')));
    }),
    'No service due soon.',
  );
  const pr = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
  const issueCard = listPanel(
    'Open issues',
    '#/issues',
    [...issues]
      .sort((a, b) => pr[a.priority] - pr[b.priority] || String(b.reportedDate).localeCompare(String(a.reportedDate)))
      .slice(0, 6)
      .map((i) => h('a.dash-row', { href: `#/issues/${i.id}` }, vehicleThumb(lookup.vehicle(i.vehicleId), 'sm'), h('span.grow.truncate', h('span.row-title', `#${i.number} ${i.summary}`), h('span.row-sub', vehicleName(lookup.vehicle(i.vehicleId)))), h('span.row-end', statusPill('priority', i.priority), h('span.row-sub', relativeDays(i.reportedDate, today))))),
    'No open issues.',
  );
  const subs = [...store.all('inspections')].sort((a, b) => String(b.submittedAt || b.date).localeCompare(String(a.submittedAt || a.date))).slice(0, 6);
  const inspCard = listPanel(
    'Recent inspections',
    '#/inspections',
    subs.map((i) => h('a.dash-row', { href: `#/inspections/${i.id}` }, vehicleThumb(lookup.vehicle(i.vehicleId), 'sm'), h('span.grow.truncate', h('span.row-title', vehicleName(lookup.vehicle(i.vehicleId))), h('span.row-sub', `${i.formName}${i.by ? ` by ${i.by}` : ''}`)), h('span.row-end', i.failed ? pill(`${i.failed} failed`, 'red') : pill('Passed', 'green'), h('span.row-sub', `${relativeDays(i.date, today)}${i.submittedAt || i.startedAt ? `, ${localTime(i.submittedAt || i.startedAt)}` : ''}`)))),
    'No inspections yet.',
  );
  const renewalCard = listPanel(
    'Renewals due',
    '#/renewals',
    // Most overdue first, then the soonest due.
    [...renOver, ...renSoon]
      .sort((a, b) => String(a.r.dueDate || '').localeCompare(String(b.r.dueDate || '')))
      .slice(0, 6)
      .map(({ r, st }) => {
        const owner = r.kind === 'contact' ? lookup.contactName(r.contactId) : vehicleName(lookup.vehicle(r.vehicleId));
        return h('a.dash-row', { href: r.kind === 'contact' ? '#/contact-renewals' : '#/renewals' }, h('span.row-icon', icon(r.kind === 'contact' ? 'id-card' : 'calendar-clock', 16)), h('span.grow.truncate', h('span.row-title', r.type), h('span.row-sub', owner)), h('span.row-end', statusPill('reminder', st.status), h('span.row-sub', relativeDays(r.dueDate, today))));
      }),
    'Nothing expiring in the next two weeks.',
  );

  return h('div.dash', attention, h('div.dash-grid', costCard, fleetCard, serviceCard, issueCard, inspCard, renewalCard));
}

/** Local time of day from a UTC timestamp ("2026-10-12T16:40:00Z"). */
function localTime(iso) {
  return formatTime(new Date(iso).toTimeString().slice(0, 5));
}

function tile(title, href, nums) {
  return h('a.tile', { href }, h('span.tile-title', title, icon('chevron-right', 15)), h('span.tile-nums', nums));
}

function num(n, label, tone) {
  return h(`span.tile-num${tone ? '.tone-' + tone : ''}`, h('span.tile-value', String(n)), h('span.tile-label', label));
}

function metricBox(label, value, extra = null) {
  return h('div.metric', h('span.metric-label', label), h('span.metric-value', value), extra);
}

function trend(now, before) {
  const pct = ((now - before) / before) * 100;
  if (!Number.isFinite(pct)) return null;
  const up = pct > 0;
  return h(`span.trend.${up ? 'up' : 'down'}`, icon(up ? 'trending-up' : 'trending-down', 14), `${formatDecimal(Math.abs(pct), 0)}% vs same days last month`);
}

function listPanel(title, href, rows, empty) {
  return h('section.card.panel', { 'aria-label': title }, h('div.card-head', h('h2.grow', title), h('a.btn.sm.ghost', { href }, 'View all')), h('div.card-body.flush', rows.length ? h('div.dash-list', rows) : miniEmpty(empty)));
}

function welcome() {
  const step = (n, ic, title, text, href, label) => h('li.step', h('span.step-num', String(n)), h('div.grow', h('h3', icon(ic, 16), title), h('p', text)), h('a.btn.sm', { href }, label));
  return h(
    'div.getting-started',
    h('section.card.panel', h('div.card-head', h('h2.grow', 'Get your fleet set up')), h(
      'div.card-body',
      h('p.muted', 'A few steps and the dashboard fills itself in.'),
      h(
        'ol.steps',
        step(1, 'truck', 'Add your vehicles', 'Add them one at a time, or import a spreadsheet.', '#/vehicles/new', 'Add vehicle'),
        step(2, 'users', 'Add drivers and technicians', 'Contacts can be assigned vehicles, work orders, and renewals like license expiry.', '#/contacts/new', 'Add contact'),
        step(3, 'clipboard-check', 'Set up an inspection form', 'A ready-made pre-trip checklist is one click away.', '#/inspection-forms', 'Inspection forms'),
        step(4, 'bell', 'Schedule preventive maintenance', 'Create service reminders by time or mileage, or build a service program for many vehicles at once.', '#/service-programs', 'Service programs'),
        step(5, 'users', 'Invite your team', 'Drivers sign in with their own Puter account to submit inspections, fuel, and issues.', '#/settings/team', 'Team access'),
      ),
    )),
  );
}

export { pluralize };
