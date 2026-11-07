// Playing the frame animation on the canvas. Frames are shown as previews of
// the document (nothing enters history while playing); stopping selects the
// frame on screen. Any edit or document switch stops playback.
import type { Editor } from '../../editor';
import type { DocumentSession } from '../../app/session';
import type { PhotoDocument } from '../../model/document';
import { frameDocument } from '../../model/animation';
import { animationOf, selectFrame } from './state';

type Playing = { session: DocumentSession; doc: PhotoDocument; index: number; played: number; timer: number; frames: PhotoDocument[] };
let playing: Playing | undefined;
const listeners = new Set<() => void>();

export const isPlaying = (e?: Editor) => !!playing && (!e || playing.session === e.session);
/** Index of the frame on screen while playing. */
export const playingIndex = () => playing?.index;
export function onPlaybackChange(fn: () => void) {
  listeners.add(fn);
}
const notify = () => listeners.forEach((fn) => fn());

function show(e: Editor, p: Playing) {
  const doc = (p.frames[p.index] ??= frameDocument(p.doc, p.index));
  e.preview(doc);
}

export function play(e: Editor) {
  const anim = animationOf(e);
  if (!anim || anim.frames.length < 2 || playing) return;
  // Start from the first frame when the current one is the last.
  const start = anim.current === anim.frames.length - 1 ? 0 : anim.current;
  playing = { session: e.session, doc: e.doc, index: start, played: 0, timer: 0, frames: [] };
  show(e, playing);
  schedule(e);
  notify();
}

function schedule(e: Editor) {
  const p = playing;
  const anim = p?.doc.animation;
  if (!p || !anim) return;
  // Browsers show very short GIF delays at about 100 ms; a 20 ms floor keeps
  // zero-delay frames visible without stalling the loop.
  p.timer = window.setTimeout(() => {
    if (playing !== p) return;
    let next = p.index + 1;
    if (next >= anim.frames.length) {
      p.played++;
      if (anim.loop && p.played >= anim.loop) return stop(e);
      next = 0;
    }
    p.index = next;
    show(e, p);
    notify();
    schedule(e);
  }, Math.max(20, anim.frames[p.index].delay));
}

/** Stop playing; with `select`, the frame on screen becomes the current one. */
export function stop(e: Editor, select = true) {
  const p = playing;
  if (!p) return;
  clearTimeout(p.timer);
  playing = undefined;
  notify();
  if (select && e.session === p.session && e.doc === p.doc) selectFrame(e, p.index);
  else e.update();
}

export function togglePlay(e: Editor) {
  if (isPlaying()) stop(e);
  else play(e);
}

/** Keep playback in step with the editor: edits and tab switches stop it,
 * other updates keep showing the playing frame. */
export function playbackUpdate(e: Editor) {
  const p = playing;
  if (!p) return;
  if (p.session !== e.session || p.doc !== e.doc) {
    clearTimeout(p.timer);
    playing = undefined;
    notify();
    return;
  }
  // The update loop previews the document after its hooks; show the frame after it.
  queueMicrotask(() => {
    if (playing === p) show(e, p);
  });
}
