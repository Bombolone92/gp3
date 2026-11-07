/**
 * GPU batch builder: a display-list sink (see core/display.js) that packs
 * line segments and fill triangles into interleaved typed arrays ready for
 * upload.
 *
 * World coordinates are stored as float32 high and low parts
 * (hi = fround(x), lo = x - hi) so the shader can subtract the camera
 * position without losing precision far from the origin.
 *
 * Segment instance (SEG_STRIDE bytes):
 *   f32 x1h y1h x2h y2h | f32 x1l y1l x2l y2l | f32 dist0 | f32 patScale
 *   | u8 r g b a | u8 lwIndex patternRow flags 0
 * Fill vertex (TRI_STRIDE bytes):
 *   f32 xh yh xl yl | u8 r g b a
 */
import earcut from 'earcut';

export const SEG_STRIDE = 48;
export const SEG_FLOATS = SEG_STRIDE / 4;
export const TRI_STRIDE = 20;
export const TRI_FLOATS = TRI_STRIDE / 4;

/** Segment flags. */
export const F_HIGHLIGHT = 1;
export const F_SOLID = 2;

const fround = Math.fround;

export class Batch {
  /**
   * @param {(pattern: number[]) => number} patternRow maps a linetype's
   *   basePattern array to its row in the renderer's pattern texture.
   */
  constructor(patternRow, segCapacity = 1024, triCapacity = 256) {
    this.patternRow = patternRow;
    this.segBuf = new ArrayBuffer(segCapacity * SEG_STRIDE);
    this.segF = new Float32Array(this.segBuf);
    this.segU = new Uint8Array(this.segBuf);
    this.segCount = 0;
    this.triBuf = new ArrayBuffer(triCapacity * 3 * TRI_STRIDE);
    this.triF = new Float32Array(this.triBuf);
    this.triU = new Uint8Array(this.triBuf);
    this.vertCount = 0;
    this.flags = 0;
    this.alphaScale = 1;
    this.minX = Infinity;
    this.minY = Infinity;
    this.maxX = -Infinity;
    this.maxY = -Infinity;
  }

  reset() {
    this.segCount = 0;
    this.vertCount = 0;
    this.minX = this.minY = Infinity;
    this.maxX = this.maxY = -Infinity;
  }

  _growSeg(n) {
    const need = (this.segCount + n) * SEG_STRIDE;
    if (need <= this.segBuf.byteLength) return;
    let cap = this.segBuf.byteLength * 2;
    while (cap < need) cap *= 2;
    const buf = new ArrayBuffer(cap);
    new Uint8Array(buf).set(this.segU.subarray(0, this.segCount * SEG_STRIDE));
    this.segBuf = buf;
    this.segF = new Float32Array(buf);
    this.segU = new Uint8Array(buf);
  }

  _growTri(n) {
    const need = (this.vertCount + n) * TRI_STRIDE;
    if (need <= this.triBuf.byteLength) return;
    let cap = this.triBuf.byteLength * 2;
    while (cap < need) cap *= 2;
    const buf = new ArrayBuffer(cap);
    new Uint8Array(buf).set(this.triU.subarray(0, this.vertCount * TRI_STRIDE));
    this.triBuf = buf;
    this.triF = new Float32Array(buf);
    this.triU = new Uint8Array(buf);
  }

  _bound(x, y) {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  /** display-list sink: polyline */
  line(pts, closed, style) {
    const n = pts.length >> 1;
    if (n < 1) return;
    const segs = n === 1 ? 1 : closed ? n : n - 1;
    this._growSeg(segs);
    const F = this.segF,
      U = this.segU;
    const rgb = style.rgb;
    const a = Math.round(255 * (style.alpha ?? 1) * this.alphaScale);
    const lw = style.lwIndex ?? 0;
    const base = style.basePattern;
    const row = base && base.length ? this.patternRow(base) : 0;
    const patScale = style.ltscale ?? 1;
    // Dash phase only matters modulo one pattern period; keeping it small keeps it precise.
    let period = 0;
    if (row) for (const v of base) period += Math.abs(v);
    period *= patScale;
    const flags = this.flags;
    let dist = 0;
    let o = this.segCount * SEG_FLOATS;
    for (let i = 0; i < segs; i++) {
      const j = n === 1 ? 0 : (i + 1) % n;
      const x1 = pts[i * 2],
        y1 = pts[i * 2 + 1],
        x2 = pts[j * 2],
        y2 = pts[j * 2 + 1];
      const x1h = fround(x1),
        y1h = fround(y1),
        x2h = fround(x2),
        y2h = fround(y2);
      F[o] = x1h;
      F[o + 1] = y1h;
      F[o + 2] = x2h;
      F[o + 3] = y2h;
      F[o + 4] = x1 - x1h;
      F[o + 5] = y1 - y1h;
      F[o + 6] = x2 - x2h;
      F[o + 7] = y2 - y2h;
      F[o + 8] = period > 0 ? dist % period : dist;
      F[o + 9] = patScale;
      const b = (o + 10) * 4;
      U[b] = rgb[0];
      U[b + 1] = rgb[1];
      U[b + 2] = rgb[2];
      U[b + 3] = a;
      U[b + 4] = lw;
      U[b + 5] = row;
      U[b + 6] = flags;
      U[b + 7] = 0;
      dist += Math.hypot(x2 - x1, y2 - y1);
      this._bound(x1, y1);
      this._bound(x2, y2);
      o += SEG_FLOATS;
    }
    this.segCount += segs;
  }

  /** Fast path for many independent segments, flat [x1, y1, x2, y2, ...]. */
  segs(s, style) {
    const count = s.length >> 2;
    if (!count) return;
    this._growSeg(count);
    const F = this.segF,
      U = this.segU;
    const rgb = style.rgb;
    const a = Math.round(255 * (style.alpha ?? 1) * this.alphaScale);
    const lw = style.lwIndex ?? 0;
    const flags = this.flags;
    let o = this.segCount * SEG_FLOATS;
    for (let i = 0; i < s.length; i += 4) {
      const x1 = s[i],
        y1 = s[i + 1],
        x2 = s[i + 2],
        y2 = s[i + 3];
      const x1h = fround(x1),
        y1h = fround(y1),
        x2h = fround(x2),
        y2h = fround(y2);
      F[o] = x1h;
      F[o + 1] = y1h;
      F[o + 2] = x2h;
      F[o + 3] = y2h;
      F[o + 4] = x1 - x1h;
      F[o + 5] = y1 - y1h;
      F[o + 6] = x2 - x2h;
      F[o + 7] = y2 - y2h;
      F[o + 8] = 0;
      F[o + 9] = 1;
      const b = (o + 10) * 4;
      U[b] = rgb[0];
      U[b + 1] = rgb[1];
      U[b + 2] = rgb[2];
      U[b + 3] = a;
      U[b + 4] = lw;
      U[b + 5] = 0;
      U[b + 6] = flags;
      U[b + 7] = 0;
      this._bound(x1, y1);
      this._bound(x2, y2);
      o += SEG_FLOATS;
    }
    this.segCount += count;
  }

  /** display-list sink: filled polygon with holes */
  fill(rings, style) {
    if (!rings.length || rings[0].length < 6) return;
    let total = 0;
    for (const r of rings) total += r.length;
    const flat = new Float64Array(total);
    const holes = [];
    let k = 0;
    for (let i = 0; i < rings.length; i++) {
      if (i > 0) holes.push(k >> 1);
      flat.set(rings[i], k);
      k += rings[i].length;
    }
    const idx = earcut(flat, holes.length ? holes : null, 2);
    if (!idx.length) return;
    this._growTri(idx.length);
    const F = this.triF,
      U = this.triU;
    const rgb = style.rgb;
    const a = Math.round(255 * (style.alpha ?? 1) * this.alphaScale);
    let o = this.vertCount * TRI_FLOATS;
    for (let i = 0; i < idx.length; i++) {
      const x = flat[idx[i] * 2],
        y = flat[idx[i] * 2 + 1];
      const xh = fround(x),
        yh = fround(y);
      F[o] = xh;
      F[o + 1] = yh;
      F[o + 2] = x - xh;
      F[o + 3] = y - yh;
      const b = (o + 4) * 4;
      U[b] = rgb[0];
      U[b + 1] = rgb[1];
      U[b + 2] = rgb[2];
      U[b + 3] = a;
      this._bound(x, y);
      o += TRI_FLOATS;
    }
    this.vertCount += idx.length;
  }

  get bounds() {
    return this.minX === Infinity ? null : [this.minX, this.minY, this.maxX, this.maxY];
  }
}
