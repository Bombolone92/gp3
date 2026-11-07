import { worldPoint, centerOf, rotationOf } from "./geometry.js";
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const FULL_CROP = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
export const cropOf = (i) => i.crop || FULL_CROP;

export function validCrop(c) {
  return (
    c &&
    typeof c === "object" &&
    !Array.isArray(c) &&
    ["x", "y", "w", "h"].every((k) => Number.isFinite(c[k])) &&
    c.x >= 0 &&
    c.y >= 0 &&
    c.w >= 1e-12 &&
    c.h >= 1e-12 &&
    c.x + c.w <= 1 + 1e-10 &&
    c.y + c.h <= 1 + 1e-10 &&
    (c.mask === undefined || c.mask === "ellipse") &&
    (c.sourceAspect === undefined ||
      (Number.isFinite(c.sourceAspect) &&
        c.sourceAspect >= 1 / 4e7 &&
        c.sourceAspect <= 4e7)) &&
    Object.keys(c).every((k) =>
      ["x", "y", "w", "h", "mask", "sourceAspect"].includes(k),
    )
  );
}

export function cropBox(full, crop) {
  return {
    x: full.x + crop.x * full.w,
    y: full.y + crop.y * full.h,
    w: crop.w * full.w,
    h: crop.h * full.h,
  };
}

// One source/destination calculation serves the canvas, exports and editor.
// Existing images retain their contain/letterbox behavior after free resizing.
export function imageLayout(i, width, height) {
  const c = cropOf(i);
  const source = {
    x: c.x * width,
    y: c.y * height,
    w: c.w * width,
    h: c.h * height,
  };
  const scale = Math.min(Math.abs(i.w) / source.w, Math.abs(i.h) / source.h);
  const w = source.w * scale,
    h = source.h * scale;
  const box = {
    x: i.x + (Math.abs(i.w) - w) / 2,
    y: i.y + (Math.abs(i.h) - h) / 2,
    w,
    h,
  };
  return {
    source,
    box,
    full: {
      x: box.x - c.x * width * scale,
      y: box.y - c.y * height * scale,
      w: width * scale,
      h: height * scale,
    },
  };
}

export function sameCrop(a, b) {
  return (
    a.mask === b.mask &&
    ["x", "y", "w", "h"].every((k) => Math.abs(a[k] - b[k]) < 1e-10)
  );
}

// Cropped images carry their original aspect so hit testing and attached
// connectors can exclude letterboxing without decoding image data.
export function imageContentBox(i) {
  return i.crop?.sourceAspect
    ? imageLayout(i, i.crop.sourceAspect, 1).box
    : { x: i.x, y: i.y, w: i.w, h: i.h };
}

export function cropResult(i, full, crop) {
  if (!validCrop(crop)) throw Error("Invalid image crop.");
  if (sameCrop(cropOf(i), crop)) return null;
  const box = cropBox(full, crop);
  if (rotationOf(i)) {
    const center = worldPoint(i, centerOf(box));
    box.x = center.x - box.w / 2;
    box.y = center.y - box.h / 2;
  }
  if (
    !Object.values(box).every(
      (n) => Number.isFinite(n) && Math.abs(n) <= 1e6,
    ) ||
    box.w < 0.001 ||
    box.h < 0.001
  )
    throw Error("This crop exceeds the board size limits.");
  return {
    ...box,
    crop: sameCrop(crop, FULL_CROP)
      ? undefined
      : { ...crop, sourceAspect: full.w / full.h },
  };
}

export function aspectCrop(c, ratio) {
  if (!ratio) return { ...c };
  const w = Math.min(c.w, c.h * ratio),
    h = w / ratio;
  return { ...c, x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h };
}

// Deltas and ratios use normalized source coordinates. Side handles retain
// the opposing edge; corner handles retain the opposite corner.
export function dragCrop(
  c,
  handle,
  dx,
  dy,
  ratio = 0,
  minW = 0.001,
  minH = 0.001,
) {
  if (handle === "move")
    return {
      ...c,
      x: clamp(c.x + dx, 0, 1 - c.w),
      y: clamp(c.y + dy, 0, 1 - c.h),
    };
  const sx = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const sy = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  const ax = sx < 0 ? c.x + c.w : sx > 0 ? c.x : c.x + c.w / 2;
  const ay = sy < 0 ? c.y + c.h : sy > 0 ? c.y : c.y + c.h / 2;
  const maxW = sx < 0 ? ax : sx > 0 ? 1 - ax : 2 * Math.min(ax, 1 - ax);
  const maxH = sy < 0 ? ay : sy > 0 ? 1 - ay : 2 * Math.min(ay, 1 - ay);
  let w = sx ? clamp(c.w + sx * dx, Math.min(minW, maxW), maxW) : c.w;
  let h = sy ? clamp(c.h + sy * dy, Math.min(minH, maxH), maxH) : c.h;
  if (ratio) {
    if (!sx || (sy && Math.abs(h / c.h - 1) > Math.abs(w / c.w - 1)))
      w = h * ratio;
    const max = Math.min(maxW, maxH * ratio);
    w = clamp(w, Math.min(max, Math.max(minW, minH * ratio)), max);
    h = w / ratio;
  }
  const x = Math.max(0, sx < 0 ? ax - w : sx > 0 ? ax : ax - w / 2);
  const y = Math.max(0, sy < 0 ? ay - h : sy > 0 ? ay : ay - h / 2);
  return { ...c, x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}
