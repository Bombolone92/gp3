import type { IRect, Mask8, RGBA8 } from '../types';

// A pattern is a seamlessly repeating RGBA tile.
export type Pattern = { id: string; name: string; tile: RGBA8 };
export type PatternTransform = {
  // Tile size multiplier (1 = one tile pixel per document pixel).
  scale?: number;
  // Rotation in degrees, counterclockwise on screen.
  angle?: number;
  // Where the tile origin sits, in output pixels.
  offset?: { x: number; y: number };
};

const mod = (a: number, n: number) => ((a % n) + n) % n;

// Bilinear sample with wrap-around, interpolated on premultiplied values so
// transparent texels do not bleed their (meaningless) color. u, v in tile
// pixels with texel centers at +0.5.
export function samplePattern(tile: RGBA8, u: number, v: number, out: number[]) {
  const { width: w, height: h, data: d } = tile;
  const x = u - 0.5, y = v - 0.5;
  const fx = Math.floor(x), fy = Math.floor(y);
  const tx = x - fx, ty = y - fy;
  const x0 = mod(fx, w), y0 = mod(fy, h);
  const x1 = x0 + 1 === w ? 0 : x0 + 1, y1 = y0 + 1 === h ? 0 : y0 + 1;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  const w00 = (1 - tx) * (1 - ty) * d[i00 + 3], w10 = tx * (1 - ty) * d[i10 + 3];
  const w01 = (1 - tx) * ty * d[i01 + 3], w11 = tx * ty * d[i11 + 3];
  const a = w00 + w10 + w01 + w11;
  if (a <= 0) {
    out[0] = out[1] = out[2] = out[3] = 0;
    return out;
  }
  for (let c = 0; c < 3; c++) out[c] = (d[i00 + c] * w00 + d[i10 + c] * w10 + d[i01 + c] * w01 + d[i11 + c] * w11) / a;
  out[3] = a / 255;
  return out;
}

// Calls `fn(x, y, r, g, b, a)` for each output pixel of `rect`, with the
// pattern color under it. Identity transforms copy texels exactly.
function forEachPatternPixel(
  rect: IRect,
  pattern: Pattern,
  t: PatternTransform,
  fn: (x: number, y: number, r: number, g: number, b: number, a: number) => void,
) {
  const tile = pattern.tile;
  const scale = Math.max(1e-3, t.scale ?? 1);
  const angle = ((t.angle ?? 0) * Math.PI) / 180;
  const ox = t.offset?.x ?? 0, oy = t.offset?.y ?? 0;
  const tw = tile.width, th = tile.height, td = tile.data;
  if (scale === 1 && angle === 0 && Number.isInteger(ox) && Number.isInteger(oy)) {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      const row = mod(y - oy, th) * tw;
      let u = mod(rect.x - ox, tw);
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const i = (row + u) * 4;
        fn(x, y, td[i], td[i + 1], td[i + 2], td[i + 3]);
        if (++u === tw) u = 0;
      }
    }
    return;
  }
  // Screen y points down, so a counterclockwise rotation by `angle` maps the
  // output offset back into tile space with the transposed matrix below.
  const c = Math.cos(angle) / scale, s = Math.sin(angle) / scale;
  const px = [0, 0, 0, 0];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    const dy = y + 0.5 - oy;
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      const dx = x + 0.5 - ox;
      samplePattern(tile, c * dx - s * dy, s * dx + c * dy, px);
      fn(x, y, px[0], px[1], px[2], px[3] * 255);
    }
  }
}

// Renders the repeating pattern into a new w x h image. `origin` is the
// document position of the output's top-left pixel.
export function renderPattern(
  w: number,
  h: number,
  pattern: Pattern,
  t: PatternTransform = {},
  origin = { x: 0, y: 0 },
): RGBA8 {
  const data = new Uint8ClampedArray(w * h * 4);
  forEachPatternPixel({ x: origin.x, y: origin.y, width: w, height: h }, pattern, t, (x, y, r, g, b, a) => {
    const i = ((y - origin.y) * w + (x - origin.x)) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  });
  return { width: w, height: h, data };
}

// Fills `dst` in place with the pattern (source-over), limited to `rect` and
// weighted by `mask` coverage (same size as dst) and `opacity`. With
// `replace`, pattern pixels overwrite instead of compositing.
export function fillPatternRGBA8(
  dst: RGBA8,
  pattern: Pattern,
  opts: PatternTransform & { rect?: IRect; mask?: Mask8; opacity?: number; replace?: boolean } = {},
): RGBA8 {
  const r = opts.rect ?? { x: 0, y: 0, width: dst.width, height: dst.height };
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
  const rect = { x: x0, y: y0, width: Math.min(dst.width, r.x + r.width) - x0, height: Math.min(dst.height, r.y + r.height) - y0 };
  if (rect.width <= 0 || rect.height <= 0) return dst;
  const d = dst.data, m = opts.mask?.data, op = opts.opacity ?? 1, replace = !!opts.replace;
  forEachPatternPixel(rect, pattern, opts, (x, y, pr, pg, pb, pa) => {
    const p = y * dst.width + x, i = p * 4;
    const cov = (m ? m[p] / 255 : 1) * op;
    if (cov <= 0) return;
    if (replace) {
      // Coverage blends toward the pattern pixel (a lerp, including alpha).
      d[i] += (pr - d[i]) * cov;
      d[i + 1] += (pg - d[i + 1]) * cov;
      d[i + 2] += (pb - d[i + 2]) * cov;
      d[i + 3] += (pa - d[i + 3]) * cov;
      return;
    }
    const as = (pa / 255) * cov, ab = d[i + 3] / 255;
    const ao = as + ab * (1 - as);
    if (ao <= 0) return;
    const ws = as / ao, wb = (ab * (1 - as)) / ao;
    d[i] = pr * ws + d[i] * wb;
    d[i + 1] = pg * ws + d[i + 1] * wb;
    d[i + 2] = pb * ws + d[i + 2] * wb;
    d[i + 3] = ao * 255;
  });
  return dst;
}
