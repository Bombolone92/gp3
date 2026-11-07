/**
 * Symbol previews: a symbol's master artwork drawn into a small image,
 * cached until any part of the master changes.
 */
import { h } from '../../lib/dom.js';
import { drawNode } from '../../render/draw.js';
import { masterBounds, symbolDeps } from './model.js';
import { icon } from '../../ui/icons.js';

const cache = new Map(); // `${defId}:${size}` -> { snap, url }

function sameSnap(a, b) {
  return a.length === b.length && a.every((n, i) => n === b[i]);
}

/** Data URL of a symbol preview `size` CSS pixels square, or null when it cannot be drawn. */
export function symbolThumbURL(doc, def, size) {
  const key = `${def.id}:${size}`;
  const snap = symbolDeps(doc, def.id);
  const hit = cache.get(key);
  if (hit && sameSnap(hit.snap, snap)) return hit.url;
  let url = null;
  const b = masterBounds(doc, def, true);
  if (b && (b.w > 0 || b.h > 0)) {
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx && typeof ctx.setTransform === 'function') {
      const pad = Math.max(2, size * 0.08);
      const s = (size - pad * 2) / Math.max(b.w, b.h, 1e-6);
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (size / 2 - (b.x + b.w / 2) * s), dpr * (size / 2 - (b.y + b.h / 2) * s));
      for (const c of def.children) drawNode(ctx, doc, doc.get(c), { hairline: 1 / s, scale: s * dpr });
      try {
        url = canvas.toDataURL();
      } catch {
        url = null;
      }
    }
  }
  cache.set(key, { snap, url });
  return url;
}

/** An <img> preview of a symbol (or a symbol glyph when it cannot be drawn). */
export function symbolThumb(doc, def, size) {
  const url = symbolThumbURL(doc, def, size);
  if (!url) return h('span.sym-thumb.empty', { 'aria-hidden': 'true' }, icon('symbol', Math.min(24, size - 4)));
  return h('img.sym-thumb', { src: url, alt: '', width: size, height: size, draggable: 'false' });
}

/** Forget previews of symbols that no longer exist. */
export function pruneThumbs(ids) {
  const keep = new Set(ids);
  for (const k of cache.keys()) if (!keep.has(k.split(':')[0])) cache.delete(k);
}
