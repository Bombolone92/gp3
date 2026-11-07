// Session-level Timeline state that is not part of the document: which
// frames are selected (the current frame always is) and the shared helpers
// commands and the panel use to read the animation.
import type { Editor } from '../../editor';
import type { DocumentSession } from '../../app/session';
import { applyFrame } from '../../model/animation';

const selections = new WeakMap<DocumentSession, { ids: Set<string>; anchor?: string }>();

export const animationOf = (e: Editor) => (e.hasDocument ? e.doc.animation : undefined);
export const hasAnimation = (e: Editor) => !!animationOf(e);

/** Selected frame indices in order; always includes the current frame. */
export function selectedFrames(e: Editor): number[] {
  const anim = animationOf(e);
  if (!anim) return [];
  const sel = selections.get(e.session);
  const out = anim.frames.flatMap((f, i) => (sel?.ids.has(f.id) || i === anim.current ? [i] : []));
  return out;
}
export function setSelectedFrames(e: Editor, indices: number[], anchor?: number) {
  const anim = animationOf(e);
  if (!anim) return;
  const prev = selections.get(e.session);
  selections.set(e.session, {
    ids: new Set(indices.map((i) => anim.frames[i]?.id).filter((id): id is string => !!id)),
    anchor: anchor !== undefined ? anim.frames[anchor]?.id : prev?.anchor,
  });
}
export function selectionAnchor(e: Editor) {
  const anim = animationOf(e);
  const id = selections.get(e.session)?.anchor;
  const i = anim && id ? anim.frames.findIndex((f) => f.id === id) : -1;
  return i >= 0 ? i : (anim?.current ?? 0);
}

/** Show a frame (one coalesced "Select Frame" history step). */
export function selectFrame(e: Editor, index: number, keepSelection = false) {
  const anim = animationOf(e);
  // Recorded actions pass the frame number; a missing one selects nothing.
  if (!anim || !Number.isInteger(index) || index < 0 || index >= anim.frames.length) return;
  if (!keepSelection) setSelectedFrames(e, [index], index);
  if (index !== anim.current) e.command('Select Frame', (d) => applyFrame(d, index), { coalesce: true });
  else e.update();
}
