/** DrawingML relative rectangles: positive edges inset, negative edges outset. */
export function pictureRect(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rect = {};
  for (const side of ['l', 't', 'r', 'b']) {
    const n = raw[side];
    if (Number.isFinite(n) && n !== 0 && n >= -21474.83648 && n <= 21474.83647) rect[side] = n;
  }
  return Object.keys(rect).length ? rect : null;
}

export function readPictureRect(attrs) {
  return pictureRect(Object.fromEntries(Object.entries(attrs || {}).map(([k, v]) =>
    [k, /%$/.test(v) ? Number(v.slice(0, -1)) / 100 : Number(v) / 100000])));
}

/** Map the source crop onto the fill rectangle in unit shape coordinates. */
export function pictureGeometry(obj) {
  const box = rect => ({ x: rect?.l || 0, y: rect?.t || 0,
    w: 1 - (rect?.l || 0) - (rect?.r || 0), h: 1 - (rect?.t || 0) - (rect?.b || 0) });
  const source = box(obj.srcRect), fill = box(obj.fillRect);
  if (source.w <= 0 || source.h <= 0 || fill.w <= 0 || fill.h <= 0) return null;
  const w = fill.w / source.w, h = fill.h / source.h;
  return { source, fill, x: fill.x - source.x * w, y: fill.y - source.y * h, w, h };
}

/** Shared with clipboard rasterization; clipping retains transparent source outsets. */
export function drawPicture(ctx, image, obj, width, height) {
  const g = pictureGeometry(obj);
  if (!g) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.fill.x * width, g.fill.y * height, g.fill.w * width, g.fill.h * height);
  ctx.clip();
  ctx.drawImage(image, g.x * width, g.y * height, g.w * width, g.h * height);
  ctx.restore();
}
