// Keep empty intersections on the enclosing cell's visible edge so hidden
// source positions cannot place the caret outside the containing cell.
export function intersectCellClip(inner, outer) {
  if (!inner) return outer;
  if (!outer) return inner;
  const top = Math.min(outer.bottom, Math.max(inner.top, outer.top));
  const horizontal = inner.left !== undefined || outer.left !== undefined;
  const left = Math.min(outer.right ?? Infinity, Math.max(inner.left ?? -Infinity, outer.left ?? -Infinity));
  return { top, bottom: Math.max(top, Math.min(inner.bottom, outer.bottom)), ...(horizontal ? { left, right: Math.max(left, Math.min(inner.right ?? Infinity, outer.right ?? Infinity)) } : {}) };
}

export const shiftCellClip = (clip, offset) => ({ ...clip, top: clip.top + offset, bottom: clip.bottom + offset });

export const cellClipContains = (clip, x, y) => !clip || x >= (clip.left ?? -Infinity) && x < (clip.right ?? Infinity) && y >= clip.top && y < clip.bottom;
export function clipCellRect(rect, clip) {
  if (!clip) return rect;
  const x = Math.max(rect.x, clip.left ?? -Infinity), right = Math.min(rect.x + rect.width, clip.right ?? Infinity);
  const y = Math.max(rect.y, clip.top), bottom = Math.min(rect.y + rect.height, clip.bottom);
  return right > x && bottom > y ? { ...rect, x, y, width: right - x, height: bottom - y } : null;
}
