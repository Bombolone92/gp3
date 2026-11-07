const ROTATABLE = new Set([
  "text",
  "rect",
  "ellipse",
  "image",
  "link",
  "file",
  "pen",
]);
export const canRotateItem = (i) => ROTATABLE.has(i.type) && !i.mindMap;
export const normalizeRotation = (angle) =>
  ((((angle + 180) % 360) + 360) % 360) - 180;
export const rotationOf = (i) => (canRotateItem(i) ? i.rotation || 0 : 0);
export const centerOf = (i) => ({ x: i.x + i.w / 2, y: i.y + i.h / 2 });
export function rotatePoint(point, center, angle) {
  if (!angle) return { x: point.x, y: point.y };
  const radians = (angle * Math.PI) / 180,
    c = Math.cos(radians),
    s = Math.sin(radians),
    x = point.x - center.x,
    y = point.y - center.y;
  return { x: center.x + x * c - y * s, y: center.y + x * s + y * c };
}
// Both helpers use absolute board coordinates. Object-local coordinates are
// obtained by subtracting x/y after undoing the center-pivot rotation.
export const worldPoint = (i, p) =>
  rotationOf(i) ? rotatePoint(p, centerOf(i), rotationOf(i)) : p;
export const localPoint = (i, p) =>
  rotationOf(i) ? rotatePoint(p, centerOf(i), -rotationOf(i)) : p;
export function setObjectHeight(i, height) {
  const before = rotationOf(i) ? worldPoint(i, i) : null;
  i.h = height;
  if (before) {
    const after = worldPoint(i, i);
    i.x = Math.max(-1e6, Math.min(1e6, i.x + before.x - after.x));
    i.y = Math.max(-1e6, Math.min(1e6, i.y + before.y - after.y));
  }
}
export function boxCorners(i, angle = rotationOf(i)) {
  const center = centerOf(i);
  return [
    { x: i.x, y: i.y },
    { x: i.x + i.w, y: i.y },
    { x: i.x + i.w, y: i.y + i.h },
    { x: i.x, y: i.y + i.h },
  ].map((p) => rotatePoint(p, center, angle));
}
export function objectBounds(i, angle = rotationOf(i)) {
  if (!angle)
    return {
      x: Math.min(i.x, i.x + i.w),
      y: Math.min(i.y, i.y + i.h),
      w: Math.abs(i.w),
      h: Math.abs(i.h),
    };
  const c = centerOf(i),
    radians = (angle * Math.PI) / 180,
    cos = Math.abs(Math.cos(radians)),
    sin = Math.abs(Math.sin(radians)),
    w = Math.abs(i.w) * cos + Math.abs(i.h) * sin,
    h = Math.abs(i.w) * sin + Math.abs(i.h) * cos;
  return { x: c.x - w / 2, y: c.y - h / 2, w, h };
}
export function selectionBox(items) {
  if (items.length === 1) {
    const i = items[0];
    return {
      x: i.x,
      y: i.y,
      w: Math.abs(i.w),
      h: Math.abs(i.h),
      rotation: rotationOf(i),
    };
  }
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const i of items) {
    const b = objectBounds(i);
    x = Math.min(x, b.x);
    y = Math.min(y, b.y);
    right = Math.max(right, b.x + b.w);
    bottom = Math.max(bottom, b.y + b.h);
  }
  return { x, y, w: right - x, h: bottom - y, rotation: 0 };
}
export const boxPoint = (box, p) =>
  rotatePoint(p, centerOf(box), box.rotation || 0);
