/**
 * The document-space pixel pipeline shared by the Effect Gallery filters
 * and SVG filters.
 *
 * The renderer hands a content effect the object's layer in device pixels.
 * Here the layer is resampled onto a grid in document space at the
 * document's raster effects resolution (anchored to the document origin,
 * so the grid does not move with the view), processed as a float image,
 * and drawn back. Results therefore look the same at every zoom level and
 * in every export.
 *
 * Results are cached by input pixels, parameters and grid, so redraws that
 * do not change the object (scrolling, other objects changing) cost a
 * resample and a hash. While a transaction is open (dragging, a dialog
 * previewing) expensive work runs at a reduced resolution, and a full
 * resolution pass follows as soon as things settle.
 */
import { multiply, invert, apply, translate } from '../../lib/matrix.js';
import { nodeBounds, visualBounds, inflate } from '../../model/geometry.js';
import { docRasterSettings } from '../effects/raster.js';
import { fromRGBA, toRGBA } from './img.js';

/** Work-image pixel budget at full quality, and the largest side. */
export const FULL_PIXELS = 4e6;
const MAX_SIDE = 4096;
/** Interactive budget per effect (milliseconds) before drafting kicks in. */
const DRAFT_MS = 45;
const CACHE_PIXELS = 16e6;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}

// ---- cache ----

const cache = new Map();
let cachedPixels = 0;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cachePut(key, value, pixels) {
  cache.set(key, { value, pixels });
  cachedPixels += pixels;
  for (const [k, v] of cache) {
    if (cachedPixels <= CACHE_PIXELS || cache.size <= 1) break;
    cache.delete(k);
    cachedPixels -= v.pixels;
  }
}

export function clearPixelCache() {
  cache.clear();
  cachedPixels = 0;
}

// ---- drafts and refinement ----

const refreshers = new Set();
let fullUntil = 0;
let refineTimer = null;
const speed = new Map();

/** Call fn when drafted results should be redrawn at full quality. Returns an unsubscribe function. */
export function onRefine(fn) {
  refreshers.add(fn);
  return () => refreshers.delete(fn);
}

function scheduleRefine() {
  if (typeof setTimeout === 'undefined') return;
  clearTimeout(refineTimer);
  refineTimer = setTimeout(() => {
    fullUntil = now() + 1500;
    for (const fn of refreshers) fn();
  }, 300);
}

/** The document's raster effects resolution in work pixels per point. */
export function docScale(doc) {
  try {
    return docRasterSettings(doc).resolution / 72;
  } catch {
    return 1;
  }
}

/** FNV-1a of RGBA bytes (as 32-bit words). */
export function hashPixels(data) {
  const n = data.length >> 2;
  const words = data.byteOffset % 4 === 0 ? new Uint32Array(data.buffer, data.byteOffset, n) : null;
  let h = 2166136261;
  if (words) for (let i = 0; i < n; i++) h = Math.imul(h ^ words[i], 16777619);
  else for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 16777619);
  return (h >>> 0).toString(36);
}

/**
 * The work grid for a layer: { k, gx0, gy0, W, H, toWork, toLayer } or
 * null. `m` maps document to device pixels, (x, y) is the layer's device
 * origin, `limit` the document rect worth processing, `k` the wanted work
 * pixels per point (reduced to stay within the pixel budget).
 */
export function planWork(layerW, layerH, m, x, y, limit, k, budget = FULL_PIXELS) {
  const L = multiply(translate(-x, -y), m);
  const Li = invert(L);
  const pts = [apply(Li, 0, 0), apply(Li, layerW, 0), apply(Li, 0, layerH), apply(Li, layerW, layerH)];
  let x0 = Math.min(...pts.map((p) => p.x));
  let y0 = Math.min(...pts.map((p) => p.y));
  let x1 = Math.max(...pts.map((p) => p.x));
  let y1 = Math.max(...pts.map((p) => p.y));
  if (limit) {
    x0 = Math.max(x0, limit.x);
    y0 = Math.max(y0, limit.y);
    x1 = Math.min(x1, limit.x + limit.w);
    y1 = Math.min(y1, limit.y + limit.h);
  }
  if (!(x1 > x0 && y1 > y0)) return null;
  const area = (x1 - x0) * (y1 - y0);
  if (area * k * k > budget) k = Math.sqrt(budget / area);
  k = Math.min(k, MAX_SIDE / (x1 - x0), MAX_SIDE / (y1 - y0));
  const gx0 = Math.floor(x0 * k);
  const gy0 = Math.floor(y0 * k);
  const W = Math.ceil(x1 * k) - gx0;
  const H = Math.ceil(y1 * k) - gy0;
  if (W < 1 || H < 1) return null;
  const Wm = [k, 0, 0, k, -gx0, -gy0];
  return { k, gx0, gy0, W, H, rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, toWork: multiply(Wm, Li), toLayer: multiply(L, invert(Wm)) };
}

const matrixOf = (t, scale) => (t ? [t.a, t.b, t.c, t.d, t.e, t.f] : [scale, 0, 0, scale, 0, 0]);

/**
 * A content effect (see registerContentEffect) that runs
 * process(img, effect, ctx) -> img in document space.
 *   key(effect)     cache key of the effect's parameters
 *   skip(effect)    true when the effect leaves the content alone
 *   costKey(effect) groups effects of similar cost (for drafting)
 * ctx: { k, ox, oy, seed, bounds (work px), docBounds, doc, node, draft }.
 */
export function pixelEffect({ key, process, skip = null, costKey = key }) {
  return (layer, e, scale, pool, info) => {
    if (skip?.(e)) return null;
    const doc = info?.doc || null;
    const node = info?.node || null;
    const m = matrixOf(info?.transform, scale);
    const vb = doc && node ? visualBounds(doc, node) : null;
    const k0 = doc ? docScale(doc) : 1;
    let plan = planWork(layer.canvas.width, layer.canvas.height, m, info?.x || 0, info?.y || 0, vb && inflate(vb, 1), k0);
    if (!plan) return null;
    const ck = costKey(e);
    let draft = false;
    const est = (speed.get(ck) || 0) * plan.W * plan.H;
    if (doc?.tx && est > DRAFT_MS && now() > fullUntil) {
      const f = Math.max(0.25, Math.sqrt(DRAFT_MS / est));
      plan = planWork(layer.canvas.width, layer.canvas.height, m, info?.x || 0, info?.y || 0, vb && inflate(vb, 1), plan.k * f) || plan;
      draft = true;
    }
    const { k, gx0, gy0, W, H } = plan;
    const work = makeCanvas(W, H);
    const wctx = work.getContext('2d');
    if (!wctx) return null;
    wctx.setTransform(...plan.toWork);
    wctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in wctx) wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(layer.canvas, 0, 0);
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    let input;
    try {
      input = wctx.getImageData(0, 0, W, H);
    } catch {
      return null;
    }
    if (!input?.data || input.data.length !== W * H * 4) return null;
    const b = doc && node ? nodeBounds(doc, node) : null;
    const id = `${key(e)}|${k}|${gx0},${gy0},${W},${H}|${b ? `${b.x},${b.y},${b.w},${b.h}` : ''}|${hashPixels(input.data)}`;
    let result = cacheGet(id)?.value;
    if (!result) {
      const t0 = now();
      const img = fromRGBA(input.data, W, H);
      const bounds = b ? { x: b.x * k - gx0, y: b.y * k - gy0, w: b.w * k, h: b.h * k } : null;
      const out = process(img, e, { k, ox: gx0, oy: gy0, seed: e.seed || 0, bounds, docBounds: b, doc, node, draft });
      toRGBA(out, input.data);
      wctx.putImageData(input, 0, 0);
      result = work;
      const ms = (now() - t0) / (W * H);
      speed.set(ck, speed.has(ck) ? speed.get(ck) * 0.5 + ms * 0.5 : ms);
      cachePut(id, result, W * H);
    }
    if (draft) scheduleRefine();
    const outLayer = pool.acquire(layer.canvas.width, layer.canvas.height);
    const o = outLayer.ctx;
    o.setTransform(...plan.toLayer);
    o.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in o) o.imageSmoothingQuality = 'high';
    o.drawImage(result, 0, 0);
    o.setTransform(1, 0, 0, 1, 0, 0);
    return outLayer;
  };
}
