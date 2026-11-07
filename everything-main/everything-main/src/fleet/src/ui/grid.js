/**
 * The list screen used across the app.
 *
 * renderList(ctx, {
 *   key, title, coll | rows(): [], watch: [colls],
 *   tabs: [{ id, label, filter(row) }],             // first is the default
 *   filters: [{ id, label, options(): [{ value, label }], match(row, values) }],
 *   columns: [{ id, label, render(row), sort?(row), csv?(row), align, hidden, width, sticky }],
 *   search(row) -> string, rowHref(row), rowClick(row), mobile(row) -> node,
 *   defaultSort: { id, dir }, actions: [nodes], more: [menu items],
 *   bulk: [{ label, icon, danger, run(rows, button, tab) }], summary(rows) -> node,
 *     (label and icon may be functions of the current tab id)
 *   empty: { icon, title, text, action }, csvName, intro,
 * })
 *
 * Rows render a page at a time, so lists of thousands stay fast. Sort,
 * visible columns, and page size are remembered per list; tab, search, and
 * filters live in the URL so a filtered view can be bookmarked.
 */
import { h, debounce, uniqueId, isTypingTarget } from './dom.js';
import { icon } from './icons.js';
import { app } from '../app.js';
import { setQuery } from './router.js';
import { openPopover, openMenu } from './menu.js';
import { emptyState } from './components.js';
import { matches } from '../core/format.js';
import { toCSV, downloadText } from '../core/csv.js';
import { today } from '../core/dates.js';

const PAGE_SIZES = [25, 50, 100, 200];

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(`fleet.list.${key}`) || 'null');
    return v && typeof v === 'object' ? { ...fallback, ...v } : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(`fleet.list.${key}`, JSON.stringify(value));
  } catch {}
}

// Missing values, and numbers that failed to parse, sort as empty.
const isEmpty = (v) => v === null || v === undefined || v === '' || Number.isNaN(v);

export function compareValues(va, vb) {
  if (va === vb) return 0;
  const ea = isEmpty(va);
  const eb = isEmpty(vb);
  if (ea || eb) return ea && eb ? 0 : ea ? 1 : -1;
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
}

export function renderList(ctx, config) {
  const store = app.store;
  const prefs = load(config.key, {
    sort: config.defaultSort || null,
    hidden: config.columns.filter((c) => c.hidden).map((c) => c.id),
    pageSize: 50,
  });
  const state = {
    tab: ctx.query.tab && config.tabs?.some((t) => t.id === ctx.query.tab) ? ctx.query.tab : config.tabs?.[0]?.id,
    q: ctx.query.q || '',
    filters: {},
    page: 0,
    selected: new Set(),
  };
  for (const f of config.filters || []) {
    const v = ctx.query[`f_${f.id}`];
    if (v) state.filters[f.id] = new Set(v.split(','));
  }

  const allRows = () => (config.rows ? config.rows() : store.all(config.coll));
  const visibleCols = () => config.columns.filter((c) => !prefs.hidden.includes(c.id));

  // ---- Filtering and sorting -----------------------------------------------------

  const textCache = new WeakMap();
  const textOf = (r) => {
    let t = textCache.get(r);
    if (t === undefined) {
      t = config.search ? config.search(r) : '';
      textCache.set(r, t);
    }
    return t;
  };

  function passesFilters(r, skip = null) {
    for (const f of config.filters || []) {
      if (f.id === skip) continue;
      const vals = state.filters[f.id];
      if (vals?.size && !f.match(r, vals)) return false;
    }
    return true;
  }

  function filtered() {
    const tab = config.tabs?.find((t) => t.id === state.tab);
    const rows = allRows().filter((r) => (!tab?.filter || tab.filter(r)) && passesFilters(r) && (!state.q || matches(textOf(r), state.q)));
    const col = prefs.sort && config.columns.find((c) => c.id === prefs.sort.id);
    if (col?.sort) {
      const dir = prefs.sort.dir === 'desc' ? -1 : 1;
      const keyed = rows.map((r) => [col.sort(r), r]);
      keyed.sort((a, b) => {
        const c = compareValues(a[0], b[0]);
        // Empty values stay last in both directions.
        if (isEmpty(a[0]) || isEmpty(b[0])) return c;
        return c * dir;
      });
      return keyed.map((k) => k[1]);
    }
    return rows;
  }

  // ---- Chrome --------------------------------------------------------------------------

  const moreBtn = config.more?.length || config.csvName
    ? h('button.icon-btn.bordered', { type: 'button', 'aria-label': 'More actions', title: 'More actions', onClick: (e) => openMenu(e.currentTarget, moreItems(), { align: 'end' }) }, icon('more'))
    : null;

  function moreItems() {
    const items = [...(config.more || [])];
    if (config.csvName) {
      if (items.length) items.push({ separator: true });
      items.push({ label: 'Export to CSV', icon: 'download', run: exportCSV });
    }
    return items;
  }

  const header = h(
    'header.page-header.list-header',
    h('div.titles', h('h1', config.title), config.intro ? h('div.subtitle', config.intro) : null),
    h('div.actions', moreBtn, ...(config.actions || [])),
  );

  const tabsNode = config.tabs?.length > 1 ? h('div.list-tabs', { role: 'tablist', 'aria-label': `${config.title} views` }) : null;
  const search = h('input.input.sm', { type: 'search', value: state.q, placeholder: 'Search', 'aria-label': `Search ${config.title.toLowerCase()}`, autocomplete: 'off', spellcheck: 'false' });
  const fireSearch = debounce(() => {
    state.q = search.value;
    state.page = 0;
    setQuery({ q: state.q });
    drawBody();
  }, 120);
  search.addEventListener('input', fireSearch);
  // A search typed just before leaving must not land in the next page's URL.
  ctx.onDispose(() => fireSearch.cancel());
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      e.stopPropagation();
      search.value = '';
      fireSearch();
    }
  });

  const filterBar = h('div.filter-bar');
  const pager = h('div.pager');
  const colBtn = h('button.icon-btn.bordered.sm', { type: 'button', 'aria-label': 'Choose columns', title: 'Choose columns', onClick: (e) => openColumns(e.currentTarget) }, icon('columns', 16));
  const toolbar = h('div.grid-toolbar', h('div.input-affix.search.grid-search', icon('search', 15), search), filterBar, h('div.grow'), pager, h('span.hide-mobile', colBtn));
  const bulkBar = h('div.bulk-bar', { hidden: true, role: 'region', 'aria-label': 'Selected rows' });
  const summaryNode = h('div.grid-summary');
  const body = h('div.grid-body', { id: uniqueId('grid') });
  const live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });

  // The rows are the tab panel the saved-view tabs control.
  if (tabsNode) body.setAttribute('role', 'tabpanel');
  function drawTabs() {
    if (!tabsNode) return;
    const base = allRows();
    tabsNode.replaceChildren(
      ...config.tabs.map((t) => {
        const count = t.count === false ? null : base.filter((r) => !t.filter || t.filter(r)).length;
        const b = h(
          'button',
          {
            type: 'button',
            role: 'tab',
            id: `${body.id}-tab-${t.id}`,
            'aria-controls': body.id,
            'aria-selected': String(t.id === state.tab),
            tabindex: t.id === state.tab ? '0' : '-1',
            onClick: () => {
              state.tab = t.id;
              state.page = 0;
              state.selected.clear();
              setQuery({ tab: t.id === config.tabs[0].id ? '' : t.id });
              drawTabs();
              drawBody();
            },
          },
          ...[t.dot ? h(`span.tab-dot.${t.dot}`) : null, t.label, count !== null ? h('span.tab-count', String(count)) : null].filter((x) => x !== null),
        );
        return b;
      }),
    );
    body.setAttribute('aria-labelledby', `${body.id}-tab-${state.tab}`);
  }
  tabsNode?.addEventListener('keydown', (e) => {
    const btns = [...tabsNode.querySelectorAll('[role="tab"]')];
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % btns.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + btns.length) % btns.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = btns.length - 1;
    if (n !== null) {
      e.preventDefault();
      btns[n].click();
      tabsNode.querySelectorAll('[role="tab"]')[n].focus();
    }
  });

  // The buttons are kept and updated, not rebuilt: each anchors its open
  // popover, which gives focus back to it on close.
  const filterBtns = new Map();
  function drawFilters() {
    filterBar.replaceChildren(
      ...[...(config.filters || []).map((f) => {
        const vals = state.filters[f.id];
        const n = vals?.size || 0;
        const label = n === 1 ? `${f.label}: ${f.options().find((o) => String(o.value) === [...vals][0])?.label || [...vals][0]}` : n ? `${f.label} (${n})` : f.label;
        let btn = filterBtns.get(f.id);
        if (!btn) {
          btn = h('button.filter-btn', { type: 'button', 'aria-haspopup': 'dialog', onClick: (e) => openFilter(e.currentTarget, f) });
          filterBtns.set(f.id, btn);
        }
        btn.classList.toggle('active', Boolean(n));
        btn.replaceChildren(h('span.truncate', label), icon('chevron-down', 14));
        return btn;
      }),
      Object.values(state.filters).some((s) => s.size)
        ? h(
            'button.link-btn.clear-filters',
            {
              type: 'button',
              onClick: () => {
                state.filters = {};
                state.page = 0;
                syncFilterQuery();
                drawFilters();
                drawBody();
                // This button is gone now; keep focus in the filter bar.
                filterBar.querySelector('.filter-btn')?.focus();
              },
            },
            'Clear',
          )
        : null].filter(Boolean),
    );
  }

  function syncFilterQuery() {
    const patch = {};
    for (const f of config.filters || []) patch[`f_${f.id}`] = state.filters[f.id]?.size ? [...state.filters[f.id]].join(',') : '';
    setQuery(patch);
  }

  function openFilter(anchor, f) {
    openPopover(
      anchor,
      ({ close }) => {
        const vals = new Set(state.filters[f.id] || []);
        const base = allRows().filter((r) => passesFilters(r, f.id));
        const opts = f.options();
        const findInput = opts.length > 8 ? h('input.input.sm', { type: 'search', placeholder: `Find ${f.label.toLowerCase()}`, 'aria-label': `Find ${f.label.toLowerCase()}` }) : null;
        const list = h('div.filter-options', { role: 'group', 'aria-label': f.label });
        const apply = () => {
          state.filters[f.id] = new Set(vals);
          state.page = 0;
          syncFilterQuery();
          drawFilters();
          drawBody();
        };
        const draw = () => {
          const q = findInput?.value || '';
          list.replaceChildren(
            ...opts
              .filter((o) => !q || matches(o.label, q))
              .map((o) => {
                const count = base.filter((r) => f.match(r, new Set([String(o.value)]))).length;
                const cb = h('input', { type: 'checkbox', checked: vals.has(String(o.value)) });
                cb.addEventListener('change', () => {
                  if (cb.checked) vals.add(String(o.value));
                  else vals.delete(String(o.value));
                  apply();
                });
                return h('label.check.filter-option', cb, o.dot ? h(`span.dot-status.${o.dot}`) : null, h('span.grow.truncate', o.label), h('span.subtle.num', String(count)));
              }),
          );
          if (!list.children.length) list.append(h('p.subtle.filter-none', 'No options'));
        };
        findInput?.addEventListener('input', draw);
        draw();
        return h(
          'div.filter-pop',
          findInput,
          list,
          h(
            'div.filter-foot',
            h('button.link-btn', { type: 'button', onClick: () => (vals.clear(), apply(), draw()) }, 'Clear'),
            h('button.btn.sm', { type: 'button', onClick: () => close() }, 'Done'),
          ),
        );
      },
      { label: `Filter by ${f.label.toLowerCase()}`, width: 280 },
    );
  }

  function openColumns(anchor) {
    openPopover(
      anchor,
      () =>
        h(
          'div.filter-pop',
          h('div.menu-label', 'Columns'),
          h(
            'div.filter-options',
            config.columns
              .filter((c) => c.label && !c.fixed)
              .map((c) => {
                const cb = h('input', { type: 'checkbox', checked: !prefs.hidden.includes(c.id) });
                cb.addEventListener('change', () => {
                  prefs.hidden = cb.checked ? prefs.hidden.filter((x) => x !== c.id) : [...prefs.hidden, c.id];
                  save(config.key, prefs);
                  drawBody();
                });
                return h('label.check.filter-option', cb, h('span.grow', c.label));
              }),
          ),
        ),
      { align: 'end', label: 'Choose columns', width: 240 },
    );
  }

  // ---- Body ----------------------------------------------------------------------------

  let current = [];
  let focusRow = -1;

  // Redraws replace the pager, header, and rows. Put focus back on the same
  // control (by its data-fk key) so keyboard users keep their place.
  function drawBody() {
    const fk = document.activeElement?.dataset?.fk;
    drawRows();
    if (!fk || document.activeElement?.dataset?.fk === fk) return;
    const find = (k) => [...pager.querySelectorAll('[data-fk]'), ...bulkBar.querySelectorAll('[data-fk]'), ...body.querySelectorAll('[data-fk]')].find((el) => el.dataset.fk === k && !el.disabled);
    // Paged to the first or last page, the button just used is disabled;
    // the selection bar's buttons go away with the selection.
    const fallbacks = { prev: ['next'], next: ['prev'], 'bulk-all': ['bulk-clear', 'all'], 'bulk-clear': ['all'] };
    const keys = [fk, ...(fallbacks[fk] || (fk.startsWith('bulk:') ? ['bulk-clear', 'all'] : []))];
    for (const k of keys) {
      const el = find(k);
      if (el) return el.focus({ preventScroll: true });
    }
  }

  function drawRows() {
    current = filtered();
    const cols = visibleCols();
    const pageSize = prefs.pageSize || 50;
    const pages = Math.max(1, Math.ceil(current.length / pageSize));
    if (state.page >= pages) state.page = pages - 1;
    const start = state.page * pageSize;
    const pageRows = current.slice(start, start + pageSize);
    if (state.selected.size) {
      const ids = new Set(current.map((r) => r.id));
      for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);
    }

    drawPager(start, pageRows.length, pages);
    summaryNode.replaceChildren(...[config.summary ? config.summary(current) : null].filter(Boolean));
    // Rewriting the same text re-announces it, on every sync and checkbox.
    const count = `${current.length} ${current.length === 1 ? 'result' : 'results'}`;
    if (live.textContent !== count) live.textContent = count;
    drawBulk();
    focusRow = -1;

    if (!current.length) {
      const base = allRows();
      body.replaceChildren(
        base.length
          ? emptyState({ compact: true, icon: 'search', title: 'No matching records', text: 'Try a different search, view, or filter.', headingLevel: 2 })
          : emptyState({ icon: config.empty?.icon || 'inbox', title: config.empty?.title || 'Nothing here yet', text: config.empty?.text || '', actions: config.empty?.action ? [config.empty.action()] : null, headingLevel: 2 }),
      );
      return;
    }

    const selectable = Boolean(config.bulk?.length);
    const allOnPage = pageRows.every((r) => state.selected.has(r.id));
    const headCb = selectable ? h('input', { type: 'checkbox', 'aria-label': 'Select all on this page', checked: allOnPage && pageRows.length > 0, dataset: { fk: 'all' } }) : null;
    if (headCb) {
      headCb.indeterminate = !allOnPage && pageRows.some((r) => state.selected.has(r.id));
      headCb.addEventListener('change', () => {
        for (const r of pageRows) headCb.checked ? state.selected.add(r.id) : state.selected.delete(r.id);
        drawBody();
      });
    }
    const thead = h(
      'thead',
      h(
        'tr',
        selectable ? h('th.check-col', { scope: 'col' }, headCb) : null,
        cols.map((c) => {
          const active = prefs.sort?.id === c.id;
          return h(
            `th${c.align === 'r' ? '.r' : ''}${c.cls ? '.' + c.cls : ''}`,
            { scope: 'col', 'aria-sort': active ? (prefs.sort.dir === 'desc' ? 'descending' : 'ascending') : null, style: c.width ? { width: c.width } : null },
            c.sort
              ? h(
                  'button.sort',
                  {
                    type: 'button',
                    dataset: { fk: `sort:${c.id}` },
                    onClick: () => {
                      prefs.sort = { id: c.id, dir: active && prefs.sort.dir === 'asc' ? 'desc' : 'asc' };
                      save(config.key, prefs);
                      drawBody();
                    },
                  },
                  c.label,
                  icon(active ? (prefs.sort.dir === 'desc' ? 'arrow-down' : 'arrow-up') : 'sort', 13),
                )
              : c.label || h('span.sr-only', c.srLabel || ''),
          );
        }),
      ),
    );
    const tbody = h(
      'tbody',
      pageRows.map((r) => {
        const href = config.rowHref?.(r);
        const cb = selectable ? h('input', { type: 'checkbox', 'aria-label': 'Select row', checked: state.selected.has(r.id), dataset: { fk: `row:${r.id}` } }) : null;
        cb?.addEventListener('change', () => {
          cb.checked ? state.selected.add(r.id) : state.selected.delete(r.id);
          drawBody();
        });
        const tr = h(
          `tr${href ? '.clickable' : ''}${state.selected.has(r.id) ? '.selected' : ''}`,
          { dataset: { href: href || '' } },
          selectable ? h('td.check-col', cb) : null,
          cols.map((c, i) => {
            const content = c.render(r);
            return h(`td${c.align === 'r' ? '.r' : ''}${c.cls ? '.' + c.cls : ''}`, i === 0 && href ? h('a.row-link', { href }, content) : content);
          }),
        );
        if (href) {
          tr.addEventListener('click', (e) => {
            if (e.target.closest('a, button, input, label, select')) return;
            if (getSelection()?.toString()) return;
            // Ctrl or Cmd click opens a new tab, as it does on the row's link.
            if (e.ctrlKey || e.metaKey) return void window.open(href, '_blank', 'noopener');
            location.hash = href.replace(/^#/, '');
          });
        }
        return tr;
      }),
    );
    const table = h('table.table.grid-table.hide-mobile', h('caption.sr-only', config.title), thead, tbody);
    const mobile = config.mobile
      ? h(
          'ul.list.grid-cards.show-mobile',
          pageRows.map((r) => {
            const href = config.rowHref?.(r);
            if (href) return h('li', h('a.list-item.grid-card', { href }, config.mobile(r)));
            // Lists edited in a dialog have no page to link to.
            if (config.rowClick) return h('li', h('button.list-item.grid-card', { type: 'button', onClick: () => config.rowClick(r) }, config.mobile(r)));
            return h('li', h('div.list-item.grid-card', config.mobile(r)));
          }),
        )
      : null;
    body.replaceChildren(...[h('div.table-wrap.grid-wrap', { tabindex: '-1' }, table), mobile].filter(Boolean));
    if (pages > 1) {
      body.append(
        h(
          'div.grid-foot',
          h('span.subtle', `Page ${state.page + 1} of ${pages}`),
          h(
            'label.row.page-size',
            h('span.subtle', 'Rows per page'),
            (() => {
              const s = h('select.select.sm', { 'aria-label': 'Rows per page', dataset: { fk: 'size' } }, PAGE_SIZES.map((n) => h('option', { value: n }, String(n))));
              s.value = String(prefs.pageSize);
              s.addEventListener('change', () => {
                prefs.pageSize = Number(s.value);
                state.page = 0;
                save(config.key, prefs);
                drawBody();
              });
              return s;
            })(),
          ),
        ),
      );
    }
  }

  function drawPager(start, count, pages) {
    const total = current.length;
    pager.replaceChildren(
      h('span.pager-text', total ? `${(start + 1).toLocaleString()}-${(start + count).toLocaleString()} of ${total.toLocaleString()}` : '0 results'),
      h(
        'span.pager-btns',
        h('button.icon-btn.bordered.sm', { type: 'button', 'aria-label': 'Previous page', dataset: { fk: 'prev' }, disabled: state.page === 0 || null, onClick: () => ((state.page -= 1), drawBody()) }, icon('chevron-left', 16)),
        h('button.icon-btn.bordered.sm', { type: 'button', 'aria-label': 'Next page', dataset: { fk: 'next' }, disabled: state.page >= pages - 1 || null, onClick: () => ((state.page += 1), drawBody()) }, icon('chevron-right', 16)),
      ),
    );
  }

  function drawBulk() {
    const n = state.selected.size;
    bulkBar.hidden = !n;
    if (!n) return bulkBar.replaceChildren();
    const rows = () => current.filter((r) => state.selected.has(r.id));
    bulkBar.replaceChildren(
      h('strong', `${n} selected`),
      current.length > n ? h('button.link-btn', { type: 'button', dataset: { fk: 'bulk-all' }, onClick: () => (current.forEach((r) => state.selected.add(r.id)), drawBody()) }, `Select all ${current.length}`) : null,
      h('div.grow'),
      ...config.bulk.map((b) => {
        const label = typeof b.label === 'function' ? b.label(state.tab) : b.label;
        const ic = typeof b.icon === 'function' ? b.icon(state.tab) : b.icon;
        return h(
          `button.btn.sm${b.danger ? '.subtle-danger' : ''}`,
          {
            type: 'button',
            dataset: { fk: `bulk:${label}` },
            onClick: async (e) => {
              const done = await b.run(rows(), e.currentTarget, state.tab);
              if (done !== false) state.selected.clear();
              drawBody();
            },
          },
          ic ? icon(ic, 15) : null,
          label,
        );
      }),
      h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Clear selection', dataset: { fk: 'bulk-clear' }, onClick: () => (state.selected.clear(), drawBody()) }, icon('x', 16)),
    );
  }

  function exportCSV() {
    const cols = config.columns.filter((c) => c.csv || c.sort);
    const rows = [cols.map((c) => c.label || c.id), ...current.map((r) => cols.map((c) => (c.csv ? c.csv(r) : c.sort(r)) ?? ''))];
    downloadText(`${config.csvName}-${today()}.csv`, toCSV(rows));
  }

  // Keyboard: j / k move through rows, Enter opens.
  function onKey(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (isTypingTarget(t) || t?.closest?.('.popover')) return;
    if (document.querySelector('dialog[open]')) return;
    const rows = [...body.querySelectorAll('tbody tr')];
    if (!rows.length || !(e.key === 'j' || e.key === 'k' || (e.key === 'Enter' && focusRow >= 0))) return;
    if (e.key === 'Enter') {
      // Only when nothing else has focus: Enter on a button or link elsewhere
      // belongs to that control, not to the row highlighted earlier.
      if (t && t !== document.body && t.tagName !== 'MAIN' && !rows[focusRow]?.contains(t)) return;
      const href = rows[focusRow]?.dataset.href;
      if (href) location.hash = href.replace(/^#/, '');
      return;
    }
    e.preventDefault();
    focusRow = Math.max(0, Math.min(rows.length - 1, focusRow + (e.key === 'j' ? 1 : -1)));
    rows.forEach((r, i) => r.classList.toggle('kbd-focus', i === focusRow));
    rows[focusRow].scrollIntoView({ block: 'nearest' });
    rows[focusRow].querySelector('a.row-link')?.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', onKey);
  ctx.onDispose(() => document.removeEventListener('keydown', onKey));

  const redraw = () => {
    drawTabs();
    drawFilters();
    drawBody();
  };
  redraw();
  const watch = new Set([...(config.coll ? [config.coll] : []), ...(config.watch || []), 'settings']);
  let t = null;
  ctx.onDispose(() => clearTimeout(t));
  ctx.onDispose(
    store.subscribe((changed) => {
      if (![...changed].some((c) => watch.has(c))) return;
      clearTimeout(t);
      t = setTimeout(() => {
        drawTabs();
        drawBody();
      }, 30);
    }),
  );

  const node = h(
    'div.page.list-page',
    header,
    config.notice || null,
    config.stats ? config.stats() : null,
    h('section.card.grid-card-wrap', { 'aria-label': config.title }, tabsNode, toolbar, bulkBar, summaryNode, body, live),
  );
  return { node, title: config.title, redraw, get rows() { return current; } };
}

/** A filter over a record field (exact match on the stringified value). */
export function fieldFilter(id, label, field, options) {
  return {
    id,
    label,
    options,
    match: (r, vals) => vals.has(String(typeof field === 'function' ? field(r) : r[field] ?? '')),
  };
}

export { uniqueId };
