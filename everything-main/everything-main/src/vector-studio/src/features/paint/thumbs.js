/**
 * Small previews of artwork drawn with the real renderer, so thumbnails
 * show effects, gradients and arrowheads exactly as the canvas does.
 */
import { drawNode } from '../../render/draw.js';
import { visualBounds } from '../../model/geometry.js';

/** Draw `node` fitted into a size x size canvas context (CSS px == canvas px). */
export function drawThumbnail(ctx, doc, node, size, pad = 4) {
  const b = visualBounds(doc, node);
  if (!b || !(b.w > 0 || b.h > 0)) return;
  const s = Math.min((size - pad * 2) / Math.max(b.w, 1e-6), (size - pad * 2) / Math.max(b.h, 1e-6));
  ctx.save();
  ctx.setTransform(s, 0, 0, s, size / 2 - (b.x + b.w / 2) * s, size / 2 - (b.y + b.h / 2) * s);
  drawNode(ctx, doc, node, { viewRect: null, outline: false, hairline: 1 / s, scale: s });
  ctx.restore();
}

/** A tiny document-like object for drawing standalone nodes (graphic style previews). */
export function standaloneDoc(nodes) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  return { get: (id) => map.get(id), has: (id) => map.has(id), assets: new Map() };
}
