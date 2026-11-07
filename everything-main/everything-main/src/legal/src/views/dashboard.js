/**
 * Dashboard. Personal: today's agenda, my hours against target, firm billing
 * at a glance, recent matters with one-click timers, and upcoming
 * deadlines. Firm: firm-wide hours by person, receivables, and collections.
 */
import '../styles/calendar-tasks.css';
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup, meId } from '../app.js';
import { pageHeader, tabs, card, stat, meter, emptyState, avatar } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { startTimerOn } from '../ui/timer.js';
import { openActivityDialog, openTaskDialog, openEventDialog, toggleTask } from './dialogs.js';
import { matterLink, dueLabel, priorityPill, moneyCell } from './common.js';
import { activityAmount, billStatus, billTotals, billBalance, agingBuckets, accountBalance } from '../core/finance.js';
import { formatMoney, formatMoneyShort } from '../core/money.js';
import { formatHoursDecimal } from '../core/duration.js';
import { addDays, namedRange, formatDate, formatTime, diffDays, startOfMonth, endOfMonth } from '../core/dates.js';
import { matterLabel, colorFor, pluralize } from '../core/format.js';
import { where } from '../core/derive.js';

export function render(ctx) {
  const store = app.store;
  let tab = ctx.query.tab === 'firm' ? 'firm' : 'personal';
  const body = h('div.dash-body#dash-panel', { role: 'tabpanel' });

  const header = pageHeader({
    title: 'Dashboard',
    subtitle: formatDate(app.today(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    actions: [
      h('button.btn', { type: 'button', onClick: () => openTaskDialog() }, icon('square-check', 16), h('span.hide-sm', 'New task')),
      h('button.btn.primary', { type: 'button', onClick: () => openActivityDialog({ kind: 'time' }) }, icon('clock', 16), 'Record time'),
    ],
    tabs: tabs({
      label: 'Dashboard',
      panelId: body.id,
      selected: tab,
      items: [
        { id: 'personal', label: 'Personal' },
        { id: 'firm', label: 'Firm' },
      ],
      onSelect: (id) => {
        tab = id;
        setQuery({ tab: id === 'firm' ? 'firm' : '' });
        draw();
      },
    }),
  });

  function draw() {
    body.setAttribute('aria-label', tab === 'firm' ? 'Firm' : 'Personal');
    body.replaceChildren(tab === 'firm' ? firmView(ctx) : personalView(ctx));
  }
  draw();

  return { title: 'Dashboard', node: h('div.page.dash', header, body) };
}

// ---- Personal ------------------------------------------------------------------------

function personalView(ctx) {
  const me = app.me();
  return h(
    'div.dash-grid',
    !me ? h('div.notice.info.dash-span', icon('info', 16), h('span', 'Add yourself as a firm user to track your hours and tasks. ', h('a', { href: '#/settings/users' }, 'Open firm users'))) : null,
    h(
      'div.dash-col',
      ctx.live(() => agendaCard(), ['tasks', 'events', 'matters', 'users']),
      ctx.live(() => recentMattersCard(), ['activities', 'matters', 'contacts']),
    ),
    h(
      'div.dash-col',
      ctx.live(() => hoursCard(), ['activities', 'users', 'settings']),
      ctx.live(() => billingTiles(), ['bills', 'payments', 'transactions', 'accounts']),
      ctx.live(() => deadlinesCard(), ['matters', 'events']),
    ),
  );
}

function agendaCard() {
  const store = app.store;
  const today = app.today();
  const me = meId();
  const tasks = store
    .all('tasks')
    .filter((t) => !t.done && t.dueDate && t.dueDate <= today && (!me || t.assigneeId === me))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.priority === 'high' ? -1 : 0));
  const events = where(store, 'events', 'date', today)
    .filter((e) => !me || !(e.attendeeIds || []).length || e.attendeeIds.includes(me))
    .slice()
    .sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : String(a.start).localeCompare(String(b.start))));
  const overdue = tasks.filter((t) => t.dueDate < today).length;

  const taskList = tasks.length
    ? h(
        'ul.dash-list',
        tasks
          .slice(0, 8)
          .map((t) =>
            h(
              'li.dash-task',
              h('button.task-check', { type: 'button', 'aria-pressed': 'false', 'aria-label': `Mark complete: ${t.name}`, title: 'Mark complete', onClick: () => toggleTask(t) }, icon('check', 14)),
              h(
                'div.grow',
                h('button.task-name', { type: 'button', onClick: () => openTaskDialog({ task: t }) }, h('span.task-title', t.name)),
                h('div.dash-meta', dueLabel(t, today), t.matterId ? matterLink(t.matterId, { short: true }) : null, priorityPill(t.priority)),
              ),
            ),
          ),
        tasks.length > 8 ? h('li.dash-more', h('a', { href: '#/tasks?due=due' }, `View all ${tasks.length} tasks`)) : null,
      )
    : h('div.dash-empty', icon('circle-check', 18), h('span', 'No tasks due today.'));

  const eventList = events.length
    ? h(
        'ul.dash-list',
        events.map((e) =>
          h(
            'li',
            h(
              'button.dash-event',
              { type: 'button', onClick: () => openEventDialog({ event: e }) },
              h('span.dash-event-time', e.allDay || !e.start ? 'All day' : formatTime(e.start)),
              h('span.grow', h('span.dash-event-title', e.title), h('span.dash-event-sub', [e.location, e.matterId ? matterLabel(lookup.matter(e.matterId)) : ''].filter(Boolean).join(' · '))),
            ),
          ),
        ),
      )
    : h('div.dash-empty', icon('calendar', 18), h('span', 'Nothing on your calendar today.'));

  return card({
    title: "Today's agenda",
    actions: h('a.btn.sm.ghost', { href: '#/calendar' }, 'Calendar', icon('arrow-right', 14)),
    body: h(
      'div.agenda-split',
      h(
        'section',
        { 'aria-label': 'Tasks due' },
        h('h3.dash-sub', icon('list-checks', 15), 'Tasks due', h('span.count', String(tasks.length)), overdue ? h('span.pill.danger', `${overdue} overdue`) : null),
        taskList,
      ),
      h('section', { 'aria-label': 'Calendar events today' }, h('h3.dash-sub', icon('calendar', 15), 'Calendar events', h('span.count', String(events.length))), eventList),
    ),
  });
}

/** Billable hours per day for my last 7 days, plus totals for today, week, and month. */
function myHours() {
  const store = app.store;
  const me = meId();
  const today = app.today();
  const ws = app.settings().weekStart;
  const [wa, wb] = namedRange('week', today, ws);
  const [ma, mb] = namedRange('month', today, ws);
  const from7 = addDays(today, -6);
  const days = new Map();
  for (let i = 0; i < 7; i++) days.set(addDays(from7, i), { billable: 0, other: 0 });
  const t = { today: 0, week: 0, month: 0, monthValue: 0, monthAll: 0, weekValue: 0 };
  for (const a of me ? where(store, 'activities', 'userId', me) : []) {
    if (a.kind !== 'time') continue;
    const min = Number(a.minutes) || 0;
    const billable = a.billable !== false && !!a.matterId;
    const d = days.get(a.date);
    if (d) d[billable ? 'billable' : 'other'] += min;
    if (a.date >= ma && a.date <= mb) {
      t.monthAll += min;
      if (billable) {
        t.month += min;
        t.monthValue += activityAmount(a);
      }
    }
    if (!billable) continue;
    if (a.date === today) t.today += min;
    if (a.date >= wa && a.date <= wb) {
      t.week += min;
      t.weekValue += activityAmount(a);
    }
  }
  return { ...t, days };
}

function hoursCard() {
  const me = app.me();
  const h7 = myHours();
  const target = Number(me?.targetHours) || 0;
  const pct = target ? (h7.month / 60 / target) * 100 : 0;
  // Pace: share of the month's working days elapsed.
  const today = app.today();
  const dayOfMonth = diffDays(startOfMonth(today), today) + 1;
  const monthDays = diffDays(startOfMonth(today), endOfMonth(today)) + 1;
  const expected = target ? (target * dayOfMonth) / monthDays : 0;
  const onPace = !target || h7.month / 60 >= expected * 0.95;
  return card({
    title: 'My billable hours',
    actions: h('a.btn.sm.ghost', { href: '#/activities' }, 'Activities', icon('arrow-right', 14)),
    body: h(
      'div.stack',
      h('div.hours-stats', hourStat('Today', h7.today), hourStat('This week', h7.week, formatMoney(h7.weekValue)), hourStat('This month', h7.month, formatMoney(h7.monthValue))),
      target
        ? h(
            'div.target',
            h('div.target-row', h('span', 'Monthly target'), h('span.num', h('strong', formatHoursDecimal(h7.month, 1)), ` of ${target} h`)),
            meter(pct, { label: 'Progress toward monthly billable target', tone: pct >= 100 ? 'success' : onPace ? 'accent' : 'warning' }),
            h('div.subtle.small', onPace ? 'On pace for this month.' : `Behind pace by ${Math.max(0, expected - h7.month / 60).toFixed(1)} h.`),
          )
        : h('div.subtle.small', me ? 'Set a monthly target for yourself in Settings, Firm users.' : ''),
      weekChart(h7.days),
    ),
  });
}

function hourStat(label, minutes, sub) {
  return h('div.hour-stat', h('span.stat-label', label), h('span.hour-value', formatHoursDecimal(minutes, 1), h('span.unit', 'h')), sub ? h('span.stat-sub', sub) : null);
}

/** Seven-day stacked bar chart of hours (billable and other), drawn as SVG. */
function weekChart(days) {
  const W = 320;
  const H = 120;
  const padB = 20;
  const entries = [...days.entries()];
  const max = Math.max(4 * 60, ...entries.map(([, v]) => v.billable + v.other));
  const bw = 26;
  const gap = (W - bw * 7) / 7;
  const today = app.today();
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'week-chart', role: 'img' });
  const desc = entries.map(([d, v]) => `${formatDate(d, { weekday: 'short' })} ${formatHoursDecimal(v.billable, 1)} billable, ${formatHoursDecimal(v.other, 1)} other`).join('; ');
  svg.setAttribute('aria-label', `Hours over the last 7 days: ${desc}`);
  const plotH = H - padB - 4;
  svg.append(el('line', { x1: 0, x2: W, y1: plotH + 4, y2: plotH + 4, class: 'wc-axis' }));
  entries.forEach(([d, v], i) => {
    const x = gap / 2 + i * (bw + gap);
    const hb = (v.billable / max) * plotH;
    const ho = (v.other / max) * plotH;
    const base = plotH + 4;
    if (ho > 0) svg.append(el('rect', { x, y: base - hb - ho, width: bw, height: Math.max(1, ho - (hb > 0 ? 2 : 0)), rx: 3, class: 'wc-other' }));
    if (hb > 0) svg.append(el('rect', { x, y: base - hb, width: bw, height: hb, rx: 3, class: 'wc-billable' }));
    const label = el('text', { x: x + bw / 2, y: H - 5, 'text-anchor': 'middle', class: `wc-label${d === today ? ' today' : ''}` });
    label.textContent = formatDate(d, { weekday: 'narrow' });
    svg.append(label);
  });
  return h('figure.week-fig', svg, h('figcaption.chart-legend', h('span.lg.billable', 'Billable'), h('span.lg.other', 'Non-billable'), h('span.subtle', 'Last 7 days')));
}

function billingTiles() {
  const store = app.store;
  const today = app.today();
  const payments = store.all('payments');
  let draftN = 0;
  let pendingN = 0;
  let draftT = 0;
  let unpaidN = 0;
  let unpaidT = 0;
  let overdueN = 0;
  let overdueT = 0;
  for (const b of store.all('bills')) {
    const st = billStatus(b, payments, today);
    if (st === 'draft' || st === 'pending') {
      if (st === 'draft') draftN++;
      else pendingN++;
      draftT += billTotals(b).total;
    } else if (st === 'unpaid' || st === 'partial' || st === 'overdue') {
      const bal = billBalance(b, payments);
      unpaidN++;
      unpaidT += bal;
      if (st === 'overdue') {
        overdueN++;
        overdueT += bal;
      }
    }
  }
  const tx = store.all('transactions');
  let trust = 0;
  for (const a of store.all('accounts')) if (a.type === 'trust') trust += accountBalance(a, tx);
  return card({
    title: 'Firm billing',
    actions: h('a.btn.sm.ghost', { href: '#/billing' }, 'Billing', icon('arrow-right', 14)),
    body: h(
      'div.stats.dash-stats',
      // Drafts and bills awaiting approval: both are still to be issued.
      stat({
        label: 'Draft bills',
        icon: 'file-pen',
        value: formatMoneyShort(draftT),
        sub: pendingN ? `${pluralize(draftN, 'draft')}, ${pendingN} pending approval` : pluralize(draftN, 'bill'),
        href: !draftN && pendingN ? '#/billing?status=pending' : '#/billing?status=draft',
      }),
      stat({ label: 'Unpaid', icon: 'receipt-text', value: formatMoneyShort(unpaidT), sub: pluralize(unpaidN, 'bill'), href: '#/billing?status=unpaid' }),
      stat({ label: 'Overdue', icon: 'alarm', value: formatMoneyShort(overdueT), sub: pluralize(overdueN, 'bill'), tone: overdueN ? 'danger' : '', href: '#/billing?status=overdue' }),
      stat({ label: 'Held in trust', icon: 'vault', value: formatMoneyShort(trust), sub: 'All trust accounts', href: '#/accounts' }),
    ),
  });
}

function recentMattersCard() {
  const store = app.store;
  const me = meId();
  const latest = new Map(); // matterId -> latest activity date
  const source = me ? where(store, 'activities', 'userId', me) : store.all('activities');
  for (const a of source) {
    if (!a.matterId) continue;
    const cur = latest.get(a.matterId);
    if (!cur || a.date > cur) latest.set(a.matterId, a.date);
  }
  let recent = [...latest.entries()]
    .map(([id, date]) => ({ m: lookup.matter(id), date }))
    .filter((x) => x.m && x.m.status !== 'closed')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6);
  if (!recent.length) {
    recent = store
      .all('matters')
      .filter((m) => m.status === 'open' && (!me || m.responsibleId === me))
      .slice(-6)
      .reverse()
      .map((m) => ({ m, date: '' }));
  }
  return card({
    title: 'Recent matters',
    actions: h('a.btn.sm.ghost', { href: '#/matters' }, 'Matters', icon('arrow-right', 14)),
    flush: true,
    body: recent.length
      ? h(
          'ul.recent-list',
          recent.map(({ m, date }) =>
            h(
              'li.recent-row',
              h(
                'div.grow',
                h('a.recent-title', { href: `#/matters/${m.id}` }, h('span.matter-num', m.displayNumber), ' ', m.description),
                h('div.dash-meta', lookup.contactName(m.clientId), date ? h('span', `Last worked ${formatDate(date, { month: 'short', day: 'numeric' })}`) : null),
              ),
              h(
                'button.icon-btn.bordered.sm',
                {
                  type: 'button',
                  'aria-label': `Start timer on ${matterLabel(m)}`,
                  title: 'Start timer on this matter',
                  onClick: async () => {
                    if (await startTimerOn(m.id)) toast(`Timer running on ${m.displayNumber || 'this matter'}`, { type: 'info' });
                  },
                },
                icon('play', 14),
              ),
              h(
                'button.icon-btn.bordered.sm',
                { type: 'button', 'aria-label': `Record time on ${matterLabel(m)}`, title: 'Record time', onClick: () => openActivityDialog({ kind: 'time', matterId: m.id }) },
                icon('clock', 14),
              ),
            ),
          ),
        )
      : emptyState({
          compact: true,
          icon: 'briefcase',
          title: 'No recent matters',
          text: 'Matters you work on will show up here.',
          actions: [h('a.btn.primary.sm', { href: '#/matters/new' }, 'New matter')],
          headingLevel: 3,
        }),
  });
}

function deadlinesCard() {
  const store = app.store;
  const today = app.today();
  const until = addDays(today, 60);
  const items = [];
  for (const m of store.all('matters')) {
    if (m.status === 'closed' || !m.solDate || m.solSatisfied || m.solDate > until) continue;
    items.push({ date: m.solDate, kind: 'sol', title: 'Statute of limitations', sub: matterLabel(m), href: `#/matters/${m.id}` });
  }
  for (const e of store.all('events')) {
    if ((e.kind !== 'deadline' && e.kind !== 'court') || e.date < today || e.date > addDays(today, 21)) continue;
    items.push({
      date: e.date,
      kind: e.kind,
      title: e.title,
      sub: [e.start && !e.allDay ? formatTime(e.start) : 'All day', e.matterId ? lookup.matter(e.matterId)?.displayNumber : ''].filter(Boolean).join(' · '),
      event: e,
    });
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return card({
    title: 'Upcoming deadlines',
    count: items.length || null,
    flush: true,
    body: items.length
      ? h(
          'ul.deadline-list',
          items.slice(0, 8).map((it) => {
            const d = diffDays(today, it.date);
            const tone = d < 0 ? 'danger' : d <= 7 ? 'danger' : d <= 30 ? 'warning' : 'neutral';
            const inner = [
              h(`span.deadline-date.${tone}`, h('span.dd-day', String(Number(it.date.slice(8)))), h('span.dd-mon', formatDate(it.date, { month: 'short' }))),
              h('span.grow', h('span.deadline-title', icon(it.kind === 'sol' ? 'flag' : it.kind === 'court' ? 'gavel' : 'alarm', 14), it.title), h('span.deadline-sub', it.sub)),
              h(`span.pill.${tone}`, d < 0 ? 'Passed' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `${d} days`),
            ];
            return h('li', it.href ? h('a.deadline-row', { href: it.href }, inner) : h('button.deadline-row', { type: 'button', onClick: () => openEventDialog({ event: it.event }) }, inner));
          }),
        )
      : h('div.dash-empty.pad', icon('circle-check', 18), h('span', 'No limitation dates or court deadlines coming up.')),
  });
}

// ---- Firm ---------------------------------------------------------------------------------

function firmView(ctx) {
  return h(
    'div.stack.dash-firm',
    ctx.live(() => firmStats(), ['activities', 'bills', 'payments', 'transactions', 'accounts']),
    h(
      'div.dash-grid',
      h(
        'div.dash-col',
        ctx.live(() => hoursByUserCard(), ['activities', 'users', 'settings']),
      ),
      h(
        'div.dash-col',
        ctx.live(() => agingCard(), ['bills', 'payments']),
      ),
    ),
  );
}

function firmStats() {
  const store = app.store;
  const today = app.today();
  const [ma, mb] = namedRange('month', today, app.settings().weekStart);
  let billableMin = 0;
  let value = 0;
  for (const a of store.all('activities')) {
    if (a.date < ma || a.date > mb) continue;
    if (a.kind === 'time' && a.billable !== false && a.matterId) billableMin += Number(a.minutes) || 0;
    if (a.billable !== false && a.matterId) value += activityAmount(a);
  }
  let billed = 0;
  let outstanding = 0;
  const payments = store.all('payments');
  for (const b of store.all('bills')) {
    if (b.status === 'draft' || b.status === 'pending' || b.status === 'void') continue;
    if (b.issueDate >= ma && b.issueDate <= mb) billed += billTotals(b).total;
    outstanding += billBalance(b, payments);
  }
  let collected = 0;
  for (const p of payments) if (p.date >= ma && p.date <= mb) collected += Number(p.amountCents) || 0;
  const tx = store.all('transactions');
  let trust = 0;
  for (const a of store.all('accounts')) if (a.type === 'trust') trust += accountBalance(a, tx);
  return h(
    'div.stats',
    stat({ label: 'Billable hours this month', icon: 'clock', value: formatHoursDecimal(billableMin, 1), sub: `${formatMoney(value)} of work`, href: '#/activities' }),
    stat({ label: 'Billed this month', icon: 'receipt-text', value: formatMoneyShort(billed), href: '#/billing?status=all' }),
    stat({ label: 'Collected this month', icon: 'hand-coins', value: formatMoneyShort(collected), tone: collected ? 'success' : '', href: '#/billing?status=paid' }),
    stat({ label: 'Accounts receivable', icon: 'coins', value: formatMoneyShort(outstanding), href: '#/billing/outstanding' }),
    stat({ label: 'Held in trust', icon: 'vault', value: formatMoneyShort(trust), href: '#/accounts' }),
  );
}

function hoursByUserCard() {
  const store = app.store;
  const today = app.today();
  const [ma, mb] = namedRange('month', today, app.settings().weekStart);
  const per = new Map();
  for (const a of store.all('activities')) {
    if (a.kind !== 'time' || a.date < ma || a.date > mb || !a.userId) continue;
    let r = per.get(a.userId);
    if (!r) per.set(a.userId, (r = { billable: 0, other: 0, value: 0 }));
    const min = Number(a.minutes) || 0;
    if (a.billable !== false && a.matterId) {
      r.billable += min;
      r.value += activityAmount(a);
    } else r.other += min;
  }
  // Active people, plus anyone deactivated who still recorded time this month.
  const users = [...lookup.activeUsers(), ...[...per.keys()].map((id) => lookup.user(id)).filter((u) => u && u.active === false)];
  const rows = users.map((u) => ({ u, ...(per.get(u.id) || { billable: 0, other: 0, value: 0 }) })).sort((a, b) => b.billable - a.billable);
  const totals = rows.reduce((t, r) => ({ billable: t.billable + r.billable, other: t.other + r.other, value: t.value + r.value }), { billable: 0, other: 0, value: 0 });
  return card({
    title: 'Hours by person this month',
    flush: true,
    body: rows.length
      ? h(
          'div.table-scroll',
          h(
            'table.table-plain.hours-table',
            h('caption.sr-only', 'Hours by person this month'),
            h(
              'thead',
              h(
                'tr',
                h('th', { scope: 'col' }, 'Person'),
                h('th.r', { scope: 'col' }, 'Billable'),
                h('th.r', { scope: 'col' }, 'Non-billable'),
                h('th', { scope: 'col' }, 'Target'),
                h('th.r', { scope: 'col' }, 'Value'),
              ),
            ),
            h(
              'tbody',
              rows.map((r) => {
                const target = Number(r.u.targetHours) || 0;
                const pct = target ? (r.billable / 60 / target) * 100 : 0;
                return h(
                  'tr',
                  h('td', h('span.user-chip', avatar(r.u.name, { color: r.u.color || colorFor(r.u.id), size: 'xs' }), h('span.truncate', r.u.name))),
                  h('td.r.num', formatHoursDecimal(r.billable, 1)),
                  h('td.r.num.subtle', formatHoursDecimal(r.other, 1)),
                  h(
                    'td.target-cell',
                    target
                      ? h(
                          'div.target-mini',
                          meter(pct, { label: `${r.u.name} progress toward ${target} hours`, tone: pct >= 100 ? 'success' : 'accent' }),
                          h('span.small.subtle.num', `${Math.round(pct)}% of ${target} h`),
                        )
                      : h('span.subtle.small', 'No target'),
                  ),
                  h('td.r', moneyCell(r.value, { muted: true })),
                );
              }),
            ),
            h(
              'tfoot',
              h('tr', h('td', 'Total'), h('td.r.num', formatHoursDecimal(totals.billable, 1)), h('td.r.num', formatHoursDecimal(totals.other, 1)), h('td'), h('td.r', moneyCell(totals.value))),
            ),
          ),
        )
      : emptyState({
          compact: true,
          icon: 'users',
          title: 'No firm users yet',
          text: 'Add the people in your firm to track their hours.',
          actions: [h('a.btn.sm.primary', { href: '#/settings/users' }, 'Firm users')],
          headingLevel: 3,
        }),
  });
}

function agingCard() {
  const store = app.store;
  const a = agingBuckets(store.all('bills'), store.all('payments'), app.today());
  const buckets = [
    ['Current', a.current, 'accent'],
    ['1 to 30 days', a.d30, 'warning'],
    ['31 to 60 days', a.d60, 'warning'],
    ['61 to 90 days', a.d90, 'danger'],
    ['Over 90 days', a.d90plus, 'danger'],
  ];
  const total = buckets.reduce((s, b) => s + b[1], 0);
  return card({
    title: 'Receivables aging',
    actions: h('a.btn.sm.ghost', { href: '#/billing/outstanding' }, 'Outstanding balances', icon('arrow-right', 14)),
    body: h(
      'div.stack',
      h('div.aging-total', h('span.stat-label', 'Total outstanding'), h('span.stat-value', formatMoney(total))),
      h(
        'ul.aging-list',
        buckets.map(([label, v, tone]) =>
          h(
            'li.aging-row',
            h('span.aging-label', label),
            h('div.aging-bar', meter(total ? (v / total) * 100 : 0, { label: `${label}: ${formatMoney(v)}`, tone })),
            h('span.num.aging-value', formatMoney(v)),
          ),
        ),
      ),
    ),
  });
}
