/**
 * Rasterizes a clip's evaluated masks into one coverage image (alpha) with
 * Canvas 2D: each mask is drawn hard-edged, feathered (blurred) and
 * optionally inverted, then composited onto the result by its mode (add,
 * subtract, intersect) at its opacity. The compositor uploads the result as
 * a texture and samples it in the clip's own draw, so the preview and the
 * export match. Results are cached per clip until the masks change.
 */
import { maskHalf, maskOutline } from './mask-shapes.js';
import { maskHasShape } from '../model/masks.js';
import { fontString } from './text.js';

/** Resolution steps for the long side of the mask image. */
const SIZES = [128, 256, 384, 512, 768, 1024, 1536, 2048];
const COMPOSITE = { add: 'source-over', subtract: 'destination-out', intersect: 'destination-in' };

const fontListeners = new Set();
const pendingFonts = new Set();
/** Called when a font used by a text mask finishes loading (redraw). */
export function onMaskFontLoaded(fn) {
  fontListeners.add(fn);
  return () => fontListeners.delete(fn);
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function fontReady(spec) {
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (!fonts?.check) return true;
  let ok = true;
  try {
    ok = fonts.check(spec);
  } catch {
    ok = true;
  }
  if (!ok && !pendingFonts.has(spec)) {
    pendingFonts.add(spec);
    fonts.load(spec).then(() => {
      pendingFonts.delete(spec);
      for (const fn of fontListeners) fn();
    }, () => pendingFonts.delete(spec));
  }
  return ok;
}

const textFont = (m, size) => fontString({ font: m.font || 'Inter', bold: m.bold, italic: false }, size);

/** Smallest size step covering the needed pixels. */
export function maskResolution(need) {
  for (const s of SIZES) if (s >= need) return s;
  return SIZES[SIZES.length - 1];
}

function hashNumbers(h, list) {
  for (let i = 0; i < list.length; i++) h = (Math.imul(h, 31) + Math.round(list[i] * 10000)) | 0;
  return h;
}

/** Cache key of what the masks look like at a resolution. */
export function maskSignature(masks, SW, SH, size) {
  let s = `${SW}x${SH}@${size}`;
  for (const m of masks) {
    if (!maskHasShape(m)) continue;
    s += `|${m.type},${m.mode},${m.x.toFixed(5)},${m.y.toFixed(5)},${m.w.toFixed(5)},${m.h.toFixed(5)},${(m.rotation || 0).toFixed(3)},${(m.feather || 0).toFixed(2)},${(m.opacity ?? 1).toFixed(3)},${m.invert ? 1 : 0}`;
    if (m.type === 'rectangle') s += `,${m.roundness || 0}`;
    if (m.type === 'star' || m.type === 'polygon') s += `,${m.count},${m.inner ?? ''}`;
    if (m.type === 'text') s += `,${m.font},${m.bold ? 1 : 0},${fontReady(textFont(m, 64)) ? 1 : 0},${m.text}`;
    if (m.type === 'pen') {
      let h = m.path.length;
      for (const p of m.path) h = hashNumbers(h, [p.x, p.y, p.ix, p.iy, p.ox, p.oy]);
      s += `,${h}`;
    }
    if (m.type === 'brush') {
      let h = m.strokes.length;
      for (const st of m.strokes) h = hashNumbers(hashNumbers(h, [st.size, st.erase ? 1 : 0, st.pts.length]), st.pts);
      s += `,${h}`;
    }
  }
  return s;
}

let filterOk = null;
function canFilter(ctx) {
  if (filterOk === null) {
    filterOk = 'filter' in ctx;
    if (filterOk) {
      ctx.filter = 'blur(2px)';
      filterOk = ctx.filter === 'blur(2px)';
      ctx.filter = 'none';
    }
  }
  return filterOk;
}

/**
 * Blur an alpha channel in place with three box passes (close to a
 * Gaussian of sigma). Used where Canvas 2D filters are missing.
 */
export function blurAlpha(alpha, w, h, sigma) {
  if (sigma < 0.5) return alpha;
  const boxW = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  const r = Math.max(1, Math.round((boxW - 1) / 2));
  const tmp = new Float32Array(alpha.length);
  const pass = (src, dst, horizontal) => {
    const outer = horizontal ? h : w;
    const inner = horizontal ? w : h;
    const stride = horizontal ? 1 : w;
    const lineStep = horizontal ? w : 1;
    const norm = 1 / (2 * r + 1);
    for (let o = 0; o < outer; o++) {
      const base = o * lineStep;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[base + Math.min(inner - 1, Math.max(0, k)) * stride];
      for (let i = 0; i < inner; i++) {
        dst[base + i * stride] = acc * norm;
        const add = Math.min(inner - 1, i + r + 1);
        const sub = Math.max(0, i - r);
        acc += src[base + add * stride] - src[base + sub * stride];
      }
    }
  };
  for (let n = 0; n < 3; n++) {
    pass(alpha, tmp, true);
    pass(tmp, alpha, false);
  }
  return alpha;
}

/** Draw one mask hard-edged in white, in source pixels scaled by k. */
function drawShape(ctx, m, SW, SH, k) {
  const { a, b } = maskHalf(m, SW, SH);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.translate((0.5 + m.x) * SW, (0.5 + m.y) * SH);
  ctx.rotate(((m.rotation || 0) * Math.PI) / 180);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  const big = 4 * Math.max(SW, SH) + Math.hypot(m.x * SW, m.y * SH) * 2;
  switch (m.type) {
    case 'split':
      ctx.fillRect(-big, 0, big * 2, big);
      break;
    case 'band':
      ctx.fillRect(-big, -b, big * 2, b * 2);
      break;
    case 'text': {
      const lines = String(m.text || '').split('\n');
      ctx.font = textFont(m, 100);
      const widest = Math.max(1, ...lines.map((l) => ctx.measureText(l || ' ').width));
      const size = Math.max(1, Math.min((2 * a * 100) / widest, (2 * b) / (lines.length * 1.1)));
      ctx.font = textFont(m, size);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lh = size * 1.1;
      lines.forEach((l, i) => ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * lh));
      break;
    }
    case 'brush': {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const unit = Math.min(2 * a, 2 * b);
      for (const s of m.strokes) {
        ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
        ctx.lineWidth = Math.max(0.5, s.size * unit);
        ctx.beginPath();
        const p = s.pts;
        if (p.length === 2) {
          ctx.arc(p[0] * 2 * a, p[1] * 2 * b, ctx.lineWidth / 2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.moveTo(p[0] * 2 * a, p[1] * 2 * b);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] * 2 * a, p[i + 1] * 2 * b);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'pen': {
      const path = m.path;
      const sx = 2 * a;
      const sy = 2 * b;
      ctx.beginPath();
      ctx.moveTo(path[0].x * sx, path[0].y * sy);
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const q = path[(i + 1) % path.length];
        if (p.ox || p.oy || q.ix || q.iy) ctx.bezierCurveTo((p.x + p.ox) * sx, (p.y + p.oy) * sy, (q.x + q.ix) * sx, (q.y + q.iy) * sy, q.x * sx, q.y * sy);
        else ctx.lineTo(q.x * sx, q.y * sy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    default: {
      const pts = maskOutline(m, SW, SH);
      if (!pts?.length) break;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Feather radius (Gaussian sigma) in source pixels. */
export function featherSigma(m, SW, SH) {
  return ((m.feather || 0) / 100) * 0.2 * Math.min(SW, SH);
}

export class MaskRaster {
  constructor() {
    this.entries = new Map(); // clip id -> { key, canvas, used }
    this.frame = 0;
    this.scratch = null;
  }

  _canvas(w, h, reuse) {
    if (reuse && reuse.width === w && reuse.height === h) return reuse;
    return makeCanvas(w, h);
  }

  /**
   * Coverage image for a clip's masks, or null when no mask has a shape (the
   * clip is drawn unmasked). need: long side of the source as shown, in
   * output pixels.
   */
  get(id, masks, SW, SH, need) {
    this.frame++;
    if (!masks?.some(maskHasShape) || !(SW > 0) || !(SH > 0)) return null;
    const size = maskResolution(need);
    const key = maskSignature(masks, SW, SH, size);
    let e = this.entries.get(id);
    if (e && e.key === key) {
      e.used = this.frame;
      return { canvas: e.canvas, key, width: e.canvas.width, height: e.canvas.height };
    }
    const k = size / Math.max(SW, SH);
    const w = Math.max(2, Math.round(SW * k));
    const h = Math.max(2, Math.round(SH * k));
    const canvas = this._canvas(w, h, e?.canvas);
    if (!canvas) return null;
    if (!this.render(canvas, masks, SW, SH, k)) return null;
    e = { key, canvas, used: this.frame };
    this.entries.set(id, e);
    this._gc();
    return { canvas, key, width: w, height: h };
  }

  render(canvas, masks, SW, SH, k) {
    const w = canvas.width;
    const h = canvas.height;
    const acc = canvas.getContext('2d');
    if (!acc) return false;
    this.scratch = this.scratch || { shape: null, cover: null };
    const shapeC = (this.scratch.shape = this._canvas(w, h, this.scratch.shape));
    const coverC = (this.scratch.cover = this._canvas(w, h, this.scratch.cover));
    const sctx = shapeC.getContext('2d');
    const cctx = coverC.getContext('2d');
    if (!sctx || !cctx) return false;
    acc.setTransform(1, 0, 0, 1, 0, 0);
    acc.globalAlpha = 1;
    acc.globalCompositeOperation = 'source-over';
    acc.clearRect(0, 0, w, h);
    const list = masks.filter(maskHasShape);
    if (list[0]?.mode === 'subtract') {
      acc.fillStyle = '#fff';
      acc.fillRect(0, 0, w, h);
    }
    list.forEach((m, i) => {
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, w, h);
      drawShape(sctx, m, SW, SH, k);
      const sigma = featherSigma(m, SW, SH) * k;
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.globalCompositeOperation = 'source-over';
      cctx.globalAlpha = 1;
      cctx.clearRect(0, 0, w, h);
      if (sigma >= 0.5 && !canFilter(cctx)) {
        // No canvas filters: blur the alpha by hand.
        const img = sctx.getImageData(0, 0, w, h);
        const alpha = new Float32Array(w * h);
        for (let p = 0; p < alpha.length; p++) alpha[p] = img.data[p * 4 + 3];
        blurAlpha(alpha, w, h, sigma);
        for (let p = 0; p < alpha.length; p++) {
          const v = m.invert ? 255 - alpha[p] : alpha[p];
          img.data[p * 4] = img.data[p * 4 + 1] = img.data[p * 4 + 2] = 255;
          img.data[p * 4 + 3] = v;
        }
        cctx.putImageData(img, 0, 0);
      } else {
        if (m.invert) {
          cctx.fillStyle = '#fff';
          cctx.fillRect(0, 0, w, h);
          cctx.globalCompositeOperation = 'destination-out';
        }
        if (sigma >= 0.5) cctx.filter = `blur(${sigma.toFixed(2)}px)`;
        cctx.drawImage(shapeC, 0, 0);
        if (sigma >= 0.5) cctx.filter = 'none';
        cctx.globalCompositeOperation = 'source-over';
      }
      const mode = i === 0 && m.mode !== 'subtract' ? 'add' : m.mode;
      acc.globalAlpha = Math.max(0, Math.min(1, m.opacity ?? 1));
      acc.globalCompositeOperation = COMPOSITE[mode] || 'source-over';
      acc.drawImage(coverC, 0, 0);
    });
    acc.globalAlpha = 1;
    acc.globalCompositeOperation = 'source-over';
    return true;
  }

  _gc() {
    if (this.entries.size < 24) return;
    for (const [id, e] of this.entries) if (this.frame - e.used > 600) this.entries.delete(id);
  }

  dispose() {
    this.entries.clear();
    this.scratch = null;
  }
}
