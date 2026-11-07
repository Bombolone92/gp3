/**
 * Web image encoding for Save for Web: color reduction (median cut, a
 * perceptually weighted median cut, the web-safe palette, grays, black and
 * white) with Floyd-Steinberg dithering, and GIF89a and palette PNG
 * (PNG-8) writers. Full-color PNG and JPEG come from the canvas encoder.
 */
import { crc32 } from '../io/zip.js';

const WEB_LEVELS = [0, 51, 102, 153, 204, 255];

function hexRgb(hex) {
  const n = parseInt(String(hex || '#ffffff').slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Flatten RGBA pixels for an indexed image: pixels below half alpha become
 * transparent (when `transparency`), the rest are blended onto `matte`.
 * Returns { rgb: Uint8ClampedArray (3 per pixel), clear: Uint8Array (1 = transparent) }.
 */
export function flatten(rgba, { transparency = true, matte = '#ffffff' } = {}) {
  const n = rgba.length >> 2;
  const rgb = new Uint8ClampedArray(n * 3);
  const clear = new Uint8Array(n);
  const [mr, mg, mb] = hexRgb(matte);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    if (transparency && a < 128) {
      clear[i] = 1;
      continue;
    }
    const k = transparency && !matte ? 1 : a / 255;
    rgb[i * 3] = rgba[i * 4] * k + mr * (1 - k);
    rgb[i * 3 + 1] = rgba[i * 4 + 1] * k + mg * (1 - k);
    rgb[i * 3 + 2] = rgba[i * 4 + 2] * k + mb * (1 - k);
  }
  return { rgb, clear };
}

/** Median cut over a 15-bit histogram; `weights` scale the channels when choosing what to split. */
function medianCut(rgb, clear, count, weights = [1, 1, 1]) {
  const hist = new Uint32Array(32768);
  const n = clear.length;
  for (let i = 0; i < n; i++) {
    if (clear[i]) continue;
    hist[((rgb[i * 3] >> 3) << 10) | ((rgb[i * 3 + 1] >> 3) << 5) | (rgb[i * 3 + 2] >> 3)]++;
  }
  const bins = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) bins.push(k);
  if (!bins.length) return [];
  const ch = (k, c) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);
  const boxOf = (list) => {
    const lo = [31, 31, 31];
    const hi = [0, 0, 0];
    let total = 0;
    for (const k of list) {
      total += hist[k];
      for (let c = 0; c < 3; c++) {
        const v = ch(k, c);
        if (v < lo[c]) lo[c] = v;
        if (v > hi[c]) hi[c] = v;
      }
    }
    const ranges = [0, 1, 2].map((c) => (hi[c] - lo[c]) * weights[c]);
    const axis = ranges.indexOf(Math.max(...ranges));
    return { list, total, axis, score: ranges[axis] * Math.sqrt(total) };
  };
  const boxes = [boxOf(bins)];
  while (boxes.length < count) {
    let best = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].list.length > 1 && (best < 0 || boxes[i].score > boxes[best].score)) best = i;
    if (best < 0) break;
    const b = boxes[best];
    const sorted = b.list.slice().sort((p, q) => ch(p, b.axis) - ch(q, b.axis));
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += hist[sorted[i]];
      cut = i + 1;
      if (acc >= b.total / 2) break;
    }
    boxes.splice(best, 1, boxOf(sorted.slice(0, cut)), boxOf(sorted.slice(cut)));
  }
  // Each box's color is the count-weighted mean of its bins (bin centers).
  return boxes.map((b) => {
    const s = [0, 0, 0];
    for (const k of b.list) for (let c = 0; c < 3; c++) s[c] += (ch(k, c) * 8 + 4) * hist[k];
    return s.map((v) => Math.round(v / b.total));
  });
}

/** The palette for a reduction method. */
export function makePalette(rgb, clear, { colors = 256, method = 'adaptive' } = {}) {
  const max = Math.max(2, Math.min(256, Math.round(colors)));
  if (method === 'bw') return [[0, 0, 0], [255, 255, 255]];
  if (method === 'grayscale') return Array.from({ length: max }, (_, i) => Array(3).fill(Math.round((i * 255) / (max - 1))));
  if (method === 'web') {
    const all = [];
    for (const r of WEB_LEVELS) for (const g of WEB_LEVELS) for (const b of WEB_LEVELS) all.push([r, g, b]);
    if (max >= all.length) return all;
    // The most used web colors.
    const counts = new Map();
    for (let i = 0; i < clear.length; i++) {
      if (clear[i]) continue;
      const k = Math.round(rgb[i * 3] / 51) * 36 + Math.round(rgb[i * 3 + 1] / 51) * 6 + Math.round(rgb[i * 3 + 2] / 51);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => all[k]);
  }
  const unique = exactColors(rgb, clear, max);
  if (unique) return unique;
  return medianCut(rgb, clear, max, method === 'perceptual' ? [1.15, 1.5, 0.6] : [1, 1, 1]);
}

/** The exact colors when there are at most `max` of them, else null. */
function exactColors(rgb, clear, max) {
  const seen = new Map();
  for (let i = 0; i < clear.length; i++) {
    if (clear[i]) continue;
    const k = (rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2];
    if (!seen.has(k)) {
      if (seen.size >= max) return null;
      seen.set(k, [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
    }
  }
  return [...seen.values()];
}

function nearest(palette, r, g, b, cache) {
  const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - r;
    const dg = p[1] - g;
    const db = p[2] - b;
    // Weighted distance (green matters most to the eye).
    const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  cache.set(key, best);
  return best;
}

/**
 * Reduce RGBA pixels to an indexed image:
 *   { palette: [[r,g,b]], indices: Uint8Array, transparent: index or -1 }
 * options: colors, method, dither (0..1), transparency, matte.
 */
export function quantize(rgba, width, height, { colors = 256, method = 'adaptive', dither = 0, transparency = true, matte = '#ffffff' } = {}) {
  const { rgb, clear } = flatten(rgba, { transparency, matte });
  const anyClear = clear.some((v) => v);
  const room = anyClear ? Math.max(1, Math.min(255, colors - 1)) : colors;
  let palette = makePalette(rgb, clear, { colors: room, method });
  if (!palette.length) palette = [[255, 255, 255]];
  const indices = new Uint8Array(width * height);
  const cache = new Map();
  const transparent = anyClear ? palette.length : -1;
  const amount = Math.max(0, Math.min(1, dither));
  // Error diffusion buffers for the current and next row.
  let err = amount ? new Float32Array((width + 2) * 3) : null;
  let next = amount ? new Float32Array((width + 2) * 3) : null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (clear[i]) {
        indices[i] = transparent;
        continue;
      }
      let r = rgb[i * 3];
      let g = rgb[i * 3 + 1];
      let b = rgb[i * 3 + 2];
      if (err) {
        const e = (x + 1) * 3;
        r = Math.max(0, Math.min(255, r + err[e]));
        g = Math.max(0, Math.min(255, g + err[e + 1]));
        b = Math.max(0, Math.min(255, b + err[e + 2]));
      }
      const k = nearest(palette, Math.round(r), Math.round(g), Math.round(b), cache);
      indices[i] = k;
      if (err) {
        const p = palette[k];
        const er = (r - p[0]) * amount;
        const eg = (g - p[1]) * amount;
        const eb = (b - p[2]) * amount;
        const spread = (buf, xx, f) => {
          const o = (xx + 1) * 3;
          buf[o] += er * f;
          buf[o + 1] += eg * f;
          buf[o + 2] += eb * f;
        };
        if (x + 1 < width) spread(err, x + 1, 7 / 16);
        if (x > 0) spread(next, x - 1, 3 / 16);
        spread(next, x, 5 / 16);
        if (x + 1 < width) spread(next, x + 1, 1 / 16);
      }
    }
    if (err) {
      [err, next] = [next, err];
      next.fill(0);
    }
  }
  if (transparent >= 0) palette = [...palette, [0, 0, 0]];
  return { palette, indices, transparent };
}

/** RGBA pixels of an indexed image (for the optimized preview). */
export function indexedToRgba({ palette, indices, transparent }) {
  const out = new Uint8ClampedArray(indices.length * 4);
  for (let i = 0; i < indices.length; i++) {
    const k = indices[i];
    if (k === transparent) continue;
    const p = palette[k];
    out[i * 4] = p[0];
    out[i * 4 + 1] = p[1];
    out[i * 4 + 2] = p[2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ---- GIF ----

class ByteWriter {
  constructor() {
    this.buf = new Uint8Array(4096);
    this.length = 0;
  }

  byte(b) {
    if (this.length >= this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = b;
  }

  bytes(list) {
    for (const b of list) this.byte(b);
  }

  u16(v) {
    this.byte(v & 255);
    this.byte((v >> 8) & 255);
  }

  out() {
    return this.buf.slice(0, this.length);
  }
}

/** LZW-compress indices into GIF data sub-blocks. */
function lzw(w, indices, minCode) {
  const clearCode = 1 << minCode;
  const eoi = clearCode + 1;
  let codeSize = minCode + 1;
  let next = eoi + 1;
  let dict = new Map();
  let bitBuf = 0;
  let bitCount = 0;
  const block = [];
  const flush = () => {
    if (!block.length) return;
    w.byte(block.length);
    w.bytes(block);
    block.length = 0;
  };
  const emit = (code) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      block.push(bitBuf & 255);
      if (block.length === 255) flush();
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };
  emit(clearCode);
  let prefix = indices.length ? indices[0] : 0;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const code = dict.get(key);
    if (code !== undefined) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      // The decoder grows its code size one code later than the encoder adds it.
      if (next - 1 === 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clearCode);
      dict = new Map();
      codeSize = minCode + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  if (indices.length) emit(prefix);
  emit(eoi);
  if (bitCount > 0) block.push(bitBuf & 255);
  flush();
  w.byte(0);
}

/** Rows in GIF interlaced order. */
export function interlacedRows(height) {
  const rows = [];
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < height; y += step) rows.push(y);
  return rows;
}

/** GIF89a bytes for an indexed image. */
export function encodeGIF(width, height, { palette, indices, transparent = -1 }, { interlace = false } = {}) {
  const w = new ByteWriter();
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, palette.length))));
  const size = 1 << bits;
  w.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  w.u16(width);
  w.u16(height);
  w.byte(0x80 | ((bits - 1) << 4) | (bits - 1));
  w.byte(0);
  w.byte(0);
  for (let i = 0; i < size; i++) {
    const p = palette[i] || [0, 0, 0];
    w.bytes([p[0], p[1], p[2]]);
  }
  if (transparent >= 0) w.bytes([0x21, 0xf9, 0x04, 0x01, 0, 0, transparent, 0]);
  w.byte(0x2c);
  w.u16(0);
  w.u16(0);
  w.u16(width);
  w.u16(height);
  w.byte(interlace ? 0x40 : 0);
  let data = indices;
  if (interlace) {
    data = new Uint8Array(indices.length);
    interlacedRows(height).forEach((y, i) => data.set(indices.subarray(y * width, (y + 1) * width), i * width));
  }
  const minCode = Math.max(2, bits);
  w.byte(minCode);
  lzw(w, data, minCode);
  w.byte(0x3b);
  return w.out();
}

// ---- PNG-8 ----

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream: compressed when the platform can, else stored blocks (still a valid PNG). */
export async function zlib(bytes) {
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('deflate');
      const writer = cs.writable.getWriter();
      writer.write(bytes);
      writer.close();
      return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    } catch {
      // Fall through to stored blocks.
    }
  }
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const out = new Uint8Array(2 + bytes.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const part = bytes.subarray(i * 65535, Math.min(bytes.length, (i + 1) * 65535));
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = part.length & 255;
    out[o++] = part.length >> 8;
    out[o++] = ~part.length & 255;
    out[o++] = (~part.length >> 8) & 255;
    out.set(part, o);
    o += part.length;
  }
  const ad = adler32(bytes);
  out.set([ad >>> 24, (ad >> 16) & 255, (ad >> 8) & 255, ad & 255], o);
  return out;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Palette PNG bytes for an indexed image (8 bits per pixel, tRNS for the transparent index). */
export async function encodePNG8(width, height, { palette, indices, transparent = -1 }) {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 3, 0, 0, 0], 8);
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((p, i) => plte.set(p, i * 3));
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (transparent >= 0) {
    const trns = new Uint8Array(transparent + 1).fill(255);
    trns[transparent] = 0;
    parts.push(chunk('tRNS', trns));
  }
  parts.push(chunk('IDAT', await zlib(raw)), chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
