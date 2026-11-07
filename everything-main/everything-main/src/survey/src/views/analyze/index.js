/**
 * Analyze: the survey's results. Question summaries and individual
 * responses, with filters that apply to both and to exports.
 *
 * Responses show from this device's cache at once, then sync with the
 * collector (only new responses are fetched; see src/data/responses.js),
 * and quietly re-sync every minute while the tab is visible, so new
 * responses appear without a reload.
 */
import '../../styles/analyze.css';
import { h, replace, announce } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { showMenu, toast, toastError } from '../../lib/ui.js';
import { fmtNum, downloadText, slugify, plural, fmtRelative, fmtDate } from '../../lib/format.js';
import { applyFilters, describeFilters, emptyFilters, isFiltered, normalizeFilters, pruneFilters, removeFilter } from '../../analysis/filters.js';
import { toCsv, toJson } from '../../analysis/export.js';
import { summarizeAsync } from '../../analysis/run.js';
import { attachTooltips } from './charts.js';
import { overviewCard, renderSummaries } from './summary.js';
import { mountResponses } from './responses.js';
import { editFilters } from './filters-ui.js';

const POLL_MS = 60_000;

export async function mount(container, ctx) {
  const { app, session, sid } = ctx;
  let tab = ctx.route.sub === 'responses' ? 'responses' : 'summary';
  let all = [];
  let collectors = {};
  let filters = loadFilters();
  let syncing = false;
  let syncError = null;
  let lastSync = 0;
  let pollTimer = null;
  // False once the step is left: a sync still in flight must not redraw,
  // announce, or schedule another poll.
  let alive = true;
  let renderToken = 0;
  let responsesView = null;
  const chartViews = new Map();

  /* ---- Layout ---- */

  const count = h('p', { class: 'an-count', role: 'status' });
  const filterBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => openFilters() }, icon('filter', { size: 14 }), 'Filter');
  const tabs = h('div', { class: 'tabs an-tabs', role: 'tablist', 'aria-label': 'Result views' });
  const chips = h('div', { class: 'an-chips', 'aria-label': 'Active filters' });
  // Shown only on paper, where the app bar with the title is not printed.
  const printTitle = h('h2', null);
  const printCount = h('p', null);
  const printHead = h('div', { class: 'an-print-head', 'aria-hidden': 'true' }, printTitle, printCount);
  const banner = h('div', { class: 'an-banner-host' });
  const panel = h('div', { class: 'an-panel', role: 'tabpanel', id: 'an-panel' });
  const body = h('div', { class: 'an-body scroll' }, h('div', { class: 'an-inner' }, banner, panel));
  const root = h(
    'div',
    { class: 'an' },
    h('div', { class: 'an-head' }, tabs, h('div', { class: 'an-head-right' }, count, filterBtn)),
    printHead,
    chips,
    body,
  );
  container.append(root);
  const detachTips = attachTooltips(root);

  function drawTabs() {
    root.classList.toggle('an-mode-responses', tab === 'responses' && all.length > 0);
    const t = (id, label, href) =>
      h('a', { class: 'tab', role: 'tab', id: `an-tab-${id}`, href, 'aria-selected': String(tab === id), 'aria-controls': 'an-panel' }, label);
    // Built once and then updated in place: redrawing them would take focus
    // from the tab just used.
    if (!tabs.firstChild) replace(tabs, t('summary', 'Question summaries', `#/s/${sid}/analyze`), t('responses', 'Individual responses', `#/s/${sid}/analyze/responses`));
    for (const el of tabs.children) el.setAttribute('aria-selected', String(el.id === `an-tab-${tab}`));
    panel.setAttribute('aria-labelledby', `an-tab-${tab}`);
  }

  /* ---- Actions in the app bar ---- */

  const refreshBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon', 'aria-label': 'Refresh results', title: 'Refresh results', onclick: () => sync({ manual: true }) }, icon('refresh'));
  const exportBtn = h('button', { type: 'button', class: 'btn btn-sm', 'aria-haspopup': 'menu', 'aria-label': 'Export', title: 'Export', onclick: () => exportMenu() }, icon('download', { size: 14 }), h('span', { class: 'hide-narrow' }, 'Export'));
  ctx.frame.setActions([refreshBtn, exportBtn]);

  function filtered() {
    filters = pruneFilters(filters, session.survey);
    return applyFilters(all, filters);
  }

  function exportMenu() {
    const rows = filtered();
    const base = slugify(session.survey.title);
    const scope = isFiltered(filters) ? ' (filtered)' : '';
    showMenu(
      exportBtn,
      [
        { heading: `${plural(rows.length, 'response')}${scope}` },
        { label: 'Spreadsheet (CSV)', icon: 'table', disabled: !rows.length, run: () => downloadText(`${base}-responses.csv`, toCsv(session.survey, rows, collectors), 'text/csv;charset=utf-8') },
        { label: 'Data file (JSON)', icon: 'code', disabled: !rows.length, run: () => downloadText(`${base}-responses.json`, toJson(session.survey, rows, collectors), 'application/json') },
        'sep',
        { label: 'Print or save summary as PDF', icon: 'print', disabled: !rows.length, run: () => printSummary() },
      ],
      { align: 'end', label: 'Export' },
    );
  }

  async function printSummary() {
    if (tab !== 'summary') {
      tab = 'summary';
      // Keep the address in step, or the Individual responses tab would
      // link to the address already shown and do nothing.
      history.replaceState(history.state, '', `#/s/${sid}/analyze`);
      drawTabs();
      await render();
    }
    root.classList.add('an-printing');
    const done = () => {
      root.classList.remove('an-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    // Let the summary paint before the print dialog snapshots the page.
    requestAnimationFrame(() => setTimeout(() => window.print(), 50));
  }

  /* ---- Filters ---- */

  function filterKey() {
    return `sv:analyze-filters:${sid}`;
  }

  function loadFilters() {
    try {
      return normalizeFilters(JSON.parse(sessionStorage.getItem(`sv:analyze-filters:${ctx.sid}`) || 'null'));
    } catch {
      return emptyFilters();
    }
  }

  function setFilters(next) {
    filters = normalizeFilters(next);
    try {
      sessionStorage.setItem(filterKey(), JSON.stringify(filters));
    } catch {
      /* private mode: filters still apply for this visit */
    }
    render().then(() => announce(`Showing ${fmtNum(filtered().length)} of ${plural(all.length, 'response')}`));
  }

  async function openFilters() {
    const devicesSeen = [...new Set(all.map((r) => (r.meta && r.meta.device) || 'unknown'))];
    const next = await editFilters({ filters, survey: session.survey, collectors, devicesSeen });
    if (next) setFilters(next);
    filterBtn.focus();
  }

  function drawChips() {
    const list = describeFilters(filters, session.survey, collectors);
    filterBtn.classList.toggle('btn-primary', list.length > 0);
    filterBtn.lastChild.textContent = list.length ? `Filter (${list.length})` : 'Filter';
    replace(
      chips,
      list.length
        ? [
            list.map((c, i) =>
              h('span', { class: 'an-chip', title: c.label }, h('span', { class: 'an-chip-label' }, c.label), h('button', { type: 'button', class: 'an-chip-x', 'aria-label': `Remove filter: ${c.label}`, onclick: () => {
                setFilters(removeFilter(filters, c.key));
                // The chips were redrawn: on to the next one, or to Filter.
                const xs = chips.querySelectorAll('.an-chip-x');
                (xs[Math.min(i, xs.length - 1)] || filterBtn).focus();
              } }, icon('x', { size: 12 }))),
            ),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => (setFilters(emptyFilters()), filterBtn.focus()) }, 'Clear all'),
          ]
        : null,
    );
    chips.hidden = !list.length;
  }

  /* ---- Rendering ---- */

  function drawBanner() {
    if (syncError && all.length) {
      replace(banner, h('div', { class: 'banner banner-warn an-banner' }, icon('alert'), h('span', { class: 'grow' }, `Showing saved results${lastSync ? ` from ${fmtRelative(lastSync)}` : ''}. ${syncError}`),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => sync({ manual: true }) }, 'Retry')));
    } else if (session.meta.publishedAt && (session.survey.updatedAt || 0) > (session.meta.publishedVersion || 0)) {
      replace(banner, h('div', { class: 'banner an-banner' }, icon('info'), h('span', { class: 'grow' }, 'The survey has changed since it was published. Results show the current questions; answers to removed questions or choices are labeled as removed.')));
    } else replace(banner);
  }

  async function render() {
    const token = ++renderToken;
    // A summary this render replaces may have dimmed the panel; only the
    // summary branch below dims it again.
    panel.classList.remove('an-busy');
    const rows = filtered();
    count.textContent = `Respondents: ${fmtNum(rows.length)} of ${fmtNum(all.length)}`;
    printTitle.textContent = session.survey.title;
    printCount.textContent = `${count.textContent} · ${fmtDate(Date.now())}`;
    drawChips();
    drawBanner();
    drawTabs();
    filterBtn.disabled = !all.length;
    exportBtn.disabled = !all.length;

    if (!all.length) {
      if (responsesView) responsesView = (responsesView.unmount(), null);
      replace(
        panel,
        h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon('inbox', { size: 22 })), h('h2', null, syncing ? 'Checking for responses…' : 'No responses yet'),
          syncing ? h('div', { class: 'spinner' }) : h('p', null, 'Share your survey to start collecting answers. Results appear here as people respond.'),
          syncing ? null : h('a', { class: 'btn btn-primary', href: `#/s/${sid}/collect` }, icon('link', { size: 14 }), 'Share survey')),
      );
      return;
    }

    if (tab === 'responses') {
      if (!responsesView) {
        replace(panel);
        responsesView = mountResponses(panel, {
          getSurvey: () => session.survey,
          getCollectors: () => collectors,
          onDelete: async (keys) => {
            all = await app.responses.remove(sid, keys);
            await recordCount(all.length);
            await render();
          },
        });
      }
      responsesView.setData(all, rows);
      return;
    }

    if (responsesView) responsesView = (responsesView.unmount(), null);
    // Keep the previous summaries on screen (dimmed) while a large set is
    // being aggregated, instead of flashing a spinner.
    panel.classList.add('an-busy');
    const summary = await summarizeAsync(session.survey, rows);
    if (token !== renderToken) return;
    panel.classList.remove('an-busy');
    const cards = h('div', { class: 'an-cards' });
    renderSummaries(cards, { survey: session.survey, summary, views: chartViews, filtered: isFiltered(filters) });
    const scrollTop = body.scrollTop;
    // A redraw (new responses arriving) must not take focus from the reader:
    // give it back to the same control, caret and all.
    const active = panel.contains(document.activeElement) ? document.activeElement : null;
    const activeKey = active && active.dataset.anKey;
    const caret = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    replace(panel, overviewCard(rows, all.length), cards);
    body.scrollTop = scrollTop;
    const again = activeKey && panel.querySelector(`[data-an-key="${CSS.escape(activeKey)}"]`);
    if (again && !again.disabled) {
      again.focus({ preventScroll: true });
      if (caret) again.setSelectionRange?.(caret[0], caret[1]);
    }
  }

  /* ---- Data ---- */

  async function recordCount(n) {
    if ((session.meta.responses || 0) === n) return;
    try {
      await app.repo.patchMeta(sid, { responses: n });
      session.setMeta({ responses: n });
    } catch {
      /* the count refreshes on the next visit */
    }
  }

  async function sync({ manual = false } = {}) {
    if (syncing) return;
    syncing = true;
    refreshBtn.disabled = true;
    refreshBtn.classList.add('an-spin');
    if (!all.length) await render();
    const before = all.length;
    try {
      // The collector's response count, read after catching up, to spot
      // responses deleted elsewhere (null when it cannot be read).
      const expected = async () => {
        try {
          return (await app.client.stats(sid)).surveys[sid] ?? 0;
        } catch {
          return null;
        }
      };
      const synced = await app.responses.sync(sid, { expectedCount: expected });
      if (!alive) return;
      all = synced;
      syncError = null;
      lastSync = Date.now();
      await recordCount(all.length);
      if (manual) toast(all.length > before ? `${plural(all.length - before, 'new response')}` : 'Results are up to date');
      else if (all.length > before && before) announce(`${plural(all.length - before, 'new response')}`);
    } catch (err) {
      if (!alive) return;
      console.error(err);
      syncError = 'Could not reach the response collector.';
      if (manual) toastError('Could not refresh results. Check your connection and try again.');
    } finally {
      syncing = false;
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('an-spin');
    }
    if (syncError && !all.length) {
      replace(
        panel,
        h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon('alert', { size: 22 })), h('h2', null, 'Could not load results'), h('p', null, 'Check your connection and try again.'),
          h('button', { type: 'button', class: 'btn', onclick: () => sync({ manual: true }) }, 'Try again')),
      );
      return;
    }
    if (manual || all.length !== before || !panel.firstChild || panel.querySelector('.spinner')) await render();
    else drawBanner();
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (!alive) return;
      if (document.visibilityState === 'visible') await sync();
      if (alive) schedulePoll();
    }, POLL_MS);
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible' && Date.now() - lastSync > POLL_MS) sync();
  };

  /* ---- Start ---- */

  drawTabs();
  const cfg = await app.client.peek().catch(() => null);
  const published = !!session.meta.publishedAt;
  collectors = await app.repo.loadCollectors(sid).catch(() => ({}));
  all = await app.responses.cached(sid).catch(() => []);

  // Nothing to show yet. With responses saved on this device, show them
  // even when the collector cannot be reached (peek fails offline).
  if (!all.length && (!cfg || !published)) {
    count.textContent = '';
    filterBtn.disabled = true;
    exportBtn.disabled = true;
    refreshBtn.disabled = true;
    replace(
      panel,
      h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon('chartBar', { size: 22 })), h('h2', null, 'No results yet'),
        h('p', null, 'Publish your survey and share its link. Responses and charts show up here as soon as people answer.'),
        h('a', { class: 'btn btn-primary', href: `#/s/${sid}/collect` }, icon('link', { size: 14 }), 'Share survey')),
    );
    return {
      update(r) {
        tab = r.sub === 'responses' ? 'responses' : 'summary';
        drawTabs();
      },
      unmount() {
        detachTips();
      },
    };
  }

  await render();
  sync();
  schedulePoll();
  document.addEventListener('visibilitychange', onVisible);
  const unsubscribe = session.subscribe((doc, change) => {
    // Question edits in another step re-label results the next time they draw.
    if (change && change.type === 'meta') drawBanner();
  });

  return {
    update(r) {
      const next = r.sub === 'responses' ? 'responses' : 'summary';
      if (next === tab) return;
      tab = next;
      render();
    },
    unmount() {
      alive = false;
      renderToken++;
      clearTimeout(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
      detachTips();
      if (responsesView) responsesView.unmount();
    },
  };
}
