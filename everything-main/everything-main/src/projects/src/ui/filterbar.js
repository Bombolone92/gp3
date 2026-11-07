import { el } from '../lib/dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { debounce } from '../lib/util.js';
import { PRIORITIES } from '../lib/store.js';
import { DUE_FILTERS, emptyFilter, activeFacets, isFilterActive } from '../lib/filters.js';
import { avatar } from './bits.js';

/**
 * Filter state lives per project for the session, so switching tabs (or
 * leaving and coming back to a board) does not silently drop the filter the
 * user set. Nothing is persisted: saved filters are a separate feature.
 */
const states = new Map();

export function filterFor(projectId) {
  if (!states.has(projectId)) states.set(projectId, emptyFilter());
  return states.get(projectId);
}

/** Cleared in place: views hold on to the filter object they were handed. */
export function resetFilter(projectId) {
  return Object.assign(filterFor(projectId), emptyFilter());
}

/**
 * Compact filter bar: title match plus label / assignee / priority / due
 * facets. The bar owns its own DOM across re-renders of the view below it
 * (rebuilding it would steal focus from the input on every keystroke), so
 * the host calls `update({ shown, total })` after each render instead.
 *
 * filterBar({ projectId, doc, onChange }) → node with .update(), .reset(),
 * .syncFromFilter() and .focusInput(); it holds no listeners of its own, so
 * there is nothing to tear down.
 */
export function filterBar({ projectId, doc, onChange }) {
  const filter = filterFor(projectId);

  const input = el('input.filter-input', {
    type: 'search',
    value: filter.text,
    placeholder: 'Filter by title',
    'aria-label': 'Filter tasks by title',
    oninput: debounce(() => {
      filter.text = input.value;
      onChange();
    }, 120),
    onkeydown: (e) => {
      if (e.isComposing) return;
      // Escape clears rather than closing anything: the bar is not a dialog.
      if (e.key === 'Escape' && input.value) {
        e.stopPropagation();
        input.value = '';
        filter.text = '';
        onChange();
      }
    },
  });

  const chips = el('div.filter-chips');
  const summary = el('span.filter-summary', { role: 'status', 'aria-live': 'polite' });
  function clearAll({ focus = false } = {}) {
    Object.assign(filter, emptyFilter());
    input.value = '';
    onChange();
    renderChips();
    if (focus) input.focus();
  }

  const clearBtn = el('button.btn.btn-ghost.btn-sm.filter-reset', {
    type: 'button',
    onclick: () => clearAll({ focus: true }),
  }, 'Clear');

  const root = el('div.filterbar', { role: 'search', 'aria-label': 'Filter tasks' },
    el('div.filter-search', {},
      el('span.filter-search-ic', { html: icon('search', 15, 2), 'aria-hidden': 'true' }),
      input
    ),
    chips,
    el('span.grow'),
    summary,
    clearBtn
  );

  /**
   * One facet chip: label, count when narrowed, and a checkbox menu.
   *
   * The button is built once and kept. Every render of the view below calls
   * update(), and rebuilding the chips there would throw away the very
   * button a facet menu is anchored to — which happens on the first toggle,
   * mid-interaction, leaving the menu orphaned and Escape with nowhere to
   * put focus back. `values` and `selected` are read fresh on each sync, so
   * a label added (or the whole filter cleared, which replaces the arrays)
   * still shows up.
   */
  function facetChip({ label, emptyTitle, values, selected, prefixOf, labelOf }) {
    const count = el('span.filter-chip-count');
    const btn = el('button.filter-chip', {
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      onclick: () => {
        const options = values();
        if (!options.length) return;
        openMenu(btn, options.map((v) => ({
          label: labelOf(v),
          prefix: prefixOf?.(v),
          checked: () => selected().includes(valueOf(v)),
          keepOpen: true,
          onClick: () => {
            const id = valueOf(v);
            const list = selected();
            const at = list.indexOf(id);
            if (at >= 0) list.splice(at, 1);
            else list.push(id);
            onChange();
            renderChips();
          },
        })));
      },
    },
      el('span', {}, label),
      count,
      el('span.filter-chip-caret', { html: icon('chevDown', 13, 2.4), 'aria-hidden': 'true' })
    );

    function sync() {
      const options = values();
      const n = selected().length;
      count.textContent = n ? String(n) : '';
      count.hidden = !n;
      btn.classList.toggle('on', n > 0);
      btn.setAttribute('aria-label', n ? `${label}: ${n} selected` : label);
      btn.disabled = !options.length;
      if (options.length) btn.removeAttribute('title');
      // Built from the chip's own name this read "No label in this project
      // yet", and called the members list "assignee" — the two things the
      // list view's own empty menus already word properly.
      else btn.title = emptyTitle;
    }

    return { node: btn, sync };
  }

  // `'value' in v`, not `v.value ?? v.id`: the "No priority" option carries a
  // deliberate null that must survive the round trip.
  const valueOf = (v) => (v && typeof v === 'object' ? ('value' in v ? v.value : v.id) : v);

  const facets = [
    facetChip({
      label: 'Label',
      emptyTitle: 'No labels in this project yet',
      values: () => doc()?.labels ?? [],
      selected: () => filter.labelIds,
      labelOf: (l) => l.name,
      prefixOf: (l) => el('span.dot', { style: { background: l.color }, 'aria-hidden': 'true' }),
    }),
    facetChip({
      label: 'Assignee',
      emptyTitle: 'No members in this project yet',
      values: () => doc()?.members ?? [],
      selected: () => filter.assigneeIds,
      labelOf: (m) => m.name,
      prefixOf: (m) => avatar(m, 18),
    }),
    facetChip({
      label: 'Priority',
      // Both of these come from constants, so they never empty out — the
      // message is here so the option is never the one that is missing.
      emptyTitle: 'No priorities to filter by',
      values: () => [...PRIORITIES, { value: null, label: 'No priority' }],
      selected: () => filter.priorities,
      labelOf: (p) => p.label,
      prefixOf: (p) => (p.value
        ? el('span.filter-prio', { html: icon(p.value, 13, 2.2), 'aria-hidden': 'true' })
        : null),
    }),
    facetChip({
      label: 'Due',
      emptyTitle: 'No due ranges to filter by',
      values: () => DUE_FILTERS,
      selected: () => filter.due,
      labelOf: (o) => o.label,
    }),
  ];
  chips.append(...facets.map((f) => f.node));

  function renderChips() {
    for (const facet of facets) facet.sync();
    root.classList.toggle('active', isFilterActive(filter));
    clearBtn.hidden = !isFilterActive(filter);
  }

  renderChips();

  return Object.assign(root, {
    /**
     * Pull the bar back into line with the filter object, for when something
     * else set it — a saved view being applied, say. The input is the only
     * part that does not read the filter on every render.
     */
    syncFromFilter() {
      input.value = filter.text ?? '';
      renderChips();
    },
    /** Called by the host after it renders, with the visible/total counts. */
    update({ shown, total }) {
      summary.textContent = activeFacets(filter)
        ? `${shown} of ${total} ${total === 1 ? 'task' : 'tasks'}`
        : '';
      renderChips();
    },
    reset() { clearAll(); },
    focusInput() { input.focus(); },
  });
}
