import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app, lookup } from '../app.js';
import { setQuery } from '../ui/router.js';
import { toCSV, downloadText } from '../core/csv.js';
import { addDays, formatDate } from '../core/dates.js';
import { COLLECTIONS } from '../core/schema.js';
import { barList } from '../ui/chart.js';
import { REPORTS } from './report-defs.js';
import { simpleTable, sortRows, emptyPage, money } from './common.js';

const PRESETS = [
  { id: '30', label: 'Last 30 days', range: (t) => ({ from: addDays(t, -29), to: t }) },
  { id: '90', label: 'Last 90 days', range: (t) => ({ from: addDays(t, -89), to: t }) },
  { id: 'ytd', label: 'This year', range: (t) => ({ from: `${t.slice(0, 4)}-01-01`, to: t }) },
  { id: 'lastyear', label: 'Last year', range: (t) => ({ from: `${Number(t.slice(0, 4)) - 1}-01-01`, to: `${Number(t.slice(0, 4)) - 1}-12-31` }) },
  { id: '365', label: 'Last 12 months', range: (t) => ({ from: addDays(t, -364), to: t }) },
  { id: 'all', label: 'All time', range: () => ({ from: null, to: null }) },
  { id: 'custom', label: 'Custom', range: null },
];

export function render(ctx) {
  const def = REPORTS[ctx.params.id];
  if (!def) return emptyPage('Report not found', 'Choose a report from the list.');
  const store = app.store;
  const today = app.today();
  const st = {
    preset: PRESETS.some((p) => p.id === ctx.query.range) ? ctx.query.range : '90',
    from: ctx.query.from || addDays(today, -89),
    to: ctx.query.to || today,
    group: ctx.query.group || '',
    type: ctx.query.type || '',
  };
  const preset = h('select.select.sm', { 'aria-label': 'Date range' }, PRESETS.map((p) => h('option', { value: p.id }, p.label)));
  preset.value = st.preset;
  const from = h('input.input.sm', { type: 'date', value: st.from, 'aria-label': 'From' });
  const to = h('input.input.sm', { type: 'date', value: st.to, 'aria-label': 'To' });
  const custom = h('span.row.gap-4', from, h('span.subtle', 'to'), to);
  const group = h('select.select.sm', { 'aria-label': 'Vehicle group' }, h('option', { value: '' }, 'All groups'), (app.settings().groups || []).map((g) => h('option', { value: g.id }, g.name)));
  group.value = st.group;
  // Types renamed or removed in settings stay on older vehicles.
  const types = [...new Set([...app.settings().vehicleTypes, ...store.all('vehicles').map((v) => v.type).filter(Boolean)])];
  const type = h('select.select.sm', { 'aria-label': 'Vehicle type' }, h('option', { value: '' }, 'All types'), types.map((t) => h('option', { value: t }, t)));
  type.value = st.type;
  // A link to a group or type that no longer exists shows "All", so it
  // must not quietly filter by it either.
  st.group = group.value;
  st.type = type.value;

  const range = () => (st.preset === 'custom' ? { from: st.from || null, to: st.to || null } : PRESETS.find((p) => p.id === st.preset).range(today));
  const sync = () => {
    st.preset = preset.value;
    st.from = from.value;
    st.to = to.value;
    st.group = group.value;
    st.type = type.value;
    custom.hidden = st.preset !== 'custom';
    setQuery({ range: st.preset, from: st.preset === 'custom' ? st.from : '', to: st.preset === 'custom' ? st.to : '', group: st.group, type: st.type });
    printRange.textContent = rangeText();
    body.redraw();
  };
  for (const el of [preset, from, to, group, type]) el.addEventListener('change', sync);
  custom.hidden = st.preset !== 'custom';

  let lastRows = [];
  const data = () => {
    const out = Object.fromEntries(COLLECTIONS.map((c) => [c, store.all(c)]));
    out.vehicles = out.vehicles.filter((v) => !v.archived && (!st.group || v.groupId === st.group) && (!st.type || v.type === st.type));
    return out;
  };
  const columns = def.columns(lookup);
  // While printing, the table shows every row instead of its first page.
  let printing = false;
  // The person's sort survives redraws (live updates, filter changes) and
  // orders the CSV export too.
  let sort = def.sort || null;
  const body = ctx.live(() => {
    const d = data();
    const r = range();
    let rows = def.run(d, r, today);
    // Hide vehicles with nothing in range so the table stays focused.
    const hasData = (row) => Object.entries(row).some(([k, v]) => !['id', 'vehicle', 'unit'].includes(k) && typeof v === 'number' && v);
    if (!def.noVehicles) rows = rows.filter(hasData);
    lastRows = rows;
    const totals = def.totals ? def.totals(rows) : [];
    const chart = def.chart ? def.chart([...rows]) : null;
    const extra = def.extra ? def.extra(d, r) : null;
    return h(
      'div.stack',
      totals.length ? h('div.metric-row.card', totals.map(([label, value]) => h('div.metric', h('span.metric-label', label), h('span.metric-value', value)))) : null,
      chart?.length ? h('section.card.panel', h('div.card-head', h('h2.grow', 'Top items')), h('div.card-body', barList(chart, { format: (v, row) => row.text ?? money(v) }))) : null,
      extra?.length ? h('section.card.panel', h('div.card-head', h('h2.grow', 'Most failed items')), h('div.card-body', barList(extra.map((x) => ({ label: x.label, value: x.count })), { format: (v) => `${v} times`, color: 'var(--danger)' }))) : null,
      h('section.card.panel', h('div.card-head', h('h2.grow', 'Details'), h('span.subtle', `${rows.length} rows`)), h('div.card-body.flush', simpleTable({ rows, columns, caption: def.title, defaultSort: sort, onSort: (x) => (sort = x), pageSize: printing ? Math.max(rows.length, 1) : 50, empty: 'No data for this period and filter.' }))),
    );
  }, ['vehicles', 'fuel', 'serviceEntries', 'expenses', 'meters', 'issues', 'inspections', 'reminders', 'renewals', 'parts', 'settings']);

  const exportCSV = () => {
    const cols = columns.filter((c) => c.csv || c.sort);
    downloadText(`${ctx.params.id}-report-${today}.csv`, toCSV([cols.map((c) => c.label), ...sortRows(lastRows, columns, sort).map((r) => cols.map((c) => (c.csv ? c.csv(r) : c.sort(r)) ?? ''))]));
  };
  const rangeText = () => {
    const r = range();
    const when = def.lifetime || (!r.from && !r.to) ? 'All time' : !r.to ? `From ${formatDate(r.from)}` : !r.from ? `Up to ${formatDate(r.to)}` : `${formatDate(r.from)} to ${formatDate(r.to)}`;
    // The filter menus are hidden on paper, so the printout names them.
    return [when, ...(def.noVehicles ? [] : [st.group ? lookup.groupName(st.group) : '', st.type])].filter(Boolean).join(' · ');
  };
  const printRange = h('span.print-only.subtle', rangeText());
  const beforePrint = () => ((printing = true), body.redraw());
  const afterPrint = () => ((printing = false), body.redraw());
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', afterPrint);
  ctx.onDispose(() => {
    window.removeEventListener('beforeprint', beforePrint);
    window.removeEventListener('afterprint', afterPrint);
  });
  return {
    node: h(
      'div.page.report-page',
      h(
        'header.page-header',
        h('div.titles', h('nav.crumbs', { 'aria-label': 'Breadcrumb' }, h('a', { href: '#/reports' }, 'Reports'), icon('chevron-right', 14), h('span', def.title)), h('h1', def.title), h('div.subtitle', def.description)),
        h('div.actions', h('button.btn', { type: 'button', onClick: () => print() }, icon('printer', 15), 'Print'), h('button.btn', { type: 'button', onClick: exportCSV }, icon('download', 15), 'Export CSV')),
      ),
      h('div.report-controls.card', def.lifetime ? h('span.subtle', 'Covers all time') : h('span.row.gap-4', icon('calendar', 15), preset, custom), def.noVehicles ? null : group, def.noVehicles ? null : type, printRange),
      body,
    ),
    title: def.title,
  };
}
