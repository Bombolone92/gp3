/** One report: parameters, summary, tables, print and CSV export. */
import { h, rafThrottle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../app.js';
import { pageHeader, emptyState, stat, spinner } from '../../ui/components.js';
import { toast } from '../../ui/toast.js';
import { reportById, CATEGORIES } from './catalog.js';
import { readParams, describeParams, paramBar } from './params.js';
import { sectionTable, downloadCSV } from './table.js';
import { favorites, toggleFavorite } from './favorites.js';

const financials = () => import('../../core/financials.js');

export function render(ctx) {
  const report = reportById(ctx.params.id);
  if (!report) {
    return h(
      'div.page',
      pageHeader({ title: 'Report not found', crumbs: [{ label: 'Reports', href: '#/reports' }] }),
      emptyState({ icon: 'search', title: 'This report does not exist', text: 'It may have been renamed. Pick a report from the list.', actions: [h('a.btn.primary', { href: '#/reports' }, 'All reports')], headingLevel: 2 }),
    );
  }
  const store = app.store;
  const p = readParams(report, ctx.query, app.today());
  const category = CATEGORIES.find((c) => c.id === report.category);
  let result = null;
  let token = 0;

  const sheet = h('article.report-sheet', { 'aria-busy': 'true', 'aria-labelledby': 'report-sheet-title' });
  const live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });

  function header() {
    const company = app.settings().company?.name;
    return h(
      'header.report-head',
      company ? h('div.report-company', company) : null,
      h('h2#report-sheet-title.report-title', report.title),
      h('div.report-meta', [...describeParams(report, p), `Generated ${new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`].map((t) => h('span', t))),
    );
  }

  async function draw() {
    const my = ++token;
    sheet.setAttribute('aria-busy', 'true');
    if (!result) sheet.replaceChildren(header(), h('div.report-loading', spinner(18), 'Preparing report'));
    let content;
    try {
      const out = await report.run(p, { store, today: app.today(), ledger: app.ledger(), financials });
      if (my !== token) return;
      const sections = out.sections || [];
      content = [
        out.summary?.length ? h('div.stats.report-stats', out.summary.map((s) => stat(s))) : null,
        sections.length ? sections.map((s) => sectionTable(s)) : h('p.report-empty', out.empty || 'Nothing to show for these settings.'),
      ];
      result = out;
    } catch (err) {
      console.error('[reports]', err);
      if (my !== token) return;
      result = null;
      content = emptyState({ compact: true, icon: 'alert', title: 'This report could not be prepared', text: 'Something went wrong while reading your records. Try again in a moment.', actions: [h('button.btn', { type: 'button', onClick: draw }, icon('refresh', 16), 'Try again')], headingLevel: 3 });
    }
    sheet.removeAttribute('aria-busy');
    sheet.replaceChildren(header(), ...[content].flat(2).filter(Boolean));
    live.textContent = `${report.title} updated`;
  }

  function exportCSV() {
    if (!result?.sections?.length) return toast('There is nothing to export for these settings.', { type: 'error' });
    const company = app.settings().company?.name;
    const head = [company, report.title, ...describeParams(report, p)].filter(Boolean);
    const stamp = p.asOf || p.to || app.today();
    downloadCSV(`${report.id}-${stamp}.csv`, result.sections, head);
  }

  // Printing shows only #print-root (see print.css). Build it from the
  // report sheet for the print button and for the browser's own print.
  function beforePrint() {
    const existing = document.getElementById('print-root');
    if (existing?.childElementCount) return;
    existing?.remove();
    const root = h('div#print-root.report-print', sheet.cloneNode(true));
    document.body.append(root);
    document.body.classList.add('print-sheet');
  }
  function afterPrint() {
    if (!document.querySelector('#print-root.report-print')) return;
    document.querySelector('#print-root.report-print').remove();
    document.body.classList.remove('print-sheet');
  }
  window.addEventListener('beforeprint', beforePrint);
  window.addEventListener('afterprint', afterPrint);
  ctx.onDispose(() => {
    window.removeEventListener('beforeprint', beforePrint);
    window.removeEventListener('afterprint', afterPrint);
    afterPrint();
  });

  const star = h('button.icon-btn.bordered.fav-btn', { type: 'button' });
  const paintStar = (on) => {
    star.setAttribute('aria-pressed', String(on));
    star.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
    star.title = on ? 'Remove from favorites' : 'Add to favorites';
    star.replaceChildren(icon('star', 18));
  };
  paintStar(favorites().has(report.id));
  star.addEventListener('click', () => paintStar(toggleFavorite(report.id)));

  const redraw = rafThrottle(draw);
  ctx.onDispose(store.subscribe((changed) => [...changed].some((c) => c !== 'sync') && redraw()));
  draw();

  return {
    node: h(
      'div.page.report-page',
      pageHeader({
        title: report.title,
        crumbs: [{ label: 'Reports', href: '#/reports' }, { label: category?.label || 'Reports', href: `#/reports?category=${report.category}` }],
        subtitle: report.description,
        actions: [
          star,
          h('button.btn', { type: 'button', onClick: exportCSV }, icon('file-down', 16), h('span.hide-mobile', 'Export CSV'), h('span.show-mobile', 'CSV')),
          h('button.btn', { type: 'button', onClick: () => window.print() }, icon('printer', 16), 'Print'),
        ],
      }),
      paramBar(report, p, () => {
        redraw();
      }),
      live,
      sheet,
    ),
    title: report.title,
  };
}
