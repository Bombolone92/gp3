/** Transitions tab: added at the cut after the selected clip or nearest the playhead. */
import { h } from '../../lib/dom.js';
import { TRANSITIONS, TRANSITION_CATEGORIES } from '../../model/catalog.js';
import { tabLayout, tileGrid, tile, emptyState } from './common.js';
import { lookPreview, hoverAnimate, matchesLook } from './previews.js';

export function transitionsTab(ctx) {
  const layout = tabLayout({
    title: 'Transitions',
    categories: [{ id: 'all', label: 'All' }, ...TRANSITION_CATEGORIES],
    render(cat, q) {
      const list = TRANSITIONS.filter((t) => (cat === 'all' || t.cat === cat) && matchesLook(t, q, TRANSITION_CATEGORIES));
      if (!list.length) return emptyState('search', 'No transitions found', 'Try another word.');
      return h('div',
        h('p.asset-hint', 'Adds the transition at the cut after the selected clip, or the cut nearest the playhead. Drag one onto a cut to place it there.'),
        tileGrid(list.map((t) => {
          const el = tile({
            label: t.label,
            preview: lookPreview('transition', t.id, { progress: 0.5 }),
            onAdd: () => ctx.actions.applyTransition(t.id),
            drag: { kind: 'transition', id: t.id },
            addLabel: `Add ${t.label} transition`,
          });
          hoverAnimate(el, 'transition', t.id);
          return el;
        }), { label: 'Transitions' }),
      );
    },
  });
  return { el: layout.el };
}
