/** Reports index: categories, search and favorites. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pageHeader, searchBox, emptyState, chips } from '../../ui/components.js';
import { setQuery } from '../../ui/router.js';
import { matches } from '../../core/format.js';
import { REPORTS, CATEGORIES } from './catalog.js';
import { favorites, toggleFavorite } from './favorites.js';

export function render(ctx) {
  const state = {
    q: ctx.query.q || '',
    category: CATEGORIES.some((c) => c.id === ctx.query.category) ? ctx.query.category : 'all',
  };
  const results = h('div.report-index');
  const live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });

  function row(r, favs) {
    const on = favs.has(r.id);
    return h(
      'li.report-row',
      h('a.report-link', { href: `#/reports/${r.id}` }, h('span.report-name', r.title), h('span.report-desc', r.description)),
      h(
        'button.icon-btn.fav-btn',
        {
          type: 'button',
          'aria-pressed': String(on),
          'aria-label': on ? `Remove ${r.title} from favorites` : `Add ${r.title} to favorites`,
          title: on ? 'Remove from favorites' : 'Add to favorites',
          onClick: () => {
            toggleFavorite(r.id);
            draw();
          },
        },
        icon('star', 17),
      ),
    );
  }

  function group(title, ic, list, favs, id) {
    return h(
      'section.card.report-group',
      { 'aria-labelledby': id },
      h('div.card-head', h('h2.grow', { id }, icon(ic, 17), title), h('span.count.subtle', String(list.length))),
      h('ul.report-list', list.map((r) => row(r, favs))),
    );
  }

  function draw() {
    const favs = favorites();
    const visible = REPORTS.filter((r) => (state.category === 'all' || r.category === state.category) && (!state.q || matches(`${r.title} ${r.description}`, state.q)));
    const parts = [];
    const favList = visible.filter((r) => favs.has(r.id));
    if (favList.length && !state.q) parts.push(group('Favorites', 'star', favList, favs, 'rg-fav'));
    for (const c of CATEGORIES) {
      const list = visible.filter((r) => r.category === c.id);
      if (list.length) parts.push(group(c.label, c.icon, list, favs, `rg-${c.id}`));
    }
    results.replaceChildren(...(parts.length ? parts : [emptyState({ compact: true, icon: 'search', title: 'No matching reports', text: 'Try a different word, such as rent, owner or bills.', headingLevel: 2 })]));
    live.textContent = state.q ? `${visible.length} reports found` : '';
  }

  const filters = h('div');
  const drawFilters = () =>
    filters.replaceChildren(
      chips({
        label: 'Category',
        selected: state.category,
        items: [{ id: 'all', label: 'All' }, ...CATEGORIES.map((c) => ({ id: c.id, label: c.label }))],
        onSelect: (id) => {
          state.category = id;
          setQuery({ category: id === 'all' ? '' : id });
          drawFilters();
          draw();
        },
      }),
    );
  drawFilters();
  draw();

  const search = searchBox({
    value: state.q,
    placeholder: 'Search reports',
    label: 'Search reports',
    onInput: (v) => {
      state.q = v;
      setQuery({ q: v });
      draw();
    },
  });

  return {
    node: h('div.page.reports-page', pageHeader({ title: 'Reports', subtitle: 'Financial statements, rent roll, delinquency, maintenance and owner reports. Print any report or export it to CSV.' }), h('div.toolbar.report-toolbar', search, filters), live, results),
    title: 'Reports',
  };
}
