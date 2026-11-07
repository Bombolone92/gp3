/**
 * Effect Gallery thumbnails: each filter run with its default settings on
 * the sample picture, computed a few at a time in the background and kept
 * for the session.
 */
import { sampleImage } from './sample.js';
import { runStack, newLayer } from './catalog.js';
import { toRGBA } from './img.js';

export const THUMB_W = 96;
export const THUMB_H = 72;
/** Work pixels per point for thumbnails: the sample reads as a 192 x 144 pt picture. */
const THUMB_K = 0.5;

let sample = null;
const done = new Map();
const waiting = new Map();
let timer = null;

/** RGBA bytes of a filter's thumbnail (computed now). */
export function thumbPixels(id) {
  if (done.has(id)) return done.get(id);
  sample ||= sampleImage(THUMB_W, THUMB_H);
  const out = runStack(sample, [newLayer(id)], { k: THUMB_K, ox: 0, oy: 0, seed: 1234, bounds: { x: 0, y: 0, w: THUMB_W, h: THUMB_H } });
  const px = toRGBA(out);
  done.set(id, px);
  return px;
}

/** Paint a thumbnail into a canvas (when its 2D context can take pixels). */
export function paintThumb(canvas, px) {
  const ctx = canvas.getContext?.('2d');
  const img = ctx?.createImageData?.(THUMB_W, THUMB_H);
  if (!img?.data || img.data.length !== px.length) return;
  img.data.set(px);
  ctx.putImageData(img, 0, 0);
}

/** Draw filter `id`'s thumbnail into canvas soon (in the background). */
export function queueThumb(id, canvas) {
  if (done.has(id)) {
    paintThumb(canvas, done.get(id));
    return;
  }
  if (!waiting.has(id)) waiting.set(id, []);
  waiting.get(id).push(canvas);
  if (!timer) timer = setTimeout(pump, 30);
}

function pump() {
  timer = null;
  const t0 = Date.now();
  for (const [id, list] of waiting) {
    waiting.delete(id);
    const px = thumbPixels(id);
    for (const c of list) paintThumb(c, px);
    if (Date.now() - t0 > 24) break;
  }
  if (waiting.size) timer = setTimeout(pump, 16);
}
