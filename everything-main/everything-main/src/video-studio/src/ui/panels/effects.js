/**
 * Effects tab. Clicking an effect adds it to the selected video, image, text
 * or graphic clip's own effect stack; with no such clip selected (or by
 * dragging onto empty timeline space) it adds an effect clip that applies to
 * everything below it. Dropping a tile on a clip adds it to that clip.
 * Body effects need a clip (they follow the people in it).
 */
import { h } from '../../lib/dom.js';
import { EFFECTS, EFFECT_CATEGORIES } from '../../model/catalog.js';
import { canHaveEffects, MAX_CLIP_EFFECTS } from '../../model/clip-effects.js';
import { isBodyEffect } from '../../model/body-effects.js';
import { toast } from '../dialog.js';
import { tabLayout, tileGrid, tile, emptyState } from './common.js';
import { lookPreview, hoverAnimate, matchesLook } from './previews.js';

export function effectsTab(ctx) {
  const { store, actions } = ctx;
  const target = () => {
    const s = store.selected;
    return s && store.selectedIds.length === 1 && canHaveEffects(s.clip) ? s.clip : null;
  };
  const hint = h('p.asset-hint', { role: 'status' });
  let shownCat = 'all';
  const syncHint = () => {
    const c = target();
    const n = c?.effects?.length || 0;
    if (shownCat === 'body') {
      hint.textContent = c && (c.type === 'video' || c.type === 'image')
        ? `Click a body effect to add it to the selected clip (${n} of ${MAX_CLIP_EFFECTS}). It finds the people in the shot on this device.`
        : 'Body effects follow the people in a shot. Select a video or image clip, then click one, or drop one on the clip.';
      return;
    }
    hint.textContent = c
      ? `Click an effect to add it to the selected clip (${n} of ${MAX_CLIP_EFFECTS}). Drag one onto empty timeline space for an effect layer over everything below.`
      : 'Click an effect to add an effect layer at the playhead. Select a clip first, or drop an effect on a clip, to apply it to that clip only.';
  };
  const layout = tabLayout({
    title: 'Effects',
    categories: [{ id: 'all', label: 'All' }, ...EFFECT_CATEGORIES],
    render(cat, q) {
      shownCat = cat;
      syncHint();
      const list = EFFECTS.filter((e) => (cat === 'all' || e.cat === cat) && matchesLook(e, q, EFFECT_CATEGORIES));
      if (!list.length) return h('div', hint, emptyState('search', 'No effects found', 'Try another word.'));
      return h('div', hint, tileGrid(list.map((e) => {
        const t = tile({
          label: e.label,
          preview: lookPreview('effect', e.id),
          onAdd: () => {
            const c = target();
            if (c) actions.addClipEffect(c.id, e.id);
            else if (isBodyEffect(e.id)) toast('Select a video or image clip first. Body effects follow the people in that clip.', { kind: 'info' });
            else actions.addEffect(e.id);
          },
          drag: { kind: 'effect', id: e.id },
          addLabel: `Add ${e.label} effect`,
        });
        hoverAnimate(t, 'effect', e.id);
        return t;
      }), { label: 'Effects' }));
    },
  });
  const offs = [store.on('select', syncHint), store.on('change', syncHint)];
  return { el: layout.el, shown: syncHint, dispose: () => offs.forEach((f) => f()) };
}
