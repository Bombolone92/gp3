/**
 * Gradient mesh rasterization.
 *
 * Each patch is evaluated on a grid fine enough for its size on the
 * output (about four device pixels per cell) and every cell is drawn as two
 * triangles with per-vertex colors interpolated across each pixel center.
 * The result goes into an RGBA buffer at device resolution, which the
 * renderer composites inside the mesh outline so the edge keeps the
 * canvas's anti-aliasing. A one-pixel dilation under the outline keeps
 * those anti-aliased edge pixels from fading to transparent.
 */
import { patchOf, rgba, meshBoundary, meshBounds } from './mesh-model.js';
import { tracePath } from '../../render/draw.js';
import { deviceRegion } from '../../render/effects.js';

const CELL_PX = 4;
const MAX_STEPS = 128;

function cubAt(c, o, t) {
  const mt = 1 - t;
  return mt * mt * mt * c[o] + 3 * mt * mt * t * c[o + 2] + 3 * mt * t * t * c[o + 4] + t * t * t * c[o + 6];
}

function xf(c, m) {
  const out = new Array(8);
  for (let k = 0; k < 8; k += 2) {
    out[k] = m[0] * c[k] + m[2] * c[k + 1] + m[4];
    out[k + 1] = m[1] * c[k] + m[3] * c[k + 1] + m[5];
  }
  return out;
}

function polyLen(c) {
  return Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(c[4] - c[2], c[5] - c[3]) + Math.hypot(c[6] - c[4], c[7] - c[5]);
}

/** Steps along s and t for a patch already in device space. */
export function patchSteps(top, bottom, left, right, cell = CELL_PX) {
  const ns = Math.min(MAX_STEPS, Math.max(1, Math.ceil(Math.max(polyLen(top), polyLen(bottom)) / cell)));
  const nt = Math.min(MAX_STEPS, Math.max(1, Math.ceil(Math.max(polyLen(left), polyLen(right)) / cell)));
  return { ns, nt };
}

/**
 * Draw one Gouraud-shaded triangle into an RGBA buffer (straight alpha).
 * Colors are [r, g, b, a] with channels 0..255 and alpha 0..1. Pixels whose
 * centers lie inside (edges included) are written, replacing what was there.
 */
export function shadeTriangle(buf, mask, W, H, x0, y0, c0, x1, y1, c1, x2, y2, c2) {
  let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!(Math.abs(area) > 1e-12)) return;
  if (area < 0) {
    [x1, y1, c1, x2, y2, c2] = [x2, y2, c2, x1, y1, c1];
    area = -area;
  }
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 0.5));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2) - 0.5));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 0.5));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2) - 0.5));
  if (minX > maxX || minY > maxY) return;
  const inv = 1 / area;
  // Edge functions w0 (opposite vertex 0), w1, w2 and their steps per pixel.
  const a0 = y1 - y2;
  const a1 = y2 - y0;
  const a2 = y0 - y1;
  const eps = -1e-7 * area;
  for (let py = minY; py <= maxY; py++) {
    const cy = py + 0.5;
    const sx = minX + 0.5;
    let w0 = (x2 - x1) * (cy - y1) - (y2 - y1) * (sx - x1);
    let w1 = (x0 - x2) * (cy - y2) - (y0 - y2) * (sx - x2);
    let w2 = (x1 - x0) * (cy - y0) - (y1 - y0) * (sx - x0);
    let o = py * W + minX;
    for (let px = minX; px <= maxX; px++, o++) {
      if (w0 >= eps && w1 >= eps && w2 >= eps) {
        const l0 = w0 * inv;
        const l1 = w1 * inv;
        const l2 = 1 - l0 - l1;
        const q = o * 4;
        buf[q] = l0 * c0[0] + l1 * c1[0] + l2 * c2[0];
        buf[q + 1] = l0 * c0[1] + l1 * c1[1] + l2 * c2[1];
        buf[q + 2] = l0 * c0[2] + l1 * c1[2] + l2 * c2[2];
        buf[q + 3] = (l0 * c0[3] + l1 * c1[3] + l2 * c2[3]) * 255;
        mask[o] = 1;
      }
      w0 += a0;
      w1 += a1;
      w2 += a2;
    }
  }
}

/**
 * Rasterize a mesh into a `w` x `h` buffer: `mat` maps document points to
 * buffer pixels. Returns { width, height, data, mask }.
 */
export function rasterizeMesh(mesh, mat, w, h, { cell = CELL_PX, dilate = true } = {}) {
  const W = Math.max(1, Math.ceil(w));
  const H = Math.max(1, Math.ceil(h));
  const data = new Uint8ClampedArray(W * H * 4);
  const mask = new Uint8Array(W * H);
  const cols = mesh.points.map(rgba);
  for (let i = 0; i < mesh.rows; i++) {
    for (let j = 0; j < mesh.cols; j++) {
      const p = patchOf(mesh, i, j);
      const top = xf(p.top, mat);
      const bottom = xf(p.bottom, mat);
      const left = xf(p.left, mat);
      const right = xf(p.right, mat);
      // Skip patches entirely outside the buffer.
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const c of [top, bottom, left, right]) {
        for (let k = 0; k < 8; k += 2) {
          if (c[k] < x0) x0 = c[k];
          if (c[k] > x1) x1 = c[k];
          if (c[k + 1] < y0) y0 = c[k + 1];
          if (c[k + 1] > y1) y1 = c[k + 1];
        }
      }
      if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) continue;
      const cA = cols[i * (mesh.cols + 1) + j];
      const cB = cols[i * (mesh.cols + 1) + j + 1];
      const cC = cols[(i + 1) * (mesh.cols + 1) + j + 1];
      const cD = cols[(i + 1) * (mesh.cols + 1) + j];
      const { ns, nt } = patchSteps(top, bottom, left, right, cell);
      const A = [top[0], top[1]];
      const B = [top[6], top[7]];
      const C = [bottom[6], bottom[7]];
      const D = [bottom[0], bottom[1]];
      const T = [];
      const Bo = [];
      for (let a = 0; a <= ns; a++) {
        const s = a / ns;
        T.push([cubAt(top, 0, s), cubAt(top, 1, s)]);
        Bo.push([cubAt(bottom, 0, s), cubAt(bottom, 1, s)]);
      }
      const L = [];
      const R = [];
      for (let b = 0; b <= nt; b++) {
        const t = b / nt;
        L.push([cubAt(left, 0, t), cubAt(left, 1, t)]);
        R.push([cubAt(right, 0, t), cubAt(right, 1, t)]);
      }
      // Grid of device points and colors.
      const gx = new Float64Array((ns + 1) * (nt + 1));
      const gy = new Float64Array((ns + 1) * (nt + 1));
      const gc = new Array((ns + 1) * (nt + 1));
      for (let b = 0; b <= nt; b++) {
        const t = b / nt;
        const ut = 1 - t;
        for (let a = 0; a <= ns; a++) {
          const s = a / ns;
          const us = 1 - s;
          const q = b * (ns + 1) + a;
          gx[q] = ut * T[a][0] + t * Bo[a][0] + us * L[b][0] + s * R[b][0] - (us * ut * A[0] + s * ut * B[0] + us * t * D[0] + s * t * C[0]);
          gy[q] = ut * T[a][1] + t * Bo[a][1] + us * L[b][1] + s * R[b][1] - (us * ut * A[1] + s * ut * B[1] + us * t * D[1] + s * t * C[1]);
          const w00 = us * ut;
          const w10 = s * ut;
          const w01 = us * t;
          const w11 = s * t;
          gc[q] = [
            w00 * cA[0] + w10 * cB[0] + w01 * cD[0] + w11 * cC[0],
            w00 * cA[1] + w10 * cB[1] + w01 * cD[1] + w11 * cC[1],
            w00 * cA[2] + w10 * cB[2] + w01 * cD[2] + w11 * cC[2],
            w00 * cA[3] + w10 * cB[3] + w01 * cD[3] + w11 * cC[3],
          ];
        }
      }
      for (let b = 0; b < nt; b++) {
        for (let a = 0; a < ns; a++) {
          const q00 = b * (ns + 1) + a;
          const q10 = q00 + 1;
          const q01 = q00 + ns + 1;
          const q11 = q01 + 1;
          shadeTriangle(data, mask, W, H, gx[q00], gy[q00], gc[q00], gx[q10], gy[q10], gc[q10], gx[q11], gy[q11], gc[q11]);
          shadeTriangle(data, mask, W, H, gx[q00], gy[q00], gc[q00], gx[q11], gy[q11], gc[q11], gx[q01], gy[q01], gc[q01]);
        }
      }
    }
  }
  if (dilate) dilateEdges(data, mask, W, H);
  return { width: W, height: H, data, mask };
}

/** Give uncovered pixels next to covered ones their neighbor's color (two passes). */
export function dilateEdges(data, mask, W, H, passes = 2) {
  for (let pass = 0; pass < passes; pass++) {
    const add = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = y * W + x;
        if (mask[o]) continue;
        let src = -1;
        if (x > 0 && mask[o - 1]) src = o - 1;
        else if (x < W - 1 && mask[o + 1]) src = o + 1;
        else if (y > 0 && mask[o - W]) src = o - W;
        else if (y < H - 1 && mask[o + W]) src = o + W;
        if (src >= 0) add.push(o, src);
      }
    }
    if (!add.length) return;
    for (let k = 0; k < add.length; k += 2) {
      const o = add[k];
      const s = add[k + 1];
      data.set(data.subarray(s * 4, s * 4 + 4), o * 4);
      mask[o] = 2;
    }
  }
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width: w, height: h });
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

/** A canvas holding a raster (or null where canvases are unavailable). */
export function rasterCanvas(r) {
  const canvas = makeCanvas(r.width, r.height);
  const ctx = canvas?.getContext('2d');
  if (!ctx || typeof ctx.putImageData !== 'function') return null;
  let img = null;
  try {
    img = typeof ImageData !== 'undefined' ? new ImageData(r.data, r.width, r.height) : ctx.createImageData?.(r.width, r.height);
    if (img && img.data !== r.data && img.data?.set) img.data.set(r.data);
  } catch {
    img = null;
  }
  if (!img) return null;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const boundaryCache = new WeakMap();

/** Path2D of the mesh outline (cached per node). */
export function boundaryPath(node) {
  let p = boundaryCache.get(node);
  if (!p) {
    p = tracePath(new Path2D(), meshBoundary(node), true);
    boundaryCache.set(node, p);
  }
  return p;
}

/** Path2D of every mesh line (for outline view and overlays). */
export function meshLinesPath(node, target = new Path2D()) {
  const { rows: R, cols: C } = node;
  for (let i = 0; i <= R; i++) {
    const p0 = node.points[i * (C + 1)];
    target.moveTo(p0.x, p0.y);
    for (let j = 0; j < C; j++) {
      const p = node.points[i * (C + 1) + j];
      const q = node.points[i * (C + 1) + j + 1];
      target.bezierCurveTo(p.rx, p.ry, q.lx, q.ly, q.x, q.y);
    }
  }
  for (let j = 0; j <= C; j++) {
    const p0 = node.points[j];
    target.moveTo(p0.x, p0.y);
    for (let i = 0; i < R; i++) {
      const p = node.points[i * (C + 1) + j];
      const q = node.points[(i + 1) * (C + 1) + j];
      target.bezierCurveTo(p.dx, p.dy, q.ux, q.uy, q.x, q.y);
    }
  }
  return target;
}

const drawCache = new WeakMap();

/**
 * Canvas renderer for a mesh node: rasterized at the context's device
 * resolution over the visible part, composited inside the outline. The
 * last raster per node is reused while the view and node are unchanged.
 */
export function drawMesh(ctx, doc, node, opts) {
  if (opts.outline) {
    ctx.strokeStyle = opts.outlineColor || '#000';
    ctx.lineWidth = opts.hairline;
    ctx.setLineDash([]);
    ctx.stroke(boundaryPath(node));
    return;
  }
  const b = meshBounds(node);
  const region = deviceRegion(ctx, b, 0);
  if (!region) return;
  const m = ctx.getTransform();
  const key = `${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}|${region.x},${region.y},${region.w},${region.h}`;
  let hit = drawCache.get(node);
  if (!hit || hit.key !== key) {
    const mat = [m.a, m.b, m.c, m.d, m.e - region.x, m.f - region.y];
    const r = rasterizeMesh(node, mat, region.w, region.h);
    hit = { key, canvas: rasterCanvas(r) };
    drawCache.set(node, hit);
  }
  ctx.save();
  ctx.clip(boundaryPath(node));
  if (hit.canvas) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(hit.canvas, region.x, region.y);
  } else {
    // No raster support (headless): the average color.
    ctx.fillStyle = averageColor(node);
    ctx.fill(boundaryPath(node));
  }
  ctx.restore();
}

/** The mean color of the mesh points as a CSS color. */
export function averageColor(node) {
  let r = 0;
  let g = 0;
  let bl = 0;
  let a = 0;
  for (const p of node.points) {
    const c = rgba(p);
    r += c[0];
    g += c[1];
    bl += c[2];
    a += c[3];
  }
  const n = node.points.length || 1;
  return `rgba(${Math.round(r / n)},${Math.round(g / n)},${Math.round(bl / n)},${+(a / n).toFixed(3)})`;
}

/**
 * The mesh as an image for export: { dataUrl, x, y, w, h } covering its
 * bounds at `scale` pixels per point (capped at `maxPx` per side).
 */
export function meshImage(node, scale = 4, maxPx = 4096) {
  const b = meshBounds(node);
  if (!b || b.w <= 0 || b.h <= 0) return null;
  const s = Math.min(scale, maxPx / Math.max(b.w, b.h));
  const W = Math.max(1, Math.ceil(b.w * s));
  const H = Math.max(1, Math.ceil(b.h * s));
  // Whole pixels stretched to cover the bounds exactly.
  const sx = W / b.w;
  const sy = H / b.h;
  const r = rasterizeMesh(node, [sx, 0, 0, sy, -b.x * sx, -b.y * sy], W, H);
  let url = null;
  const canvas = rasterCanvas(r);
  if (canvas && typeof canvas.toDataURL === 'function') {
    try {
      url = canvas.toDataURL('image/png');
    } catch {
      url = null;
    }
  }
  if (!url || !url.startsWith('data:image/png') || url.length < 64) url = `data:image/png;base64,${base64(encodePNG(r.data, W, H))}`;
  return { dataUrl: url, x: b.x, y: b.y, w: b.w, h: b.h, pxW: W, pxH: H };
}

// ---- a small PNG encoder (stored deflate) for environments without canvas export ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** PNG bytes for straight-alpha RGBA pixels (zlib stored blocks, no compression). */
export function encodePNG(rgbaData, W, H) {
  const raw = new Uint8Array((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    raw.set(rgbaData.subarray(y * W * 4, (y + 1) * W * 4), y * (W * 4 + 1) + 1);
  }
  const blocks = [];
  for (let o = 0; o < raw.length || o === 0; o += 65535) {
    const len = Math.min(65535, raw.length - o);
    const last = o + len >= raw.length ? 1 : 0;
    const head = new Uint8Array([last, len & 0xff, len >> 8, ~len & 0xff, (~len >> 8) & 0xff]);
    blocks.push(head, raw.subarray(o, o + len));
    if (last) break;
  }
  let a = 1;
  let b2 = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b2 = (b2 + a) % 65521;
  }
  const adler = ((b2 << 16) | a) >>> 0;
  const zlen = 2 + blocks.reduce((n, x) => n + x.length, 0) + 4;
  const z = new Uint8Array(zlen);
  z[0] = 0x78;
  z[1] = 0x01;
  let o = 2;
  for (const x of blocks) {
    z.set(x, o);
    o += x.length;
  }
  z[o] = adler >>> 24;
  z[o + 1] = (adler >>> 16) & 0xff;
  z[o + 2] = (adler >>> 8) & 0xff;
  z[o + 3] = adler & 0xff;
  const chunk = (type, body) => {
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let q = 0;
  for (const p of parts) {
    png.set(p, q);
    q += p.length;
  }
  return png;
}

function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}
