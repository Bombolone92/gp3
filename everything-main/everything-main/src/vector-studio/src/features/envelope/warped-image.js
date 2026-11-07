/**
 * Images inside envelopes. An image is mapped as a grid of points (its
 * pixel rectangle sampled through the envelope) and becomes a generated
 * leaf of type 'warpedImage':
 *
 *   { type: 'warpedImage', asset, width, height, nu, nv, grid: [x, y, ...],
 *     outline: anchors, preserve: 'clip' | 'transparency', antialias }
 *
 * The canvas draws it triangle by triangle, each an affine piece of the
 * image clipped to its mapped triangle (a mesh warp, sharp at any zoom).
 * Exports and Expand embed a warped raster: with 'clip' the raster bleeds
 * past the shape and a clipping path keeps the exact outline; with
 * 'transparency' the raster carries the shape in its alpha channel.
 */
import { registerLive, virtualId } from '../../model/live.js';
import { pathBounds } from '../../model/bezier.js';
import { uid } from '../../lib/ids.js';
import { tracePath, imageFor } from '../../render/draw.js';
import { exportWriters } from '../io/hooks.js';
import { encodePNG } from '../mesh/mesh-raster.js';

export const WARPED_IMAGE = 'warpedImage';

/** Test and embedding hooks: decode(doc, assetId) -> a drawable image (or null). */
export const warpedImageHooks = { decode: null };

const escapeXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function sourceImage(doc, node) {
  if (warpedImageHooks.decode) return warpedImageHooks.decode(doc, node.asset);
  return imageFor(doc, node.asset);
}

const outlineCache = new WeakMap();
function outlinePath(node) {
  let p = outlineCache.get(node);
  if (!p) outlineCache.set(node, (p = tracePath(new Path2D(), node.outline, true)));
  return p;
}

/** The affine matrix taking triangle (s0, s1, s2) onto (d0, d1, d2); points as [x, y]. */
export function triangleMatrix(s0, s1, s2, d0, d1, d2) {
  const [x0, y0] = s0;
  const [x1, y1] = s1;
  const [x2, y2] = s2;
  const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(den) < 1e-12) return null;
  const du1 = d1[0] - d0[0];
  const du2 = d2[0] - d0[0];
  const dv1 = d1[1] - d0[1];
  const dv2 = d2[1] - d0[1];
  const a = (du1 * (y2 - y0) - du2 * (y1 - y0)) / den;
  const c = (du2 * (x1 - x0) - du1 * (x2 - x0)) / den;
  const b = (dv1 * (y2 - y0) - dv2 * (y1 - y0)) / den;
  const d = (dv2 * (x1 - x0) - dv1 * (x2 - x0)) / den;
  return [a, b, c, d, d0[0] - a * x0 - c * y0, d0[1] - b * x0 - d * y0];
}

/** Triangles of the grid: [[src, src, src], [dst, dst, dst]] with points as [x, y]. */
export function warpTriangles(node) {
  const { nu, nv, grid, width: w, height: h } = node;
  const src = (a, b) => [(a / nu) * w, (b / nv) * h];
  const dst = (a, b) => {
    const k = (b * (nu + 1) + a) * 2;
    return [grid[k], grid[k + 1]];
  };
  const out = [];
  for (let b = 0; b < nv; b++) {
    for (let a = 0; a < nu; a++) {
      out.push([[src(a, b), src(a + 1, b), src(a + 1, b + 1)], [dst(a, b), dst(a + 1, b), dst(a + 1, b + 1)]]);
      out.push([[src(a, b), src(a + 1, b + 1), src(a, b + 1)], [dst(a, b), dst(a + 1, b + 1), dst(a, b + 1)]]);
    }
  }
  return out;
}

/** Draw the warped image into ctx (document coordinates); triangles grow by `grow` to close seams. */
function paintTriangles(ctx, img, node, grow) {
  for (const [s, d] of warpTriangles(node)) {
    const m = triangleMatrix(s[0], s[1], s[2], d[0], d[1], d[2]);
    if (!m) continue;
    const cx = (d[0][0] + d[1][0] + d[2][0]) / 3;
    const cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
    ctx.save();
    ctx.beginPath();
    d.forEach(([x, y], i) => {
      const l = Math.hypot(x - cx, y - cy) || 1;
      const px = x + ((x - cx) / l) * grow;
      const py = y + ((y - cy) / l) * grow;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.clip();
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.drawImage(img, 0, 0, node.width, node.height);
    ctx.restore();
  }
}

/** Canvas renderer for a warped image. */
export function drawWarpedImage(ctx, doc, node, opts) {
  const path = outlinePath(node);
  if (opts.outline) {
    ctx.strokeStyle = opts.outlineColor || '#000';
    ctx.lineWidth = opts.hairline;
    ctx.setLineDash([]);
    ctx.stroke(path);
    return;
  }
  const img = sourceImage(doc, node);
  if (!img) return;
  const t = ctx.getTransform();
  const dev = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
  ctx.save();
  ctx.imageSmoothingEnabled = node.antialias !== false;
  if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = 'high';
  if (node.preserve !== 'transparency') {
    ctx.clip(path);
    paintTriangles(ctx, img, node, 1.5 / dev);
  } else paintTriangles(ctx, img, node, 0.4 / dev);
  ctx.restore();
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width: w, height: h });
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

/**
 * The warped image as a raster: { dataUrl, pixels: { width, height, data },
 * rect } covering the outline's bounds at about the image's own pixel
 * density (at least 1 and at most 4 pixels per point, 4096 per side), or
 * null without a decoded image.
 */
export function warpedRaster(doc, node, { maxPx = 4096 } = {}) {
  const img = sourceImage(doc, node);
  if (!img) return null;
  const b = pathBounds(node.outline, true);
  if (!b || !(b.w > 0) || !(b.h > 0)) return null;
  const natW = img.naturalWidth || img.width || node.width;
  const natH = img.naturalHeight || img.height || node.height;
  // Image pixels over the warped area (shoelace on the grid outline).
  let area = 0;
  const o = node.outline;
  for (let i = 0; i < o.length; i++) {
    const p = o[i];
    const q = o[(i + 1) % o.length];
    area += p.x * q.y - q.x * p.y;
  }
  area = Math.abs(area) / 2 || b.w * b.h;
  let s = Math.max(1, Math.min(4, Math.sqrt((natW * natH) / area)));
  s = Math.min(s, maxPx / Math.max(b.w, b.h));
  const W = Math.max(1, Math.ceil(b.w * s));
  const H = Math.max(1, Math.ceil(b.h * s));
  const canvas = makeCanvas(W, H);
  const ctx = canvas?.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(W / b.w, 0, 0, H / b.h, (-b.x * W) / b.w, (-b.y * H) / b.h);
  ctx.imageSmoothingEnabled = node.antialias !== false;
  if (node.preserve === 'transparency') {
    // The shape lives in the alpha channel: a smooth edge along the outline.
    ctx.save();
    ctx.clip(outlinePath(node));
    paintTriangles(ctx, img, node, 0.5 / s);
    ctx.restore();
  } else paintTriangles(ctx, img, node, 2.5 / s);
  let data = null;
  try {
    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    data = null;
  }
  if (!data || data.length !== W * H * 4) data = new Uint8ClampedArray(W * H * 4);
  let dataUrl = null;
  const real = typeof CanvasRenderingContext2D !== 'undefined' && ctx instanceof CanvasRenderingContext2D;
  if (real && typeof canvas.toDataURL === 'function') {
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch {
      dataUrl = null;
    }
  }
  if (!dataUrl || !dataUrl.startsWith('data:image/png')) dataUrl = `data:image/png;base64,${base64(encodePNG(data, W, H))}`;
  return { dataUrl, pixels: { width: W, height: H, data }, rect: b };
}

const plain = (n) => ({ name: n.name || '', opacity: n.opacity ?? 1, blendMode: n.blendMode || 'normal', effects: n.effects || [], hidden: false, locked: false });

/**
 * Real nodes for a warped image (Object > Expand): { root, nodes } with
 * the warped raster stored as a new asset, clipped to the outline when the
 * shape is preserved with a clipping mask. Without a decoded image the
 * original image is kept, clipped to the warped outline.
 */
export function bakeWarpedImage(doc, node) {
  const r = warpedRaster(doc, node);
  const nodes = [];
  const outline = { id: virtualId(node.id), type: 'path', name: '', anchors: node.outline, closed: true, fill: null, stroke: null, strokeWidth: 0, opacity: 1, blendMode: 'normal', effects: [], hidden: false, locked: false };
  let image;
  if (r) {
    const asset = uid('img');
    doc.assets.set(asset, { mime: 'image/png', data: r.dataUrl, name: 'Envelope image' });
    image = { id: virtualId(node.id), type: 'image', asset, width: r.pixels.width, height: r.pixels.height, transform: [r.rect.w / r.pixels.width, 0, 0, r.rect.h / r.pixels.height, r.rect.x, r.rect.y], ...plain(node) };
    if (node.preserve === 'transparency') return { root: image, nodes: [] };
  } else {
    const p0 = [node.grid[0], node.grid[1]];
    const k1 = node.nu * 2;
    const k2 = node.nv * (node.nu + 1) * 2;
    const m = triangleMatrix([0, 0], [node.width, 0], [0, node.height], p0, [node.grid[k1], node.grid[k1 + 1]], [node.grid[k2], node.grid[k2 + 1]]) || [1, 0, 0, 1, 0, 0];
    image = { id: virtualId(node.id), type: 'image', asset: node.asset, width: node.width, height: node.height, transform: m, ...plain(node) };
  }
  nodes.push({ ...image, opacity: 1, blendMode: 'normal', effects: [] }, outline);
  const root = { id: virtualId(node.id), type: 'group', clip: true, children: [image.id, outline.id], ...plain(node) };
  return { root, nodes };
}

// ---- export ----

/** SVG writer: the warped raster (clipped to the outline when preserving with a mask). */
function writeSVG(w, node, depth) {
  const r = warpedRaster(w.doc, node);
  if (!r) return '';
  const p = w.map(r.rect.x, r.rect.y);
  w.needsXlink = true;
  const image = `<image x="${w.n(p.x)}" y="${w.n(p.y)}" width="${w.n(r.rect.w)}" height="${w.n(r.rect.h)}" preserveAspectRatio="none" xlink:href="${escapeXml(r.dataUrl)}"/>`;
  if (node.preserve === 'transparency') return `${w.nl(depth)}<g${w.nameId(node.name)}${w.commonAttrs(node)}>${w.nl(depth + 1)}${image}${w.nl(depth)}</g>`;
  const nl = w.nl(2);
  const cp = w.def('c', (id) => `${nl}<clipPath id="${id}">${nl}  <path d="${w.d([{ anchors: node.outline, closed: true }])}"/>${nl}</clipPath>`);
  return `${w.nl(depth)}<g${w.nameId(node.name)} clip-path="url(#${cp})"${w.commonAttrs(node)}>${w.nl(depth + 1)}${image}${w.nl(depth)}</g>`;
}

/** Wait for an image asset to decode (PDF export runs asynchronously). */
async function decoded(doc, node) {
  if (warpedImageHooks.decode || typeof Image === 'undefined') return;
  const asset = doc.assets.get(node.asset);
  if (!asset?.data || imageFor(doc, node.asset)) return;
  const img = new Image();
  img.src = asset.data;
  try {
    await img.decode();
  } catch {
    // Left out below.
  }
  // imageFor decodes too; give its load handler a turn.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** PDF writer: the warped raster as an image XObject, clipped like the canvas. */
async function writePDF(r, ctx, node) {
  await decoded(r.doc, node);
  const ras = warpedRaster(r.doc, node);
  if (!ras) {
    r.warnings?.add?.('Some images could not be decoded and were left out.');
    return;
  }
  const id = r.pixelsXObject(ras.pixels);
  const rect = ras.rect;
  const gs = r.extGState(node.opacity ?? 1, node.opacity ?? 1, node.blendMode);
  let out = 'q\n';
  if (gs) out += `/${ctx.res.name(ctx.res.ext, 'GS', gs)} gs\n`;
  if (node.preserve !== 'transparency') out += `${r.pathOps([{ anchors: node.outline, closed: true }])}W n\n`;
  out += `${r.f(rect.w)} 0 0 ${r.f(-rect.h)} ${r.f(rect.x)} ${r.f(rect.y + rect.h)} cm\n/${ctx.res.name(ctx.res.xobject, 'Im', id)} Do\nQ\n`;
  ctx.ops.push(out);
}

registerLive(WARPED_IMAGE, {
  label: '<Image>',
  exportSelf: true,
  // The outline gives bounds and hit testing; the renderer draws the image.
  generate(doc, node) {
    const id = virtualId(node.id);
    const outline = { id, type: 'path', name: '', anchors: node.outline, closed: true, fill: { type: 'solid', color: '#808080' }, stroke: null, strokeWidth: 0, opacity: 1, blendMode: 'normal', effects: [], hidden: false, locked: false };
    return { items: [outline], extra: new Map([[id, outline]]) };
  },
  draw: drawWarpedImage,
  expandArtwork(doc, node) {
    const b = bakeWarpedImage(doc, node);
    return { items: [b.root.id], extra: new Map([b.root, ...b.nodes].map((n) => [n.id, n])) };
  },
});

exportWriters.svg.set(WARPED_IMAGE, writeSVG);
exportWriters.pdf.set(WARPED_IMAGE, writePDF);
