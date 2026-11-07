/**
 * Generic list page used by requests, quotes, jobs and invoices: summary
 * tiles, status chips, search, a sortable table and phone-friendly rows.
 *
 * config: {
 *   coll, title, icon, newHref, newLabel,
 *   statusOf(record, ctx) -> status,
 *   filters: [{ id, label, match(status, record) }],   // first is default
 *   stats(records, statusOf) -> [{ label, value, sub, tone, filter }],
 *   columns: [...dataTable columns],
 *   searchText(record) -> string,
 *   mobile(record, status) -> node,
 *   defaultSort, empty: { title, text, icon }, moreMenu?(anchor)
 * }
 */
import { h, keepFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { app } from '../app.js';
import { pageHeader, stat, searchBox, chips, dataTable, emptyState, moreButton } from '../ui/components.js';
import { setQuery } from '../ui/router.js';
import { matches } from '../core/format.js';
import { rememberSort, saveSort } from './common.js';

export function renderList(ctx, config) {
  const store = app.store;
  const state = {
    q: ctx.query.q || '',
    filter: ctx.query.status || config.filters[0].id,
    sort: rememberSort(config.coll, config.defaultSort),
  };

  const paging = {};
  const statusCache = new Map();
  const statusOf = (r) => {
    let s = statusCache.get(r);
    if (s === undefined) {
      s = config.statusOf(r);
      statusCache.set(r, s);
    }
    return s;
  };

  const header = pageHeader({
    title: config.title,
    actions: [config.moreMenu ? moreButton((btn) => config.moreMenu(btn)) : null, h('a.btn.primary', { href: config.newHref }, icon(config.newIcon || 'plus', 16), config.newLabel)],
  });

  const statsNode = h('div');
  const filterNode = h('div');
  const results = h('div');
  // One live region for the whole visit: a region added already holding its
  // text is not announced.
  const count = h('div.sr-only', { role: 'status' });

  const search = searchBox({
    value: state.q,
    placeholder: config.searchPlaceholder || 'Search',
    label: `Search ${config.title.toLowerCase()}`,
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      drawResults();
    },
  });

  function setFilter(id) {
    state.filter = id;
    setQuery({ status: id === config.filters[0].id ? '' : id });
    keepFocus(filterNode, drawFilters);
    drawResults();
  }

  function drawStats() {
    const all = store.all(config.coll);
    statsNode.replaceChildren(
      h(
        'div.stats.list-stats',
        config.stats(all, statusOf).map((s) => stat({ ...s, onClick: s.filter ? () => setFilter(s.filter) : null })),
      ),
    );
  }

  function drawFilters() {
    const all = store.all(config.coll);
    filterNode.replaceChildren(
      chips({
        label: 'Status',
        selected: state.filter,
        onSelect: setFilter,
        items: config.filters.map((f) => ({ id: f.id, label: f.label, count: all.filter((r) => f.match(statusOf(r), r)).length })),
      }),
    );
  }

  function drawResults() {
    const f = config.filters.find((x) => x.id === state.filter) || config.filters[0];
    const all = store.all(config.coll);
    const rows = all.filter((r) => f.match(statusOf(r), r) && (!state.q || matches(config.searchText(r), state.q)));
    count.textContent = `${rows.length} ${config.title.toLowerCase()}`;
    results.replaceChildren(
      dataTable({
        caption: config.title,
        rows,
        sort: state.sort,
        onSort: (s) => {
          state.sort = s;
          saveSort(config.coll, s);
          keepFocus(results, drawResults);
        },
        rowHref: (r) => `#/${config.coll}/${r.id}`,
        paging,
        pagingKey: JSON.stringify([state.q, state.filter, state.sort]),
        columns: config.columns(statusOf),
        mobile: (r) => config.mobile(r, statusOf(r)),
        empty: all.length
          ? emptyState({ compact: true, icon: 'search', title: `No matching ${config.title.toLowerCase()}`, text: 'Try a different search or status filter.', headingLevel: 3 })
          : emptyState({
              icon: config.empty.icon,
              title: config.empty.title,
              text: config.empty.text,
              actions: [h('a.btn.primary', { href: config.newHref }, icon('plus', 16), config.newLabel)],
              headingLevel: 3,
            }),
      }),
    );
  }

  const drawAll = () => {
    statusCache.clear();
    keepFocus(statsNode, drawStats);
    keepFocus(filterNode, drawFilters);
    keepFocus(results, drawResults);
  };
  drawAll();
  const watch = new Set([config.coll, 'clients', ...(config.watch || [])]);
  ctx.onDispose(store.subscribe((changed) => [...changed].some((c) => watch.has(c)) && drawAll()));
  // Date-derived statuses change at midnight.
  const timer = setInterval(drawAll, 10 * 60 * 1000);
  ctx.onDispose(() => clearInterval(timer));

  return {
    node: h('div.page', header, statsNode, h('section.card.list-card', { 'aria-label': `${config.title} list` }, h('div.toolbar', search, h('div.grow'), filterNode), count, results)),
    title: config.title,
  };
}
