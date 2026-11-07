/**
 * Actions on a clip's own effect stack (model/clip-effects.js). Mixed into
 * the main actions object (see actions.js); each is one undoable step.
 */
import { announce } from '../lib/dom.js';
import { EFFECTS } from '../model/catalog.js';
import * as T from '../model/timeline.js';
import { MAX_CLIP_EFFECTS, canHaveEffects, addClipEffect, removeClipEffect, moveClipEffect, setClipEffectOn } from '../model/clip-effects.js';
import { toast } from './dialog.js';
import { isBodyEffect } from '../model/body-effects.js';
import { ready } from '../media/segmenter.js';

export const effectLabel = (id) => EFFECTS.find((e) => e.id === id)?.label || 'Effect';

export function createClipEffectActions(ctx) {
  const { store } = ctx;
  const edit = (clipId, label, fn) => store.update(label, (p) => {
    const f = T.findClip(p, clipId);
    if (!f || f.track.locked || !canHaveEffects(f.clip)) return false;
    return fn(f.clip);
  }, { structural: false });

  return {
    /** Add an effect to the end of a clip's stack. */
    addClipEffect(clipId, effectId) {
      const clip = T.findClip(store.project, clipId)?.clip;
      if (!canHaveEffects(clip)) {
        toast('Effects can be added to video, image, text and graphic clips.', { kind: 'info' });
        return false;
      }
      if (isBodyEffect(effectId) && clip.type !== 'video' && clip.type !== 'image') {
        toast('Body effects work on video and image clips with people in them.', { kind: 'info' });
        return false;
      }
      if ((clip.effects?.length || 0) >= MAX_CLIP_EFFECTS) {
        toast(`A clip can have up to ${MAX_CLIP_EFFECTS} effects. Remove one to add another.`, { kind: 'info' });
        return false;
      }
      const ok = edit(clipId, `Add ${effectLabel(effectId)} to clip`, (c) => addClipEffect(c, effectId) >= 0);
      if (ok) {
        if (isBodyEffect(effectId)) ready();
        announce(`${effectLabel(effectId)} added to the clip`);
        ctx.inspector?.showTab?.('clipfx');
      }
      return ok;
    },

    removeClipEffect(clipId, index) {
      const id = T.findClip(store.project, clipId)?.clip?.effects?.[index]?.id;
      const ok = edit(clipId, 'Remove clip effect', (c) => removeClipEffect(c, index));
      if (ok) announce(`${effectLabel(id)} removed`);
      return ok;
    },

    moveClipEffect(clipId, from, to) {
      const ok = edit(clipId, 'Reorder clip effects', (c) => moveClipEffect(c, from, to));
      if (ok) announce(`Moved to position ${to + 1}`);
      return ok;
    },

    toggleClipEffect(clipId, index, on) {
      return edit(clipId, on ? 'Turn effect on' : 'Turn effect off', (c) => setClipEffectOn(c, index, on));
    },

    clearClipEffects(clipId) {
      return edit(clipId, 'Remove clip effects', (c) => {
        if (!c.effects?.length) return false;
        delete c.effects;
      });
    },
  };
}
