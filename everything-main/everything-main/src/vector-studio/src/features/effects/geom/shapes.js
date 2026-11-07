/**
 * Convert to Shape and Crop Marks effect geometry.
 */
import { rectangle, ellipse } from '../../../model/shapes.js';
import { anchor } from '../../../model/bezier.js';

/**
 * Convert to Shape: the object draws as a rectangle, rounded rectangle or
 * ellipse centered on its bounds. Relative size adds `extraW` / `extraH`
 * to the bounds; absolute size uses `width` / `height`.
 */
export function convertToShape(subs, fx, b) {
  const w = fx.sizeMode === 'absolute' ? Math.max(0, fx.width || 0) : Math.max(0, b.w + 2 * (fx.extraW || 0));
  const h = fx.sizeMode === 'absolute' ? Math.max(0, fx.height || 0) : Math.max(0, b.h + 2 * (fx.extraH || 0));
  const x = b.x + b.w / 2 - w / 2;
  const y = b.y + b.h / 2 - h / 2;
  let anchors;
  if (fx.shape === 'ellipse') anchors = ellipse(x, y, w, h);
  else anchors = rectangle(x, y, w, h, fx.shape === 'roundedRectangle' ? Math.max(0, fx.radius || 0) : 0);
  return [{ anchors, closed: true }];
}

/** How crop marks paint: thin black lines, whatever the object's own paint. */
export const CROP_MARK_PAINT = Object.freeze({
  fill: null,
  stroke: Object.freeze({ type: 'solid', color: '#000000' }),
  strokeWidth: 0.3,
  strokeAlign: 'center',
  strokeCap: 'butt',
  dash: Object.freeze([]),
  arrowStart: null,
  arrowEnd: null,
});

/**
 * Crop Marks: trim marks at the four corners of the object's bounds, `gap`
 * away from the corner and `length` long, drawn on top of the object.
 */
export function cropMarks(subs, fx, b) {
  const gap = Math.max(0, fx.gap ?? 9);
  const len = Math.max(0.1, fx.length ?? 18);
  const line = (x1, y1, x2, y2) => ({ anchors: [anchor(x1, y1), anchor(x2, y2)], closed: false, paint: CROP_MARK_PAINT });
  const L = b.x;
  const R = b.x + b.w;
  const T = b.y;
  const B = b.y + b.h;
  return [
    ...subs,
    line(L - gap - len, T, L - gap, T),
    line(L, T - gap - len, L, T - gap),
    line(R + gap, T, R + gap + len, T),
    line(R, T - gap - len, R, T - gap),
    line(R + gap, B, R + gap + len, B),
    line(R, B + gap, R, B + gap + len),
    line(L - gap - len, B, L - gap, B),
    line(L, B + gap, L, B + gap + len),
  ];
}
