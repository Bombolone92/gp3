/** Reports: the standard list, and the report viewer with its toolbar. */
import { el, swap } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { selectInput, dateInput, segmented } from '../ui/fields.js';
import { download } from '../ui/dom.js';
import { navigate, setQuery } from '../ui/router.js';
import { toastError } from '../ui/toast.js';
import { pageHead, searchBox, viewState, emptyState, freshQuery } from './page.js';
import { openTxn } from '../forms/index.js';
import { store } from '../lib/store.js';
import { REPORTS, reportMeta, reportControls, runReport } from '../lib/reports.js';
import { PERIODS, periodRange, today, formatDate, formatRange } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';
import { toCSV } from '../lib/csv.js';

export function renderReportList(main) {
  const st = viewState('reports', { q: '' });
  const favs = new Set(store.settings.favoriteReports || []);
  const q = st.q.trim().toLowerCase();
  const toggleFav = (id) => {
    const next = favs.has(id) ? [...favs].filter((x) => x !== id) : [...favs, id];
    store.saveSettings({ favoriteReports: next });
  };
  const item = (r) => el('li.report-item', {},
    el('a.report-link', { href: `#/report/${r.id}` }, el('span', {}, r.title), el('span.cell-sub', {}, r.desc)),
    el('button.icon-btn.fav-btn', { type: 'button', 'aria-pressed': String(favs.has(r.id)), 'aria-label': `${favs.has(r.id) ? 'Remove' : 'Add'} ${r.title} ${favs.has(r.id) ? 'from' : 'to'} favorites`, html: icon('star', 18), onclick: () => toggleFav(r.id) }));
  const groups = [...new Set(REPORTS.map((r) => r.group))];
  const list = REPORTS.filter((r) => !q || `${r.title} ${r.desc} ${r.group}`.toLowerCase().includes(q));
  const favList = REPORTS.filter((r) => favs.has(r.id));
  swap(main, el('div.page', {},
    pageHead({ title: 'Reports', crumbs: [['Reports']] }),
    el('div.toolbar', {}, searchBox({ value: st.q, placeholder: 'Type report name here', label: 'Find a report', onInput: (v) => { st.q = v; renderReportList(main); main.querySelector('input[type="search"]')?.focus(); } })),
    !q && favList.length ? el('section.report-group', { 'aria-labelledby': 'rg-fav' }, el('h2', { id: 'rg-fav' }, 'Favorites'), el('ul.report-items', {}, favList.map(item))) : null,
    groups.map((g, i) => {
      const items = list.filter((r) => r.group === g);
      if (!items.length) return null;
      return el('section.report-group', { 'aria-labelledby': `rg-${i}` }, el('h2', { id: `rg-${i}` }, g), el('ul.report-items', {}, items.map(item)));
    }),
    !list.length ? emptyState({ iconName: 'reports', title: 'No reports match', text: 'Try another name.' }) : null));
}

function defaultsFor(id) {
  return {
    period: id === 'pnlMonthly' ? 'thisYearToDate' : 'thisFiscalYearToDate',
    from: null, to: null,
    asOf: today(),
    asOfPeriod: 'today',
    basis: store.settings.accountingMethod || 'accrual',
    columns: 'total',
    compare: null,
    collapsed: new Set(),
  };
}

export function renderReport(main, route) {
  const id = route.params[0];
  const meta = reportMeta(id);
  if (!meta) {
    swap(main, el('div.page', {}, emptyState({ title: 'Report not found', action: el('a.btn', { href: '#/reports' }, 'All reports') })));
    return;
  }
  const st = viewState(`report:${id}`, defaultsFor(id));
  const ctrl = reportControls(id);
  const query = freshQuery(route);
  if (query.from) { st.period = 'custom'; st.from = query.from; st.to = query.to || today(); }
  if (query.accounts) st.accounts = query.accounts.split(',');
  if (query.contact) st.contact = query.contact;
  const rerender = () => renderReport(main, { ...route, query: {} });

  let from = null; let to = null;
  if (st.period === 'custom') { from = st.from; to = st.to; }
  else ({ from, to } = periodRange(st.period, { now: today(), fiscalStartMonth: store.settings.fiscalStartMonth }));
  if (!st.from && st.period !== 'custom') { st.from = from; st.to = to; }

  // ---------------------------------------------------------- controls
  const periodSel = selectInput({ options: PERIODS, value: st.period, ariaLabel: 'Report period', onChange: (v) => {
    st.period = v;
    if (v !== 'custom') { const r = periodRange(v, { now: today(), fiscalStartMonth: store.settings.fiscalStartMonth }); st.from = r.from; st.to = r.to; }
    rerender();
  } });
  const fromIn = dateInput({ value: from, ariaLabel: 'From', onChange: (v) => { st.period = 'custom'; st.from = v; st.to = st.to || to; rerender(); } });
  const toIn = dateInput({ value: to, ariaLabel: 'To', onChange: (v) => { st.period = 'custom'; st.to = v; st.from = st.from || from; rerender(); } });
  const asOfIn = dateInput({ value: st.asOf, ariaLabel: 'As of', onChange: (v) => { st.asOf = v || today(); rerender(); } });
  const basis = segmented({ options: [['cash', 'Cash'], ['accrual', 'Accrual']], value: st.basis, ariaLabel: 'Accounting method', onChange: (v) => { st.basis = v; rerender(); } });
  const cols = selectInput({ options: id === 'bs' ? [['total', 'Total only'], ['month', 'Months'], ['quarter', 'Quarters']] : [['total', 'Total only'], ['month', 'Months'], ['quarter', 'Quarters'], ['year', 'Years']], value: st.columns, ariaLabel: 'Display columns by', onChange: (v) => { st.columns = v; rerender(); } });
  const compare = selectInput({ options: id === 'bs' ? [['', 'None'], ['prevYear', 'Previous year']] : [['', 'None'], ['prevPeriod', 'Previous period'], ['prevYear', 'Previous year (same period)']], value: st.compare || '', ariaLabel: 'Compare to', onChange: (v) => { st.compare = v || null; rerender(); } });

  const controls = el('div.report-controls', {},
    ctrl.range ? [
      el('div.field', {}, el('label.field-label', {}, 'Report period'), periodSel),
      el('div.field', {}, el('label.field-label', {}, 'From'), fromIn.root),
      el('div.field', {}, el('label.field-label', {}, 'To'), toIn.root),
    ] : el('div.field', {}, el('label.field-label', {}, 'As of'), asOfIn.root),
    ctrl.basis ? el('div.field', {}, el('span.field-label', {}, 'Accounting method'), basis.root) : null,
    ctrl.columns ? [
      el('div.field', {}, el('label.field-label', {}, 'Display columns by'), cols),
      el('div.field', {}, el('label.field-label', {}, 'Compare to'), compare),
    ] : null);

  // ----------------------------------------------------------- report
  let report;
  const t0 = performance.now();
  try {
    report = runReport(store, id, { from, to, asOf: st.asOf, basis: st.basis, columns: st.columns, compare: st.compare, accountIds: st.accounts || null });
  } catch (err) {
    toastError(err);
    report = { title: meta.title, subtitle: '', columns: [{ key: 'label', label: '' }], rows: [] };
  }
  if (st.contact) report = filterByContact(report, st.contact);
  const ms = Math.round(performance.now() - t0);

  const sheet = reportSheet(report, st, rerender, { from, to });
  const exportCsv = () => download(toCSV(reportToRows(report)), `${report.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${today()}.csv`, 'text/csv');
  const fav = (store.settings.favoriteReports || []).includes(id);

  swap(main, el('div.page.wide', {},
    el('div.report-top', {},
      el('a.back-link', { href: '#/reports' }, el('span', { html: icon('chevL', 16) }), 'Back to reports'),
      el('div.spacer'),
      el('button.icon-btn', { type: 'button', 'aria-pressed': String(fav), 'aria-label': fav ? 'Remove from favorites' : 'Add to favorites', title: fav ? 'Remove from favorites' : 'Add to favorites', class: 'fav-btn', html: icon('star', 18), onclick: () => store.saveSettings({ favoriteReports: fav ? store.settings.favoriteReports.filter((x) => x !== id) : [...(store.settings.favoriteReports || []), id] }) })),
    controls,
    el('div.report-tools', {},
      st.accounts ? el('button.chip', { type: 'button', 'aria-pressed': 'true', onclick: () => { st.accounts = null; rerender(); } }, `${st.accounts.length === 1 ? store.accountName(st.accounts[0]) : `${st.accounts.length} accounts`}`, el('span', { html: icon('x', 14) }), el('span.sr-only', {}, 'Remove account filter')) : null,
      st.contact ? el('button.chip', { type: 'button', 'aria-pressed': 'true', onclick: () => { st.contact = null; rerender(); } }, store.contactName(st.contact), el('span', { html: icon('x', 14) }), el('span.sr-only', {}, 'Remove filter')) : null,
      el('span.muted', { style: { fontSize: '12px' } }, `Ran in ${ms} ms`),
      el('div.spacer'),
      el('button.btn.btn-sm', { type: 'button', onclick: () => { for (const r of report.rows) if (r.group && r.kind === 'section') st.collapsed.add(r.group); rerender(); } }, 'Collapse'),
      el('button.btn.btn-sm', { type: 'button', onclick: () => { st.collapsed.clear(); rerender(); } }, 'Expand'),
      el('button.icon-btn', { type: 'button', 'aria-label': 'Export to CSV', title: 'Export to CSV', html: icon('download', 18), onclick: exportCsv }),
      el('button.icon-btn', { type: 'button', 'aria-label': 'Print or save as PDF', title: 'Print or save as PDF', html: icon('printer', 18), onclick: () => window.print() })),
    sheet));
}

function filterByContact(report, contactId) {
  return { ...report, rows: report.rows.filter((r) => !r.txnId || store.txn(r.txnId)?.contactId === contactId || r.kind !== 'row') };
}

function cellText(col, v) {
  if (v === null || v === undefined || v === '') return '';
  if (col.date) return formatDate(v);
  if (col.integer) return String(v);
  if (col.number) return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (col.percent) return `${(v / 100).toFixed(1)}%`;
  if (typeof v === 'number') return formatMoney(v);
  return String(v);
}

function reportSheet(report, st, rerender, { from, to }) {
  const company = store.settings.company?.name || 'My Company';
  const cols = report.columns;
  const visible = cols.filter((c) => !c.hidden);
  const hasLabel = !cols[0].hidden;
  const table = el('table.report-table', { 'aria-label': report.title, class: visible.length > 5 ? 'many-cols' : '' });
  table.append(el('thead', {}, el('tr', {}, visible.map((c, i) => el(`th${c.align === 'right' ? '.num' : ''}`, { scope: 'col' }, i === 0 && hasLabel ? el('span.sr-only', {}, 'Account') : c.label)))));
  const tb = el('tbody');
  const hiddenGroups = st.collapsed;
  // Very long reports (a general ledger over years) show their first rows
  // and say so, with the rest a click away; the CSV always has every row.
  const MAX = st.showAll ? Infinity : 4000;
  let shown = 0;
  let notShown = 0;
  let skipping = null;
  for (const r of report.rows) {
    // A collapsed section hides its rows down to its own total.
    if (skipping) {
      if ((r.kind === 'total' || r.kind === 'subtotal') && r.group === skipping) skipping = null;
      else continue;
    }
    if (shown >= MAX) { notShown++; continue; }
    shown++;
    const collapsed = r.kind === 'section' && r.group && hiddenGroups.has(r.group);
    const tr = el(`tr.rk-${r.kind}`, { class: `${r.emphasis ? 'rk-emph' : ''} ${r.muted ? 'muted' : ''}` });
    const cells = hasLabel ? [r.label, ...r.values] : r.values;
    cells.forEach((v, i) => {
      const col = hasLabel ? cols[i] : cols[i + 1];
      const td = el(`td${col.align === 'right' ? '.num' : ''}`);
      if (i === 0 && hasLabel) {
        td.style.paddingLeft = `${(r.kind === 'section' && r.group ? 4 : 28) + (r.depth || 0) * 18}px`;
        if (r.kind === 'section' && r.group) {
          const b = el('button.collapse-btn', { type: 'button', 'aria-expanded': String(!collapsed), 'aria-label': `${collapsed ? 'Expand' : 'Collapse'} ${r.label}`, html: icon(collapsed ? 'chevR' : 'chevDown', 14) });
          b.addEventListener('click', () => { if (collapsed) hiddenGroups.delete(r.group); else hiddenGroups.add(r.group); rerender(); });
          td.append(b);
        }
        if (r.txnId) td.append(el('button.row-link', { type: 'button', onclick: () => openTxn(r.txnId) }, v || ''));
        else td.append(v || '');
      } else {
        const text = cellText(col, v);
        const drillable = typeof v === 'number' && !col.date && !col.integer && !col.number && !col.percent && (r.drill?.accountId || r.drill?.contactId || r.drill?.report);
        if (drillable) {
          const b = el('button.drill', { type: 'button', title: 'Show transactions' }, text);
          b.addEventListener('click', () => drill(r, col, { from, to, basis: st.basis, asOf: st.asOf }));
          td.append(b);
        } else if (r.txnId && i === 1 && !hasLabel) {
          td.append(el('button.row-link', { type: 'button', onclick: () => openTxn(r.txnId) }, text));
        } else td.textContent = text;
        if (typeof v === 'number' && v < 0 && !col.integer) td.classList.add('neg');
      }
      tr.append(td);
    });
    tb.append(tr);
    if (collapsed) skipping = r.group;
  }
  table.append(tb);
  const more = notShown ? el('p.banner.banner-info.report-more', { role: 'status' },
    el('span', { html: icon('info', 18) }),
    el('span', {}, `Showing the first ${shown.toLocaleString()} of ${(shown + notShown).toLocaleString()} rows. `,
      el('button.btn-link', { type: 'button', onclick: () => { st.showAll = true; rerender(); } }, 'Show all rows'),
      ' or export to CSV for the complete report.')) : null;
  const note = report.balanced === false ? el('p.banner.banner-error', { role: 'alert' }, el('span', { html: icon('warn', 18) }), 'This report does not balance. Check for transactions with missing accounts.') : null;
  return el('div.report-sheet', {},
    el('header.report-header', {},
      el('div.report-company', {}, company),
      el('h1.report-title', { tabIndex: -1 }, report.title),
      el('div.report-sub', {}, report.subtitle || formatRange(from, to)),
      report.basis ? el('div.report-basis', {}, `${report.basis === 'cash' ? 'Cash' : 'Accrual'} basis`) : null),
    note,
    report.rows.length ? [el('div.report-scroll', {}, table), more] : emptyState({ iconName: 'reports', title: 'Nothing to report', text: 'There are no transactions for these settings.' }),
    report.notes?.length ? el('footer.report-notes', {}, report.notes.map((n) => el('p', {}, n))) : null,
    el('footer.report-foot', {}, `${report.basis === 'cash' ? 'Cash' : 'Accrual'} basis · ${new Date().toLocaleString()}`));
}

/** Clicking an amount shows the transactions behind it. */
function drill(r, col, { from, to, basis, asOf }) {
  if (r.drill?.report) { navigate(`report/${r.drill.report}`); return; }
  const range = col.from ? { from: col.from, to: col.to } : asOf && !from ? { from: null, to: asOf } : { from, to };
  if (r.drill?.accountId) {
    const st = viewState('report:gl', defaultsFor('gl'));
    st.period = 'custom';
    st.from = range.from || '1970-01-01';
    st.to = range.to || today();
    st.basis = basis;
    st.accounts = [r.drill.accountId, ...(r.drill.own ? [] : [...store.accounts.values()].filter((a) => a.parentId === r.drill.accountId).map((a) => a.id))];
    navigate('report/gl');
  } else if (r.drill?.contactId !== undefined) {
    navigate(r.drill.contactId ? `${store.contact(r.drill.contactId)?.kind === 'vendor' ? 'vendor' : 'customer'}/${r.drill.contactId}` : 'reports');
  }
}

function reportToRows(report) {
  const cols = report.columns;
  const hasLabel = !cols[0].hidden;
  const head = (hasLabel ? cols : cols.slice(1)).map((c) => c.label);
  const out = [[store.settings.company?.name || ''], [report.title], [report.subtitle || ''], [], head];
  for (const r of report.rows) {
    const cells = hasLabel ? [`${'  '.repeat(r.depth || 0)}${r.label || ''}`, ...r.values] : r.values;
    out.push(cells.map((v, i) => {
      const col = hasLabel ? cols[i] : cols[i + 1];
      if (v === null || v === undefined) return '';
      if (typeof v === 'number' && !col.integer && !col.number && !col.percent) return (v / 100).toFixed(2);
      if (col.percent && typeof v === 'number') return (v / 100).toFixed(1);
      return v;
    }));
  }
  return out;
}

export { setQuery };
