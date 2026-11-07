/**
 * Reports: how the team is doing over a period. Everything is computed from
 * the local copy (see client/metrics.js), so changing the range or a filter
 * is instant. Sections: Overview, Agents, Satisfaction and Knowledge.
 */
import './reports.css';
import { h, clear, uid, debounce } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { selectField, emptyState, avatar } from '../ui/components.js';
import { createChart } from '../ui/charts.js';
import { toast } from '../ui/toast.js';
import { relTime } from '../ui/format.js';
import { STATUS_LABEL, PRIORITY_LABEL, CHANNEL_LABEL } from '../shared/model.js';
import {
  computeReport, resolveRange, articleStats, delta, toCsv, BACKLOG_STATUSES, PRIORITY_KEYS, dayKey,
} from '../client/metrics.js';
import { app } from '../app.js';

const STATE_KEY = 'help-desk:reports';
const SECTIONS = [
  ['overview', 'Overview', 'chart-column'],
  ['agents', 'Agents', 'users'],
  ['satisfaction', 'Satisfaction', 'thumbs-up'],
  ['knowledge', 'Knowledge', 'book-open'],
];
const RANGES = [
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
  ['month', 'This month'],
  ['custom', 'Custom range'],
];
const STATUS_COLOR = { new: '--st-new', open: '--st-open', pending: '--st-pending', hold: '--st-hold' };
const PRIORITY_COLOR = { urgent: '--pri-urgent', high: '--pri-high', normal: '--chart-1', low: '--pri-low', none: '--border-strong' };

const nf = new Intl.NumberFormat();
const pctFmt = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dayLongFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const rangeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** 45m, 3h 20m, 2d 4h */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-';
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  if (hrs < 24) return m % 60 ? `${hrs}h ${m % 60}m` : `${hrs}h`;
  const d = Math.floor(hrs / 24);
  return hrs % 24 ? `${d}d ${hrs % 24}h` : `${d}d`;
}

function pct(v) {
  return v === null || v === undefined ? '-' : pctFmt.format(v);
}

function loadState() {
  try {
    return { range: '30d', from: '', to: '', group: null, agent: null, channel: null, priority: null, ...JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}') };
  } catch {
    return { range: '30d', from: '', to: '', group: null, agent: null, channel: null, priority: null };
  }
}

export function mount(main, ctx) {
  const section = SECTIONS.some(([k]) => k === ctx.sub) ? ctx.sub : 'overview';
  const state = loadState();
  let charts = [];
  let report = null;
  let range = null;
  let agentSort = { key: 'solved', dir: 'desc' };
  let articleSort = { key: 'views', dir: 'desc' };

  const save = () => {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  };

  const rangeText = h('p.page-sub.reports-range');
  const exportBtn = h('button.btn.export-btn', { type: 'button', 'aria-label': 'Export CSV', title: 'Export as CSV', onclick: () => exportCsv() }, icon('download', { size: 15 }), h('span.export-label', 'Export CSV'));
  const nav = h('nav.seg', { 'aria-label': 'Report sections' }, SECTIONS.map(([k, label, ic]) =>
    h('a.seg-item', { href: `#/reports/${k}`, 'aria-current': k === section ? 'page' : undefined }, icon(ic, { size: 15 }), h('span', label))));
  const toolbar = h('div.report-toolbar', { role: 'group', 'aria-label': 'Report filters' });
  const body = h('div.report-body');
  const page = h('div.page.reports', h('div.page-inner.reports-inner',
    h('header.page-head.reports-head', h('div.grow', h('h1', 'Reports'), rangeText), exportBtn),
    nav, toolbar, body));
  main.append(page);

  /* ----------------------------------------------------------- toolbar */
  function paintToolbar() {
    clear(toolbar);
    // Knowledge numbers are all time and not per ticket, so nothing to filter.
    toolbar.hidden = section === 'knowledge';
    if (section === 'knowledge') return;
    const rangeId = uid('range');
    toolbar.append(h('div.report-filter', h('label.sr-only', { for: rangeId }, 'Date range'),
      selectField({ id: rangeId, value: state.range, label: 'Date range', options: RANGES.map(([value, label]) => ({ value, label })), onChange: (v) => { state.range = v; refresh(); paintToolbar(); } })));
    if (state.range === 'custom') {
      const fromId = uid('from');
      const toId = uid('to');
      const today = dayKey(Date.now());
      const mk = (id, key, label) => h('div.report-date', h('label.field-label', { for: id }, label), h(`input#${id}.input`, {
        type: 'date', value: state[key] || '', max: today,
        onchange: (e) => { state[key] = e.target.value; refresh(); },
      }));
      toolbar.append(h('div.report-dates', mk(fromId, 'from', 'From'), mk(toId, 'to', 'To')));
    }
    const groups = app.replica.cfg.groups || [];
    const filter = (key, label, options) => {
      const id = uid(key);
      return h('div.report-filter', h('label.sr-only', { for: id }, label),
        selectField({ id, value: state[key], label, options: [{ value: null, label: `All ${label.toLowerCase()}` }, ...options], onChange: (v) => { state[key] = v; refresh(); paintToolbar(); } }));
    };
    toolbar.append(
      filter('group', 'Groups', groups.map((g) => ({ value: g.id, label: g.name }))),
      filter('agent', 'Agents', app.replica.agents({ includeInactive: true }).map((a) => ({ value: a.uuid, label: a.name }))),
      filter('channel', 'Channels', Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label }))),
      filter('priority', 'Priorities', [...PRIORITY_KEYS.filter((p) => p !== 'none').map((p) => ({ value: p, label: PRIORITY_LABEL[p] })), { value: 'none', label: 'No priority' }]),
    );
    if (state.group || state.agent || state.channel || state.priority) {
      toolbar.append(h('button.btn.btn-ghost.btn-sm.report-clear', { type: 'button', onclick: () => { state.group = state.agent = state.channel = state.priority = null; refresh(); paintToolbar(); } }, icon('x', { size: 14 }), 'Clear filters'));
    }
  }

  /* ----------------------------------------------------------- compute */
  function compute() {
    range = resolveRange(state.range, Date.now(), { from: state.from, to: state.to });
    report = computeReport(app.replica.tickets.values(), {
      ...range,
      filters: { group: state.group, agent: state.agent, channel: state.channel, priority: state.priority },
      sla: app.replica.cfg.sla,
    });
    const last = range.to - 1;
    if (section === 'knowledge') {
      rangeText.textContent = 'Help center article views and votes, all time';
      return;
    }
    rangeText.textContent = `${rangeFmt.format(range.from)} to ${rangeFmt.format(last)}, compared with the ${range.days} days before`;
  }

  function destroyCharts() {
    charts.forEach((c) => c.destroy());
    charts = [];
  }

  function chart(spec, cls = '') {
    const c = createChart(spec);
    charts.push(c);
    if (cls) c.el.classList.add(...cls.split(' '));
    return c.el;
  }

  /* -------------------------------------------------------------- KPIs */
  function kpi({ label, value, cur, prev, better = 'up', format = (v) => nf.format(v), hint = '' }) {
    const d = delta(cur, prev, better);
    let chip = null;
    if (d && d.dir !== 'flat') {
      const amount = d.pct !== null ? pctFmt.format(Math.abs(d.pct)) : format(Math.abs(d.diff));
      chip = h(`span.kpi-delta.${d.good === null ? 'neutral' : d.good ? 'good' : 'bad'}`, icon(d.dir === 'up' ? 'arrow-up' : 'arrow-down', { size: 12 }), amount,
        h('span.sr-only', ` ${d.dir === 'up' ? 'higher' : 'lower'} than the previous period${d.good === null ? '' : `, which is ${d.good ? 'better' : 'worse'}`}`));
    } else if (d) chip = h('span.kpi-delta.flat', 'No change');
    return h('div.kpi', { title: hint || undefined },
      h('div.kpi-label', label),
      h('div.kpi-value', value),
      h('div.kpi-foot', chip, prev !== null && prev !== undefined ? h('span.kpi-prev', `Before: ${format(prev)}`) : h('span.kpi-prev', 'No earlier data')));
  }

  function kpis() {
    const c = report.current;
    const p = report.previous;
    return h('section.kpis', { 'aria-label': 'Key numbers' },
      kpi({ label: 'Tickets created', value: nf.format(c.created), cur: c.created, prev: p.created, better: null, hint: 'New tickets received in the period' }),
      kpi({ label: 'Tickets solved', value: nf.format(c.solved), cur: c.solved, prev: p.solved }),
      h('div.kpi', { title: 'Tickets that are new, open, pending or on hold right now' }, h('div.kpi-label', 'Open backlog'), h('div.kpi-value', nf.format(c.backlog)), h('div.kpi-foot', h('span.kpi-prev', 'Right now'))),
      kpi({ label: 'Median first reply', value: formatDuration(c.medianFirstReply), cur: c.medianFirstReply, prev: p.medianFirstReply, better: 'down', format: formatDuration, hint: 'Time from a ticket being created to the first public agent reply' }),
      kpi({ label: 'Median resolution', value: formatDuration(c.medianResolution), cur: c.medianResolution, prev: p.medianResolution, better: 'down', format: formatDuration, hint: 'Time from creation to solved, for tickets solved in the period' }),
      kpi({ label: 'One-touch resolution', value: pct(c.oneTouchRate), cur: c.oneTouchRate, prev: p.oneTouchRate, format: pct, hint: 'Solved tickets that needed only one agent reply' }),
      kpi({ label: 'Satisfaction', value: pct(c.csat.score), cur: c.csat.score, prev: p.csat.score, format: pct, hint: `Share of good ratings out of ${nf.format(c.csat.rated)} received` }),
      kpi({ label: 'First reply SLA met', value: pct(c.slaRate), cur: c.slaRate, prev: p.slaRate, format: pct, hint: 'Solved tickets whose first reply met the target for their priority' }),
    );
  }

  /* ------------------------------------------------------------ charts */
  function dailyChart() {
    const days = report.daily;
    const created = days.reduce((s, d) => s + d.created, 0);
    const solved = days.reduce((s, d) => s + d.solved, 0);
    return chart({
      kind: range.days > 45 ? 'line' : 'column',
      title: 'Created and solved',
      subtitle: 'Tickets per day',
      categoryLabel: 'Day',
      labels: days.map((d) => dayFmt.format(d.day)),
      tooltipLabels: days.map((d) => dayLongFmt.format(d.day)),
      series: [
        { name: 'Created', color: '--chart-1', values: days.map((d) => d.created) },
        { name: 'Solved', color: '--chart-2', values: days.map((d) => d.solved) },
      ],
      summary: `${nf.format(created)} tickets created and ${nf.format(solved)} solved over ${range.days} days.`,
      empty: 'No tickets were created or solved in this period',
    }, 'span-2');
  }

  function backlogChart() {
    const total = BACKLOG_STATUSES.reduce((s, k) => s + report.backlog[k], 0);
    return chart({
      kind: 'hbar',
      title: 'Backlog by status',
      subtitle: 'Unsolved tickets right now',
      categoryLabel: 'Status',
      labels: BACKLOG_STATUSES.map((s) => STATUS_LABEL[s]),
      colors: BACKLOG_STATUSES.map((s) => STATUS_COLOR[s]),
      series: [{ name: 'Tickets', color: '--chart-1', values: BACKLOG_STATUSES.map((s) => report.backlog[s]) }],
      summary: `${nf.format(total)} unsolved tickets: ${BACKLOG_STATUSES.map((s) => `${report.backlog[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(', ')}.`,
      empty: 'No unsolved tickets. Nice work.',
    });
  }

  function channelChart() {
    const keys = Object.keys(CHANNEL_LABEL).filter((k) => report.byChannel[k]);
    return chart({
      kind: 'hbar',
      title: 'By channel',
      subtitle: 'Tickets created',
      categoryLabel: 'Channel',
      labels: keys.map((k) => CHANNEL_LABEL[k]),
      series: [{ name: 'Tickets', color: '--chart-1', values: keys.map((k) => report.byChannel[k]) }],
      summary: keys.length ? keys.map((k) => `${CHANNEL_LABEL[k]}: ${report.byChannel[k]}`).join(', ') : 'No tickets created in this period.',
      empty: 'No tickets created in this period',
    });
  }

  function priorityChart() {
    const keys = PRIORITY_KEYS.filter((k) => report.byPriority[k]);
    const label = (k) => (k === 'none' ? 'No priority' : PRIORITY_LABEL[k]);
    return chart({
      kind: 'hbar',
      title: 'By priority',
      subtitle: 'Tickets created',
      categoryLabel: 'Priority',
      labels: keys.map(label),
      colors: keys.map((k) => PRIORITY_COLOR[k]),
      series: [{ name: 'Tickets', color: '--chart-1', values: keys.map((k) => report.byPriority[k]) }],
      summary: keys.length ? keys.map((k) => `${label(k)}: ${report.byPriority[k]}`).join(', ') : 'No tickets created in this period.',
      empty: 'No tickets created in this period',
    });
  }

  function heatChart() {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const hours = Array.from({ length: 24 }, (_, i) => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2020, 0, 1, i)));
    let best = [0, 0];
    report.heat.forEach((row, r) => row.forEach((v, c) => { if (v > report.heat[best[0]][best[1]]) best = [r, c]; }));
    const busiest = report.heat[best[0]][best[1]];
    return chart({
      kind: 'heatmap',
      title: 'Busiest hours',
      subtitle: 'New tickets by day and hour, in your time zone',
      rows: days,
      cols: hours,
      values: report.heat,
      unit: 'tickets',
      color: '--chart-1',
      summary: busiest ? `The busiest hour is ${days[best[0]]} at ${hours[best[1]]} with ${busiest} new tickets.` : 'No tickets created in this period.',
      empty: 'No tickets created in this period',
    }, 'span-2');
  }

  function csatChart() {
    const weeks = report.weekly;
    const rated = weeks.reduce((s, w) => s + w.rated, 0);
    return chart({
      kind: 'column',
      stacked: true,
      title: 'Satisfaction by week',
      subtitle: 'Good and bad ratings',
      categoryLabel: 'Week of',
      labels: weeks.map((w) => dayFmt.format(w.week)),
      tooltipLabels: weeks.map((w) => `Week of ${dayLongFmt.format(w.week)}${w.score !== null ? `, ${pctFmt.format(w.score)} good` : ''}`),
      series: [
        { name: 'Good', color: '--chart-2', values: weeks.map((w) => w.good) },
        { name: 'Bad', color: '--chart-3', values: weeks.map((w) => w.bad) },
      ],
      summary: rated ? `${nf.format(rated)} ratings, ${pct(report.current.csat.score)} good.` : 'No ratings in this period.',
      empty: 'No ratings in this period. Ratings are requested when a ticket is solved.',
    });
  }

  /* ------------------------------------------------------------ tables */
  function sortableTable({ caption, columns, rows, sort, onSort, empty }) {
    if (!rows.length) return h('p.report-empty', empty);
    const sorted = [...rows].sort((a, b) => {
      const col = columns.find((c) => c.key === sort.key);
      const x = col.sortValue ? col.sortValue(a) : a[sort.key];
      const y = col.sortValue ? col.sortValue(b) : b[sort.key];
      const nx = x === null || x === undefined ? -Infinity : x;
      const ny = y === null || y === undefined ? -Infinity : y;
      const r = typeof nx === 'string' ? nx.localeCompare(ny) : nx - ny;
      return sort.dir === 'asc' ? r : -r;
    });
    return h('div.report-table-wrap', h('table.table.report-table',
      h('caption.sr-only', caption),
      h('thead', h('tr', columns.map((c) => {
        const activeCol = sort.key === c.key;
        return h(`th${c.num ? '.num' : ''}`, { scope: 'col', 'aria-sort': activeCol ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined },
          onSort ? h('button.sort-btn', { type: 'button', onclick: () => onSort(c.key) }, c.label, icon(activeCol ? (sort.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down', { size: 12 })) : c.label);
      }))),
      h('tbody', sorted.map((r) => h('tr', columns.map((c) => h(`td${c.num ? '.num' : ''}`, c.render ? c.render(r) : r[c.key])))))));
  }

  function agentRows() {
    const rows = report.agents.map((a) => ({ ...a, name: app.memberName(a.uuid) }));
    // Agents with nothing in range still appear, so the table is a roster.
    for (const m of app.replica.agents()) {
      if (state.agent && state.agent !== m.uuid) continue;
      if (!rows.some((r) => r.uuid === m.uuid)) rows.push({ uuid: m.uuid, name: m.name, assigned: 0, solved: 0, open: 0, medianFirstReply: null, medianResolution: null, rated: 0, csat: null });
    }
    return rows;
  }

  function agentsTable() {
    return sortableTable({
      caption: 'Agent performance',
      sort: agentSort,
      onSort: (key) => {
        agentSort = { key, dir: agentSort.key === key && agentSort.dir === 'desc' ? 'asc' : 'desc' };
        render();
      },
      empty: 'No agents yet.',
      columns: [
        { key: 'name', label: 'Agent', sortValue: (r) => r.name.toLowerCase(), render: (r) => h('span.row.report-agent', avatar(r.name, { size: 'sm', agent: true }), h('span.ellipsis', r.name)) },
        { key: 'assigned', label: 'Assigned', num: true, render: (r) => nf.format(r.assigned) },
        { key: 'solved', label: 'Solved', num: true, render: (r) => nf.format(r.solved) },
        { key: 'open', label: 'Open now', num: true, render: (r) => nf.format(r.open) },
        { key: 'medianFirstReply', label: 'First reply', num: true, sortValue: (r) => (r.medianFirstReply === null ? null : -r.medianFirstReply), render: (r) => formatDuration(r.medianFirstReply) },
        { key: 'medianResolution', label: 'Resolution', num: true, sortValue: (r) => (r.medianResolution === null ? null : -r.medianResolution), render: (r) => formatDuration(r.medianResolution) },
        { key: 'csat', label: 'Satisfaction', num: true, render: (r) => (r.rated ? h('span', pct(r.csat), h('span.subtle', ` (${r.rated})`)) : h('span.subtle', '-')) },
      ],
      rows: agentRows(),
    });
  }

  function tagsTable(limit = 12) {
    const total = report.current.created || 1;
    const rows = report.tags.slice(0, limit);
    if (!rows.length) return h('p.report-empty', 'No tagged tickets in this period.');
    const max = rows[0].count;
    return h('ol.tag-bars', rows.map((t) => h('li.tag-bar',
      h('span.tag-name.ellipsis', t.tag),
      h('span.tag-track', { 'aria-hidden': 'true' }, h('span.tag-fill', { style: { width: `${(t.count / max) * 100}%` } })),
      h('span.tag-count', nf.format(t.count), h('span.subtle', pctFmt.format(t.count / total))))));
  }

  function card(title, sub, content, cls = '') {
    return h(`section.card.report-card${cls ? `.${cls}` : ''}`, h('div.card-head', h('div', h('h2', title), sub ? h('p.card-sub', sub) : null)), h('div.card-body', content));
  }

  function recentRatings() {
    const list = app.replica.ticketsFor((t) => t.csat?.at && t.csat.at >= range.from && t.csat.at < range.to && !t.deleted && !t.spam
      && (!state.group || t.group === state.group) && (!state.agent || t.assignee === state.agent) && (!state.channel || t.via === state.channel) && (!state.priority || (t.priority || 'none') === state.priority))
      .sort((a, b) => b.csat.at - a.csat.at).slice(0, 25);
    if (!list.length) return h('p.report-empty', 'No ratings in this period.');
    return h('ul.ratings', list.map((t) => h('li', h('a.rating', { href: `#/tickets/${t.id}` },
      h(`span.rating-icon.${t.csat.score}`, icon(t.csat.score === 'good' ? 'thumbs-up' : 'thumbs-down', { size: 15, label: t.csat.score === 'good' ? 'Good' : 'Bad' })),
      h('span.rating-main',
        h('span.rating-top', h('strong.ellipsis', app.userName(t.requester)), h('span.subtle', relTime(t.csat.at))),
        h('span.ellipsis.rating-subject', `#${t.id} ${t.subject}`),
        t.csat.comment ? h('span.rating-comment', `"${t.csat.comment}"`) : null)))));
  }

  function knowledge() {
    const stats = articleStats(app.replica.articles.values());
    if (!stats.length) {
      return emptyState({ glyph: 'book-open', title: 'No published articles yet', text: 'Publish articles in the Knowledge base to see how often customers read them and whether they help.', action: h('a.btn', { href: '#/kb' }, 'Open the knowledge base') });
    }
    const totalViews = stats.reduce((s, a) => s + a.views, 0);
    const up = stats.reduce((s, a) => s + a.up, 0);
    const down = stats.reduce((s, a) => s + a.down, 0);
    const top = stats.slice(0, 8);
    return h('div.report-grid',
      h('section.kpis.kpis-3.span-2', { 'aria-label': 'Knowledge base totals' },
        h('div.kpi', h('div.kpi-label', 'Published articles'), h('div.kpi-value', nf.format(stats.length))),
        h('div.kpi', h('div.kpi-label', 'Article views'), h('div.kpi-value', nf.format(totalViews)), h('div.kpi-foot', h('span.kpi-prev', 'All time'))),
        h('div.kpi', h('div.kpi-label', 'Found helpful'), h('div.kpi-value', up + down ? pct(up / (up + down)) : '-'), h('div.kpi-foot', h('span.kpi-prev', `${nf.format(up + down)} votes`)))),
      chart({ kind: 'hbar', title: 'Most viewed articles', subtitle: 'All time', categoryLabel: 'Article', labels: top.map((a) => (a.title.length > 42 ? `${a.title.slice(0, 41)}\u2026` : a.title)), tooltipLabels: top.map((a) => a.title), series: [{ name: 'Views', color: '--chart-5', values: top.map((a) => a.views) }], summary: top.map((a) => `${a.title}: ${a.views} views`).join(', '), empty: 'No article views yet. Views are counted when customers open articles in the help center.' }, 'span-2'),
      card('All articles', 'Views and votes from the help center', sortableTable({
        caption: 'Article performance',
        sort: articleSort,
        onSort: (key) => {
          articleSort = { key, dir: articleSort.key === key && articleSort.dir === 'desc' ? 'asc' : 'desc' };
          render();
        },
        empty: '',
        columns: [
          { key: 'title', label: 'Article', sortValue: (a) => a.title.toLowerCase(), render: (a) => h('a', { href: `#/kb/articles/${a.id}` }, a.title) },
          { key: 'views', label: 'Views', num: true, render: (a) => nf.format(a.views) },
          { key: 'up', label: 'Helpful', num: true, render: (a) => nf.format(a.up) },
          { key: 'down', label: 'Not helpful', num: true, render: (a) => nf.format(a.down) },
          { key: 'helpful', label: 'Helpful share', num: true, render: (a) => pct(a.helpful) },
        ],
        rows: stats,
      }), 'span-2'));
  }

  /* ------------------------------------------------------------ render */
  function render() {
    destroyCharts();
    clear(body);
    if (!app.replica.tickets.size && section !== 'knowledge') {
      body.append(emptyState({ glyph: 'chart-column', title: 'No tickets yet', text: 'Reports fill in as tickets arrive and get solved.', action: h('a.btn.btn-primary', { href: '#/tickets/new' }, icon('plus', { size: 14 }), 'New ticket') }));
      return;
    }
    if (section === 'overview') {
      body.append(kpis(), h('div.report-grid', dailyChart(), backlogChart(), card('Top tags', 'Tickets created, by tag', tagsTable(8)), channelChart(), priorityChart(), heatChart()));
    } else if (section === 'agents') {
      body.append(h('div.report-grid',
        card('Agent performance', 'Assigned and solved in the period, with median times', agentsTable(), 'span-2'),
        card('Top tags', 'Tickets created, by tag', tagsTable(20), 'span-2')));
    } else if (section === 'satisfaction') {
      const c = report.current.csat;
      const p = report.previous.csat;
      body.append(h('section.kpis.kpis-3', { 'aria-label': 'Satisfaction' },
        kpi({ label: 'Satisfaction score', value: pct(c.score), cur: c.score, prev: p.score, format: pct }),
        kpi({ label: 'Good ratings', value: nf.format(c.good), cur: c.good, prev: p.good }),
        kpi({ label: 'Bad ratings', value: nf.format(c.bad), cur: c.bad, prev: p.bad, better: 'down' })),
      h('div.report-grid', csatChart(), card('Recent ratings', 'Newest first', recentRatings())));
    } else {
      body.append(knowledge());
    }
  }

  function refresh() {
    save();
    compute();
    render();
  }

  function exportCsv() {
    if (section === 'knowledge') {
      const stats = articleStats(app.replica.articles.values());
      download(toCsv([['Article', 'Views', 'Helpful', 'Not helpful', 'Helpful share'], ...stats.map((a) => [a.title, a.views, a.up, a.down, ratioCell(a.helpful)])]), 'help-desk-articles.csv');
      return;
    }
    const c = report.current;
    const p = report.previous;
    const rows = [
      ['Report', 'Help desk', app.replica.meta?.name || ''],
      ['From', dayKey(range.from)], ['To', dayKey(range.to - 1)],
      [],
      ['Metric', 'This period', 'Previous period'],
      ['Tickets created', c.created, p.created],
      ['Tickets solved', c.solved, p.solved],
      ['Open backlog now', c.backlog, ''],
      ['Median first reply (minutes)', minutes(c.medianFirstReply), minutes(p.medianFirstReply)],
      ['Median resolution (minutes)', minutes(c.medianResolution), minutes(p.medianResolution)],
      ['One-touch resolution', ratioCell(c.oneTouchRate), ratioCell(p.oneTouchRate)],
      ['Satisfaction', ratioCell(c.csat.score), ratioCell(p.csat.score)],
      ['First reply SLA met', ratioCell(c.slaRate), ratioCell(p.slaRate)],
      [],
      ['Day', 'Created', 'Solved'],
      ...report.daily.map((d) => [dayKey(d.day), d.created, d.solved]),
      [],
      ['Status', 'Unsolved now'],
      ...BACKLOG_STATUSES.map((s) => [STATUS_LABEL[s], report.backlog[s]]),
      [],
      ['Channel', 'Created'],
      ...Object.entries(report.byChannel).map(([k, v]) => [CHANNEL_LABEL[k] || k, v]),
      [],
      ['Priority', 'Created'],
      ...PRIORITY_KEYS.map((k) => [k === 'none' ? 'No priority' : PRIORITY_LABEL[k], report.byPriority[k]]),
      [],
      ['Agent', 'Assigned', 'Solved', 'Open now', 'Median first reply (minutes)', 'Median resolution (minutes)', 'Ratings', 'Satisfaction'],
      ...agentRows().map((a) => [a.name, a.assigned, a.solved, a.open, minutes(a.medianFirstReply), minutes(a.medianResolution), a.rated, ratioCell(a.csat)]),
      [],
      ['Tag', 'Tickets'],
      ...report.tags.map((t) => [t.tag, t.count]),
    ];
    download(toCsv(rows), `help-desk-report-${dayKey(range.from)}-to-${dayKey(range.to - 1)}.csv`);
  }

  /** Save CSV text as a file; the byte order mark helps spreadsheets read UTF-8. */
  function download(csv, name) {
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('Report exported.', { kind: 'success' });
  }

  const onChange = debounce((e) => {
    const k = e.detail?.kinds;
    if (!k || k.has('t') || k.has('m') || k.has('c') || k.has('a')) refresh();
  }, 500);
  app.replica.addEventListener('change', onChange);

  document.title = 'Reports - Help Desk';
  paintToolbar();
  refresh();

  return () => {
    onChange.cancel();
    app.replica.removeEventListener('change', onChange);
    destroyCharts();
    document.title = 'Help Desk';
  };
}

function minutes(ms) {
  return ms === null || ms === undefined ? '' : Math.round(ms / 60000);
}

function ratioCell(v) {
  return v === null || v === undefined ? '' : Math.round(v * 1000) / 10 + '%';
}
