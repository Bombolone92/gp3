/**
 * Graphics tab: original shapes, icons, faces, badges, frames, doodles and
 * social callouts, some multi-color and some animated (they play on hover).
 * Recolorable in Details; favorites are kept per device.
 */
import { h } from '../../lib/dom.js';
import { STICKERS, drawSticker } from '../../engine/stickers.js';
import { STICKER_CATEGORIES } from '../../model/catalog.js';
import { EXTRA_CATEGORIES } from '../../engine/stickers-extra.js';
import { tabLayout, tileGrid, tile, emptyState, emptyFavorites, canvasPreview, hoverPlay } from './common.js';
import { itemsFor } from './favorites.js';

const COLORS = ['#ffd23f', '#ff5a5f', '#3ec6e0', '#7ee081', '#ffffff', '#b38cff'];
const FAV_TAB = 'stickers';
const CAT_LABEL = new Map([...STICKER_CATEGORIES, ...EXTRA_CATEGORIES].map((c) => [c.id, c.label]));
const cat = (id) => ({ id, label: CAT_LABEL.get(id) || id });

export const GRAPHIC_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'animated', label: 'Animated' },
  { id: 'basics', label: 'Basics', children: ['shapes', 'arrows', 'callouts', 'icons'].map(cat) },
  { id: 'expressive', label: 'Expressive', children: ['faces', 'badges', 'social', 'sparkles'].map(cat) },
  { id: 'decor', label: 'Decor', children: ['frames', 'doodles'].map(cat) },
];

/** The color a graphic's tile (and new clip) uses. */
export function tileColor(s, i) {
  if (s.multi) return s.main;
  if (s.cat === 'icons' || s.cat === 'frames' || s.cat === 'doodles') return '#ffffff';
  return COLORS[i % COLORS.length];
}

function drawTile(g, w, hh, s, color, t) {
  g.clearRect(0, 0, w, hh);
  g.fillStyle = '#2a2a30';
  g.fillRect(0, 0, w, hh);
  const size = 84;
  g.save();
  g.translate((w - size) / 2, (hh - size) / 2);
  drawSticker(g, s.id, color, size, { t });
  g.restore();
}

export function stickersTab(ctx) {
  const index = new Map(STICKERS.map((s, i) => [s.id, i]));
  const rest = (s) => (s.anim ? 0.35 : 0);

  function graphicTile(s) {
    const color = tileColor(s, index.get(s.id));
    const preview = canvasPreview((g, w, hh) => drawTile(g, w, hh, s, color, rest(s)), 120, 120);
    const t = tile({
      label: s.label,
      preview,
      onAdd: () => ctx.actions.addSticker(s.id, { color }),
      drag: { kind: 'sticker', id: s.id, color },
      addLabel: `Add ${s.label} graphic${s.anim ? ', animated' : ''}`,
      favorite: { tab: FAV_TAB, id: s.id },
      badge: s.anim ? 'Anim' : null,
    });
    if (s.anim) hoverPlay(t, preview, (g, w, hh, time) => drawTile(g, w, hh, s, color, time), { rest: rest(s) });
    return t;
  }

  const layout = tabLayout({
    title: 'Graphics',
    id: 'stickers',
    favorites: FAV_TAB,
    categories: GRAPHIC_CATEGORIES,
    render(c, q) {
      const list = c === 'animated'
        ? itemsFor(STICKERS.filter((s) => s.anim), 'all', { query: q })
        : itemsFor(STICKERS, c, { tab: FAV_TAB, query: q });
      if (!list.length) return c === 'favorites' && !q ? emptyFavorites('a graphic') : emptyState('search', 'No graphics found', 'Try another word.');
      if (c === 'all' && !q) {
        const order = [...STICKER_CATEGORIES, ...EXTRA_CATEGORIES];
        return h('div', order.map((g) => {
          const items = list.filter((s) => s.cat === g.id);
          if (!items.length) return null;
          return h('section.asset-group', h('h3.asset-group-title', g.label), tileGrid(items.map(graphicTile), { label: g.label, className: 'square' }));
        }));
      }
      return tileGrid(list.map(graphicTile), { label: 'Graphics', className: 'square' });
    },
  });
  layout.el.classList.add('wrap-cats');
  return { el: layout.el, dispose: () => layout.dispose() };
}
