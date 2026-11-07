/**
 * The geometry behind cropping an image: converting between a crop rectangle
 * on a preview and the engine's edge insets (percentages of the whole image,
 * `{ left, top, right, bottom }`), keeping the rectangle inside the frame,
 * dragging its handles or its middle, and fitting it to an aspect ratio.
 *
 * The engine renders a crop as `clip-path: inset(...)` and writes it to the
 * DOCX as the picture's source rectangle, so other readers show the same crop.
 */

const clampN = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// DOCX source-rectangle values use thousandths of a percent.
const roundCrop = (n) => Math.round(n * 1000) / 1000;

/** A crop rectangle `{x, y, w, h}` (frame pixels) from edge insets (percentages) and the frame size. */
export function rectFromCrop(crop = {}, frame) {
  const l = clampN(crop.left || 0, 0, 100);
  const t = clampN(crop.top || 0, 0, 100);
  const r = clampN(crop.right || 0, 0, 100);
  const b = clampN(crop.bottom || 0, 0, 100);
  return {
    x: (l / 100) * frame.w,
    y: (t / 100) * frame.h,
    w: Math.max(0, (1 - (l + r) / 100)) * frame.w,
    h: Math.max(0, (1 - (t + b) / 100)) * frame.h,
  };
}

/** Edge insets (percentages, three decimals) from a crop rectangle and the frame size. */
export function cropFromRect(rect, frame) {
  const left = roundCrop(clampN((rect.x / frame.w) * 100, 0, 100));
  const top = roundCrop(clampN((rect.y / frame.h) * 100, 0, 100));
  const right = roundCrop(clampN(((frame.w - rect.x - rect.w) / frame.w) * 100, 0, 100));
  const bottom = roundCrop(clampN(((frame.h - rect.y - rect.h) / frame.h) * 100, 0, 100));
  return { left, top, right, bottom };
}

/** Whether a crop actually trims anything. */
export function cropIsEmpty(crop) {
  return !crop || (!crop.left && !crop.top && !crop.right && !crop.bottom);
}

/** Keep a rectangle inside the frame at a minimum size, moving rather than shrinking when possible. */
export function clampRect(rect, frame, min = 16) {
  const w = clampN(rect.w, Math.min(min, frame.w), frame.w);
  const h = clampN(rect.h, Math.min(min, frame.h), frame.h);
  const x = clampN(rect.x, 0, frame.w - w);
  const y = clampN(rect.y, 0, frame.h - h);
  return { x, y, w, h };
}

/** Move a rectangle by (dx, dy), kept inside the frame. */
export function moveRect(rect, dx, dy, frame) {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, frame, 0);
}

// Which edges each handle drags. Corners move two edges; sides one.
const HANDLES = {
  nw: ['n', 'w'], n: ['n'], ne: ['n', 'e'], e: ['e'], se: ['s', 'e'], s: ['s'], sw: ['s', 'w'], w: ['w'],
};

/** Resize by dragging a handle, optionally keeping a width/height ratio. */
export function resizeRect(rect, handle, dx, dy, frame, min = 16, ratio = null) {
  const edges = HANDLES[handle];
  if (!edges) return rect;
  if (Number.isFinite(ratio) && ratio > 0) {
    const horizontal = edges.includes('e') ? 1 : edges.includes('w') ? -1 : 0;
    const vertical = edges.includes('s') ? 1 : edges.includes('n') ? -1 : 0;
    // Keep the opposite corner fixed; an edge drag grows around the center
    // of the perpendicular axis. The larger pointer movement drives corners.
    const anchorX = rect.x + (horizontal < 0 ? rect.w : horizontal === 0 ? rect.w / 2 : 0);
    const anchorY = rect.y + (vertical < 0 ? rect.h : vertical === 0 ? rect.h / 2 : 0);
    const fromWidth = rect.w + horizontal * dx;
    const fromHeight = (rect.h + vertical * dy) * ratio;
    const desired = !horizontal ? fromHeight : !vertical || Math.abs(dx) >= Math.abs(dy) * ratio ? fromWidth : fromHeight;
    const availableWidth = horizontal > 0 ? frame.w - anchorX : horizontal < 0 ? anchorX : 2 * Math.min(anchorX, frame.w - anchorX);
    const availableHeight = vertical > 0 ? frame.h - anchorY : vertical < 0 ? anchorY : 2 * Math.min(anchorY, frame.h - anchorY);
    const maxWidth = Math.min(availableWidth, availableHeight * ratio);
    const width = clampN(desired, Math.min(Math.max(min, min * ratio), maxWidth), maxWidth);
    const height = width / ratio;
    return {
      x: anchorX - (horizontal < 0 ? width : horizontal === 0 ? width / 2 : 0),
      y: anchorY - (vertical < 0 ? height : vertical === 0 ? height / 2 : 0),
      w: width, h: height,
    };
  }
  let { x, y, w, h } = rect;
  // Small previews and crops near an edge may have less than the preferred
  // minimum available. Keep the opposite edge fixed without leaving the image.
  if (edges.includes('w')) { const nx = clampN(x + dx, 0, x + w - min); w += x - nx; x = nx; }
  if (edges.includes('e')) { w = clampN(w + dx, Math.min(min, frame.w - x), frame.w - x); }
  if (edges.includes('n')) { const ny = clampN(y + dy, 0, y + h - min); h += y - ny; y = ny; }
  if (edges.includes('s')) { h = clampN(h + dy, Math.min(min, frame.h - y), frame.h - y); }
  return { x, y, w, h };
}

/** A centered rectangle of aspect ratio `ratio` (w/h) filling the frame, or the whole frame when ratio is null. */
export function aspectRect(frame, ratio) {
  if (!ratio) return { x: 0, y: 0, w: frame.w, h: frame.h };
  let w = frame.w;
  let h = w / ratio;
  if (h > frame.h) { h = frame.h; w = h * ratio; }
  return { x: (frame.w - w) / 2, y: (frame.h - h) / 2, w, h };
}

export const CROP_RATIOS = [
  { id: 'free', label: 'Freeform', ratio: null },
  { id: 'orig', label: 'Original', ratio: 'natural' },
  { id: '1', label: 'Square (1:1)', ratio: 1 },
  { id: '4:3', label: 'Standard (4:3)', ratio: 4 / 3 },
  { id: '3:2', label: 'Photo (3:2)', ratio: 3 / 2 },
  { id: '16:9', label: 'Wide (16:9)', ratio: 16 / 9 },
];
