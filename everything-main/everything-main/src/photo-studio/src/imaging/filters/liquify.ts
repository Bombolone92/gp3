// Liquify: an interactive displacement field.
//
// The field stores, at nodes every `cellSize` pixels, an inverse displacement:
// output point q shows the source at q + d(q). Brush dabs rewrite d by
// composing small warps with it (so strokes accumulate without resampling the
// image repeatedly), and rendering bilinearly interpolates d between nodes. A
// 24 MP document at cell size 4 needs about 1.5 M nodes, so dabs touch only a
// few thousand values and a viewport-sized render stays interactive.
import type { IRect, Mask8, RGBA8 } from '../types';
import { rgba8 } from '../types';
import { type Interp, samplerFor } from './sampling';

export type LiquifyTool =
  'forward-warp' | 'reconstruct' | 'smooth' | 'twirl-cw' | 'twirl-ccw' | 'pucker' | 'bloat' | 'push-left';

const MAGIC = 0x4c514631; // "LQF1"

export class LiquifyField {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly dx: Float32Array;
  readonly dy: Float32Array;
  private tx = new Float32Array(0);
  private ty = new Float32Array(0);

  constructor(width: number, height: number, cellSize = 4) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.cellSize = Math.max(1, Math.round(cellSize));
    this.cols = Math.ceil(this.width / this.cellSize) + 1;
    this.rows = Math.ceil(this.height / this.cellSize) + 1;
    this.dx = new Float32Array(this.cols * this.rows);
    this.dy = new Float32Array(this.cols * this.rows);
  }

  clone(): LiquifyField {
    const f = new LiquifyField(this.width, this.height, this.cellSize);
    f.dx.set(this.dx);
    f.dy.set(this.dy);
    return f;
  }

  isIdentity(): boolean {
    for (let i = 0; i < this.dx.length; i++) if (this.dx[i] !== 0 || this.dy[i] !== 0) return false;
    return true;
  }

  // Bilinear displacement at image point (x, y) (continuous coordinates).
  displacementAt(x: number, y: number, out: Float64Array = new Float64Array(2)): Float64Array {
    const cs = this.cellSize,
      C = this.cols;
    const gx = Math.min(this.cols - 1, Math.max(0, x / cs)),
      gy = Math.min(this.rows - 1, Math.max(0, y / cs));
    const i = Math.min(this.cols - 2, Math.floor(gx)),
      j = Math.min(this.rows - 2, Math.floor(gy));
    const fx = gx - i,
      fy = gy - j,
      k = j * C + i;
    const w00 = (1 - fx) * (1 - fy),
      w10 = fx * (1 - fy),
      w01 = (1 - fx) * fy,
      w11 = fx * fy;
    out[0] = w00 * this.dx[k] + w10 * this.dx[k + 1] + w01 * this.dx[k + C] + w11 * this.dx[k + C + 1];
    out[1] = w00 * this.dy[k] + w10 * this.dy[k + 1] + w01 * this.dy[k + C] + w11 * this.dy[k + C + 1];
    return out;
  }

  // Applies one brush dab centered at (x, y) with diameter `size` (pixels).
  // (dx, dy) is the pointer movement since the previous dab (used by the warp
  // tools); pressure is 0..1, density (edge hardness) and rate are 0..100.
  // Returns the image rectangle whose rendering changed, or null.
  applyBrush(
    tool: LiquifyTool,
    x: number,
    y: number,
    dx: number,
    dy: number,
    size: number,
    pressure = 1,
    density = 50,
    rate = 80,
    freeze?: Mask8,
  ): IRect | null {
    const R = Math.max(0.5, size / 2),
      cs = this.cellSize,
      C = this.cols;
    if (tool === 'push-left') [dx, dy] = [dy, -dx];
    const push = tool === 'forward-warp' || tool === 'push-left';
    if (push && !dx && !dy) return null;
    const i0 = Math.max(0, Math.floor((x - R) / cs)),
      i1 = Math.min(this.cols - 1, Math.ceil((x + R) / cs)),
      j0 = Math.max(0, Math.floor((y - R) / cs)),
      j1 = Math.min(this.rows - 1, Math.ceil((y + R) / cs));
    if (i1 < i0 || j1 < j0) return null;
    const bw = i1 - i0 + 1,
      bh = j1 - j0 + 1;
    if (this.tx.length < bw * bh) {
      this.tx = new Float32Array(bw * bh * 2);
      this.ty = new Float32Array(bw * bh * 2);
    }
    const tx = this.tx,
      ty = this.ty,
      hard = Math.max(0, Math.min(1, density / 100)),
      r = Math.max(0, Math.min(1, rate / 100)) * Math.max(0, pressure);
    const t2 = new Float64Array(2);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * C + i,
          b = (j - j0) * bw + (i - i0),
          px = i * cs,
          py = j * cs;
        tx[b] = this.dx[k];
        ty[b] = this.dy[k];
        const dist = Math.sqrt((px - x) * (px - x) + (py - y) * (py - y)) / R;
        if (dist >= 1) continue;
        // Raised-cosine falloff blended toward a flat top by density.
        let w = (1 - hard) * 0.5 * (1 + Math.cos(Math.PI * dist)) + hard * Math.min(1, (1 - dist) * 4);
        if (freeze) {
          const fx = Math.min(freeze.width - 1, Math.max(0, Math.round(px))),
            fy = Math.min(freeze.height - 1, Math.max(0, Math.round(py)));
          w *= 1 - freeze.data[fy * freeze.width + fx] / 255;
        }
        if (w <= 0) continue;
        // Composing a warp q -> q' with the field: d'(q) = (q' + d(q')) - q.
        let qx = px,
          qy = py;
        switch (tool) {
          case 'forward-warp':
          case 'push-left':
            qx = px - w * Math.max(0, pressure) * dx;
            qy = py - w * Math.max(0, pressure) * dy;
            break;
          case 'twirl-cw':
          case 'twirl-ccw': {
            const a = (tool === 'twirl-cw' ? -1 : 1) * 0.15 * r * w,
              c = Math.cos(a),
              s = Math.sin(a),
              ox = px - x,
              oy = py - y;
            qx = x + ox * c - oy * s;
            qy = y + ox * s + oy * c;
            break;
          }
          case 'pucker':
          case 'bloat': {
            const f = 1 + (tool === 'pucker' ? 1 : -1) * 0.08 * r * w;
            qx = x + (px - x) * f;
            qy = y + (py - y) * f;
            break;
          }
          case 'reconstruct': {
            const f = 1 - Math.min(1, 0.3 * r * w);
            tx[b] = this.dx[k] * f;
            ty[b] = this.dy[k] * f;
            continue;
          }
          case 'smooth': {
            const a = this.neighbourMean(i, j, t2),
              f = Math.min(1, 0.5 * r * w);
            tx[b] = this.dx[k] + (a[0] - this.dx[k]) * f;
            ty[b] = this.dy[k] + (a[1] - this.dy[k]) * f;
            continue;
          }
        }
        this.displacementAt(qx, qy, t2);
        tx[b] = qx + t2[0] - px;
        ty[b] = qy + t2[1] - py;
      }
    for (let j = j0; j <= j1; j++) {
      const k = j * C + i0,
        b = (j - j0) * bw;
      this.dx.set(tx.subarray(b, b + bw), k);
      this.dy.set(ty.subarray(b, b + bw), k);
    }
    return this.nodeRect(i0, j0, i1, j1);
  }

  private neighbourMean(i: number, j: number, out: Float64Array) {
    let sx = 0,
      sy = 0,
      n = 0;
    for (let b = -1; b <= 1; b++)
      for (let a = -1; a <= 1; a++) {
        const ii = i + a,
          jj = j + b;
        if (ii < 0 || jj < 0 || ii >= this.cols || jj >= this.rows) continue;
        const k = jj * this.cols + ii;
        sx += this.dx[k];
        sy += this.dy[k];
        n++;
      }
    out[0] = sx / n;
    out[1] = sy / n;
    return out;
  }

  private nodeRect(i0: number, j0: number, i1: number, j1: number): IRect {
    // Rendering interpolates across one cell beyond the changed nodes.
    const cs = this.cellSize,
      x0 = Math.max(0, (i0 - 1) * cs),
      y0 = Math.max(0, (j0 - 1) * cs),
      x1 = Math.min(this.width, (i1 + 1) * cs),
      y1 = Math.min(this.height, (j1 + 1) * cs);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  // Scales displacement toward zero: amount 1 restores the original. `region`
  // limits it to a rectangle or weights it by a mask (image resolution).
  reconstruct(amount: number, region?: IRect | Mask8): void {
    const a = Math.max(0, Math.min(1, amount)),
      cs = this.cellSize,
      C = this.cols;
    if (!a) return;
    for (let j = 0; j < this.rows; j++)
      for (let i = 0; i < C; i++) {
        let w = a;
        if (region) {
          const px = i * cs,
            py = j * cs;
          if ('data' in region) {
            const mx = Math.min(region.width - 1, Math.max(0, Math.round(px))),
              my = Math.min(region.height - 1, Math.max(0, Math.round(py)));
            w *= region.data[my * region.width + mx] / 255;
          } else if (px < region.x || py < region.y || px > region.x + region.width || py > region.y + region.height)
            w = 0;
        }
        if (!w) continue;
        const k = j * C + i;
        if (w >= 1) {
          this.dx[k] = this.dy[k] = 0;
        } else {
          this.dx[k] *= 1 - w;
          this.dy[k] *= 1 - w;
        }
      }
  }

  // Renders the warped image for `outRect` (default: the whole field) from
  // `src`, which must have the field's size. Edge pixels repeat outward.
  render(src: RGBA8, outRect?: IRect, method: Interp = 'bilinear'): RGBA8 {
    const r = outRect ?? { x: 0, y: 0, width: this.width, height: this.height };
    const W = Math.max(0, r.width),
      H = Math.max(0, r.height),
      out = rgba8(W, H);
    if (!W || !H) return out;
    const sw = src.width,
      sh = src.height,
      sd = src.data,
      od = out.data;
    const s32 = new Uint32Array(sd.buffer, sd.byteOffset, sw * sh),
      o32 = new Uint32Array(od.buffer);
    const cs = this.cellSize,
      C = this.cols,
      inv = 1 / cs;
    const rowX = new Float32Array(C),
      rowY = new Float32Array(C);
    const bilinear = method === 'bilinear',
      sampler = samplerFor(method),
      px = new Float32Array(4);
    const iA = Math.max(0, Math.floor(r.x * inv) - 1),
      iB = Math.min(C - 1, Math.ceil((r.x + W) * inv) + 1);
    // Column interpolation positions are the same on every row.
    const colI = new Int32Array(W),
      colF = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const gx = Math.min(C - 1, Math.max(0, (r.x + x + 0.5) * inv)),
        i = Math.min(C - 2, Math.floor(gx));
      colI[x] = i;
      colF[x] = gx - i;
    }
    const FX = this.dx,
      FY = this.dy;
    for (let y = 0; y < H; y++) {
      const Y = r.y + y + 0.5;
      // Interpolate the two node rows once; then only a lerp along x per pixel.
      const gy = Math.min(this.rows - 1, Math.max(0, Y * inv)),
        j = Math.min(this.rows - 2, Math.floor(gy)),
        fy = gy - j,
        k0 = j * C;
      let any = false;
      for (let i = iA; i <= iB; i++) {
        const a = FX[k0 + i],
          b = FX[k0 + C + i],
          c = FY[k0 + i],
          d = FY[k0 + C + i];
        rowX[i] = a + (b - a) * fy;
        rowY[i] = c + (d - c) * fy;
        if (rowX[i] !== 0 || rowY[i] !== 0) any = true;
      }
      const yi = Math.min(sh - 1, Math.max(0, r.y + y)),
        orow = y * W;
      if (!any) {
        // Untouched rows are plain copies.
        const x0 = Math.max(0, r.x),
          x1 = Math.min(sw, r.x + W);
        if (x1 > x0) o32.set(s32.subarray(yi * sw + x0, yi * sw + x1), orow + x0 - r.x);
        continue;
      }
      for (let x = 0; x < W; x++) {
        const X = r.x + x + 0.5,
          i = colI[x],
          fx = colF[x];
        const ddx = rowX[i] + (rowX[i + 1] - rowX[i]) * fx,
          ddy = rowY[i] + (rowY[i + 1] - rowY[i]) * fx;
        if (ddx === 0 && ddy === 0) {
          const xi = r.x + x;
          if (xi >= 0 && xi < sw && r.y + y >= 0 && r.y + y < sh) o32[orow + x] = s32[yi * sw + xi];
          continue;
        }
        const o = (orow + x) * 4;
        if (!bilinear) {
          sampler(src, X + ddx, Y + ddy, 'clamp', px, 0);
          od[o] = px[0];
          od[o + 1] = px[1];
          od[o + 2] = px[2];
          od[o + 3] = px[3];
          continue;
        }
        // Inlined clamped, alpha-weighted bilinear sample.
        let sx = X + ddx - 0.5,
          sy = Y + ddy - 0.5;
        sx = sx < 0 ? 0 : sx > sw - 1 ? sw - 1 : sx;
        sy = sy < 0 ? 0 : sy > sh - 1 ? sh - 1 : sy;
        const x0 = sx | 0,
          y0 = sy | 0,
          ax = sx - x0,
          ay = sy - y0;
        const x1 = x0 + 1 < sw ? x0 + 1 : x0,
          y1 = y0 + 1 < sh ? y0 + 1 : y0;
        const p00 = (y0 * sw + x0) * 4,
          p10 = (y0 * sw + x1) * 4,
          p01 = (y1 * sw + x0) * 4,
          p11 = (y1 * sw + x1) * 4;
        const w00 = (1 - ax) * (1 - ay) * sd[p00 + 3],
          w10 = ax * (1 - ay) * sd[p10 + 3],
          w01 = (1 - ax) * ay * sd[p01 + 3],
          w11 = ax * ay * sd[p11 + 3];
        const a = w00 + w10 + w01 + w11;
        if (a <= 1e-6) {
          o32[orow + x] = 0;
          continue;
        }
        const ia = 1 / a;
        od[o] = (w00 * sd[p00] + w10 * sd[p10] + w01 * sd[p01] + w11 * sd[p11]) * ia;
        od[o + 1] = (w00 * sd[p00 + 1] + w10 * sd[p10 + 1] + w01 * sd[p01 + 1] + w11 * sd[p11 + 1]) * ia;
        od[o + 2] = (w00 * sd[p00 + 2] + w10 * sd[p10 + 2] + w01 * sd[p01 + 2] + w11 * sd[p11 + 2]) * ia;
        od[o + 3] = a;
      }
    }
    return out;
  }

  // Compact binary form: a 5-value header then dx and dy, all float32.
  serialize(): Uint8Array {
    const n = this.dx.length,
      f = new Float32Array(5 + 2 * n);
    new Uint32Array(f.buffer, 0, 1)[0] = MAGIC;
    f[1] = this.width;
    f[2] = this.height;
    f[3] = this.cellSize;
    f[4] = n;
    f.set(this.dx, 5);
    f.set(this.dy, 5 + n);
    return new Uint8Array(f.buffer);
  }

  static deserialize(bytes: Uint8Array): LiquifyField {
    const copy = new Uint8Array(bytes); // aligned private copy
    const f = new Float32Array(copy.buffer, 0, copy.byteLength >> 2);
    if (new Uint32Array(copy.buffer, 0, 1)[0] !== MAGIC) throw new Error('not a liquify field');
    const field = new LiquifyField(f[1], f[2], f[3]),
      n = f[4];
    if (n !== field.dx.length || f.length < 5 + 2 * n) throw new Error('corrupt liquify field');
    field.dx.set(f.subarray(5, 5 + n));
    field.dy.set(f.subarray(5 + n, 5 + 2 * n));
    return field;
  }
}
