/**
 * Image commands: Crop Image (the asset itself is cropped, optionally at a
 * lower resolution), Create Object Mosaic (a grid of colored rectangles
 * sampled from the image), Make Pixel Perfect (anchors and strokes snapped
 * to the pixel grid) and Embed Image (linked images become part of the
 * document).
 */
import { uid } from '../../lib/ids.js';
import { multiply, translate, apply, scaleFactor, invert } from '../../lib/matrix.js';
import { createPath, createGroup } from '../../model/nodes.js';
import { rectangle, shapeAnchors } from '../../model/shapes.js';
import { transformAnchors } from '../../model/bezier.js';
import { nodeBounds, transformNodes } from '../../model/geometry.js';
import { dataUrlToBytes, imageSize, blobToDataUrl, sniffMime } from '../io/image-info.js';
import { assetPixels, resample } from './trace-runner.js';
import { toHex, luma } from './color.js';

// ---- pixel helpers ----

/** Copy a pixel rectangle out of RGBA pixels. */
export function cropPixels(src, x, y, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const s = ((y + row) * src.width + x) * 4;
    out.set(src.data.subarray(s, s + w * 4), row * w * 4);
  }
  return { width: w, height: h, data: out };
}

let encoder = null;

/** Replace how pixels are encoded to a data URL: fn(pixels, mime) -> url (tests, headless). */
export function setPixelEncoder(fn) {
  encoder = fn;
}

/** Encode RGBA pixels as a data URL of `mime` (PNG, JPEG or WebP). */
export async function encodePixels(px, mime = 'image/png') {
  if (encoder) return encoder(px, mime);
  const canvas = document.createElement('canvas');
  canvas.width = px.width;
  canvas.height = px.height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
  const type = mime === 'image/jpeg' || mime === 'image/webp' ? mime : 'image/png';
  const url = canvas.toDataURL(type, 0.92);
  // Browsers without WebP encoding return PNG data.
  return url;
}

/** Natural pixel size of an image asset, read from its header when possible. */
export async function naturalSize(doc, assetId) {
  const a = doc.assets.get(assetId);
  if (!a) return null;
  if (!a.external) {
    const b = dataUrlToBytes(a.data);
    const s = b && imageSize(b.bytes);
    if (s?.width && s?.height) return s;
  }
  try {
    const px = await assetPixels(doc, assetId, null);
    return { width: px.width, height: px.height };
  } catch {
    return null;
  }
}

/** Synchronous natural size from the header of an embedded asset, or null. */
export function headerSize(doc, assetId) {
  const a = doc.assets.get(assetId);
  if (!a || a.external) return null;
  const b = dataUrlToBytes(a.data);
  const s = b && imageSize(b.bytes);
  return s?.width && s?.height ? s : null;
}

/** Pixels per inch of an image as placed (points are 1/72 inch). */
export function effectivePpi(node, natural) {
  if (!natural) return null;
  const unitsPerPixel = (node.width / natural.width) * scaleFactor(node.transform || [1, 0, 0, 1, 0, 0]);
  return unitsPerPixel > 0 ? 72 / unitsPerPixel : null;
}

// ---- crop ----

/** Clamp a crop rectangle (image-local units) to the image, at least `min` in size. */
export function clampCropRect(r, node, min = 1) {
  let { x, y, w, h } = r;
  w = Math.max(min, Math.min(node.width, w));
  h = Math.max(min, Math.min(node.height, h));
  x = Math.max(0, Math.min(node.width - w, x));
  y = Math.max(0, Math.min(node.height - h, y));
  return { x, y, w, h };
}

/** The crop rectangle snapped to whole source pixels: { local rect, pixel rect }. */
export function cropToPixels(node, natural, r) {
  const sx = natural.width / node.width;
  const sy = natural.height / node.height;
  const px0 = Math.max(0, Math.min(natural.width - 1, Math.floor(r.x * sx + 1e-6)));
  const py0 = Math.max(0, Math.min(natural.height - 1, Math.floor(r.y * sy + 1e-6)));
  const px1 = Math.max(px0 + 1, Math.min(natural.width, Math.ceil((r.x + r.w) * sx - 1e-6)));
  const py1 = Math.max(py0 + 1, Math.min(natural.height, Math.ceil((r.y + r.h) * sy - 1e-6)));
  return {
    local: { x: px0 / sx, y: py0 / sy, w: (px1 - px0) / sx, h: (py1 - py0) / sy },
    pixels: { x: px0, y: py0, w: px1 - px0, h: py1 - py0 },
  };
}

/**
 * Crop an image object to `rect` (image-local units). `ppi` lowers the
 * resolution of the kept pixels when it is below the current one.
 * Creates a new asset (the old one stays for undo) and updates the node in
 * one undoable step. Resolves to the updated node.
 */
export async function cropImage(doc, imageId, rect, { ppi = null } = {}) {
  const node0 = doc.get(imageId);
  if (!node0 || node0.type !== 'image') return null;
  const asset = doc.assets.get(node0.asset);
  const full = await assetPixels(doc, node0.asset, null);
  const natural = { width: full.width, height: full.height };
  const { local, pixels } = cropToPixels(node0, natural, clampCropRect(rect, node0, 0));
  let px = cropPixels(full, pixels.x, pixels.y, pixels.w, pixels.h);
  const cur = effectivePpi(node0, natural);
  if (ppi && cur && ppi < cur - 0.5) {
    const k = ppi / cur;
    px = resample(px, Math.max(1, Math.round(px.width * k)), Math.max(1, Math.round(px.height * k)));
  }
  const mime = asset?.mime === 'image/jpeg' || asset?.mime === 'image/webp' ? asset.mime : 'image/png';
  const data = await encodePixels(px, mime);
  const node = doc.get(imageId);
  if (!node || node.asset !== node0.asset) return null; // changed meanwhile
  const id = uid('img');
  doc.assets.set(id, { mime, data, name: asset?.name || '' });
  let out = null;
  doc.transact('Crop Image', () => {
    out = doc.update(imageId, { asset: id, width: local.w, height: local.h, transform: multiply(node.transform, translate(local.x, local.y)) });
  });
  return out;
}

// ---- object mosaic ----

/**
 * Average colors of a cols x rows grid over RGBA pixels. Transparent
 * pixels count as white. Returns an array of { r, g, b } row by row.
 */
export function tileColors(px, cols, rows) {
  const out = [];
  for (let j = 0; j < rows; j++) {
    const y0 = Math.floor((j * px.height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((j + 1) * px.height) / rows));
    for (let i = 0; i < cols; i++) {
      const x0 = Math.floor((i * px.width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) * px.width) / cols));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < Math.min(y1, px.height); y++) {
        for (let x = x0; x < Math.min(x1, px.width); x++) {
          const k = (y * px.width + x) * 4;
          const a = px.data[k + 3] / 255;
          r += px.data[k] * a + 255 * (1 - a);
          g += px.data[k + 1] * a + 255 * (1 - a);
          b += px.data[k + 2] * a + 255 * (1 - a);
          n++;
        }
      }
      out.push(n ? { r: r / n, g: g / n, b: b / n } : { r: 255, g: 255, b: 255 });
    }
  }
  return out;
}

export const MAX_TILES = 40000;

/** Tile layout for mosaic options: { tileW, tileH } in image-local units, or null when impossible. */
export function mosaicLayout({ cols, rows, width, height, gapX = 0, gapY = 0 }) {
  if (!(cols >= 1 && rows >= 1)) return null;
  const tileW = (width - (cols - 1) * gapX) / cols;
  const tileH = (height - (rows - 1) * gapY) / rows;
  if (!(tileW > 0 && tileH > 0)) return null;
  return { tileW, tileH };
}

/**
 * Build a mosaic group from tile colors (inside a transaction). opts:
 *   cols, rows        tiles across and down
 *   width, height     result size in image-local units
 *   gapX, gapY        space between tiles (image-local units)
 *   gray              grayscale tiles
 *   deleteImage       remove the source image
 * Returns the new group.
 */
export function buildMosaic(doc, imageId, colors, opts) {
  const img = doc.get(imageId);
  if (!img) return null;
  const { cols, rows, gapX = 0, gapY = 0, gray = false, deleteImage = false } = opts;
  const lay = mosaicLayout(opts);
  if (!lay) return null;
  const m = img.transform || [1, 0, 0, 1, 0, 0];
  const nodes = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const c = colors[j * cols + i];
      const v = gray ? luma(c.r, c.g, c.b) : null;
      const hex = toHex(gray ? { r: v, g: v, b: v } : c);
      const anchors = transformAnchors(rectangle(i * (lay.tileW + gapX), j * (lay.tileH + gapY), lay.tileW, lay.tileH), m);
      nodes.push(createPath(anchors, true, { fill: { type: 'solid', color: hex }, stroke: null, strokeWidth: 0 }));
    }
  }
  const parent = doc.get(img.parent);
  const index = parent.children.indexOf(imageId) + 1;
  const g = doc.insert(createGroup(nodes.map((n) => n.id), { name: 'Mosaic' }), parent.id, index, nodes);
  if (deleteImage) doc.remove(imageId);
  return doc.get(g.id);
}

/** Sample tile colors for an image (async: decodes its pixels). */
export async function mosaicColors(doc, imageId, cols, rows) {
  const img = doc.get(imageId);
  const full = await assetPixels(doc, img.asset, null);
  // Very large images are averaged from a smaller copy (still many pixels per tile).
  const limit = 2_000_000;
  const px = full.width * full.height > limit ? resample(full, Math.round(full.width * Math.sqrt(limit / (full.width * full.height))), Math.round(full.height * Math.sqrt(limit / (full.width * full.height)))) : full;
  return tileColors(px, cols, rows);
}

/** Rows that make tiles square for a column count. */
export function squareRows(cols, width, height, gapX = 0, gapY = 0) {
  const tileW = (width - (cols - 1) * gapX) / cols;
  return Math.max(1, Math.round((height + gapY) / (tileW + gapY)));
}

// ---- pixel perfect ----

const snap = (v, half) => (half ? Math.floor(v) + 0.5 : Math.round(v));

function snapAnchors(anchors, half) {
  return anchors.map((a) => {
    const x = snap(a.x, half);
    const y = snap(a.y, half);
    const dx = x - a.x;
    const dy = y - a.y;
    // Handles move with their anchor.
    return { x, y, ix: a.ix + dx, iy: a.iy + dy, ox: a.ox + dx, oy: a.oy + dy };
  });
}

/**
 * Snap paths to the pixel grid (1 point = 1 pixel at 72 ppi), inside a
 * transaction. Stroke weights round to whole pixels (at least 1); anchors
 * land on pixel edges, or on pixel centers when the stroke weight is odd,
 * so horizontal and vertical strokes cover whole pixels. Live rectangles
 * keep their shape. Returns the ids changed.
 */
export function makePixelPerfect(doc, ids) {
  const changed = [];
  const visit = (id) => {
    const n = doc.get(id);
    if (!n || n.locked) return;
    if (n.type === 'group' || n.type === 'layer') {
      if (n.live) return;
      n.children.forEach(visit);
      return;
    }
    if (n.type !== 'path' && n.type !== 'compound') return;
    const sw = n.stroke && n.strokeWidth > 0 ? Math.max(1, Math.round(n.strokeWidth)) : 0;
    // Odd strokes centered on the path cover whole pixels from pixel centers.
    const half = sw % 2 === 1 && (n.strokeAlign || 'center') === 'center';
    const patch = sw ? { strokeWidth: sw } : {};
    if (n.type === 'path') {
      if (n.shape?.kind === 'rect' && !n.shape.angle) {
        const s = n.shape;
        const x0 = snap(s.cx - s.w / 2, half);
        const y0 = snap(s.cy - s.h / 2, half);
        const w = Math.max(1, Math.round(s.w));
        const h = Math.max(1, Math.round(s.h));
        const shape = { ...s, cx: x0 + w / 2, cy: y0 + h / 2, w, h };
        doc.update(n.id, { ...patch, shape, anchors: shapeAnchors(shape) });
      } else if (n.shape && n.shape.kind !== 'line') {
        // Other live shapes move so their box starts on the grid.
        const b = nodeBounds(doc, n);
        if (b) transformNodes(doc, [n.id], translate(snap(b.x, half) - b.x, snap(b.y, half) - b.y));
        if (sw) doc.update(n.id, patch);
      } else {
        doc.update(n.id, { ...patch, anchors: snapAnchors(n.anchors, half), shape: n.shape?.kind === 'line' ? undefined : n.shape });
      }
      changed.push(n.id);
    } else {
      for (const c of n.children) {
        const cn = doc.get(c);
        if (cn?.anchors) doc.update(c, { anchors: snapAnchors(cn.anchors, half) });
      }
      if (sw) doc.update(n.id, patch);
      changed.push(n.id);
    }
  };
  ids.forEach(visit);
  return changed;
}

// ---- embed ----

/**
 * Embed linked images: their files are downloaded into new embedded
 * assets and the image objects switch to them in one undoable step.
 * Resolves to the number of images embedded.
 */
export async function embedImages(doc, imageIds) {
  const nodes = imageIds.map((id) => doc.get(id)).filter((n) => n?.type === 'image' && doc.assets.get(n.asset)?.external);
  const made = new Map();
  for (const n of nodes) {
    if (made.has(n.asset)) continue;
    const a = doc.assets.get(n.asset);
    const res = await fetch(a.data);
    if (!res.ok) throw new Error(`The linked image could not be downloaded (${res.status}).`);
    const blob = await res.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mime = sniffMime(bytes) || blob.type || a.mime || 'image/png';
    const id = uid('img');
    doc.assets.set(id, { mime, data: await blobToDataUrl(new Blob([bytes], { type: mime })), name: a.name || '' });
    made.set(n.asset, id);
  }
  if (!made.size) return 0;
  let count = 0;
  doc.transact('Embed Image', () => {
    for (const n of nodes) {
      const cur = doc.get(n.id);
      if (cur && made.has(cur.asset)) {
        doc.update(n.id, { asset: made.get(cur.asset) });
        count++;
      }
    }
  });
  return count;
}

/** Image-local point for a document point. */
export function toLocal(node, x, y) {
  return apply(invert(node.transform || [1, 0, 0, 1, 0, 0]), x, y);
}
