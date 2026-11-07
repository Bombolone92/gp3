import { checkCancelled, type IRect, type Progress, type RGBA8 } from '../types';
import { M, blendColor, blendModeIndex, hash01, isSeparable, type BlendMode } from '../blend/modes';
import { compositeRGBA8, separableLut } from '../blend/composite';
import { gradientRamp, renderGradientInto, RAMP_SIZE, type Gradient } from '../gradient/gradient';
import { renderPattern, type Pattern } from '../pattern/pattern';
import { gaussianBlur, sigmaForExtent } from './blur';
import { CONTOUR_LUT_SIZE, contourLut, isLinearContour, type Contour } from './contour';
import { signedDistance } from './distance';
import { gradientGeometryPoints, styleBoundsExpansion, type Expansion } from './bounds';

export { gradientGeometryPoints, styleBoundsExpansion, type Expansion };
import type {
  BevelFx,
  GlowFx,
  GradientGeometry,
  LayerStyle,
  PatternPlacement,
  RGB,
  ShadowFx,
  StrokeFx,
} from './types';

export type LayerStyleOptions = {
  // Fill opacity scales the layer's own pixels, not its effects.
  fillOpacity: number;
  // Fill opacity also fades the interior effects (satin, overlays, inner
  // glow and inner shadows), which then blend as one group with the content.
  interiorAsGroup?: boolean;
  patterns: (id: string) => Pattern | undefined;
  // Render scale (preview zoom); multiplies every pixel-sized parameter.
  scale?: number;
  // Resolve 'foreground'/'background' gradient stops.
  foreground?: RGB;
  background?: RGB;
  // Also return each below/above effect as its own image with its blend
  // mode, so a compositor can blend them against the real backdrop.
  separatePasses?: boolean;
  // When `layer` is a crop of the document: the document position of its
  // top-left pixel and the document size, so document-anchored gradients and
  // patterns line up with the full canvas. Default: the buffer is the document.
  origin?: { x: number; y: number };
  documentSize?: { width: number; height: number };
  progress?: Progress;
};
export type StylePass = { stage: 'below' | 'above'; effect: string; mode: BlendMode; image: RGBA8 };
export type LayerStyleResult = {
  // Effects under the layer (drop shadows, outer glow), already blended
  // among themselves.
  below: RGBA8 | null;
  // Layer pixels with fill opacity, interior effects and inside strokes.
  layer: RGBA8;
  // Effects over the layer (outer parts of bevels, outside strokes).
  above: RGBA8 | null;
  // Document rectangle all three images cover (they share its size).
  bounds: IRect;
  passes?: StylePass[];
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const rad = (deg: number) => (deg * Math.PI) / 180;
const on = <T extends { enabled: boolean }>(fx: T | undefined): fx is T => !!fx && fx.enabled;
const list = <T extends { enabled: boolean }>(fx: T[] | undefined): T[] => (fx ?? []).filter((f) => f.enabled);

export function alphaBounds(img: RGBA8): IRect | null {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    let i = y * w * 4 + 3;
    for (let x = 0; x < w; x++, i += 4)
      if (data[i]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

// Rendering state. "work" is the content rectangle grown by the effect reach
// (it may extend past the document, where the layer is transparent); output
// images cover "bounds" = work clipped to the document.
type Ctx = {
  style: LayerStyle;
  opts: LayerStyleOptions;
  k: number;
  wx: number; wy: number; ww: number; wh: number;
  bx: number; by: number; bw: number; bh: number;
  docW: number; docH: number;
  content: IRect;
  alpha: Float32Array;
  sd?: Float32Array;
  sdSides?: { inside: boolean; outside: boolean };
  passes?: StylePass[];
};
type ColorSource = RGB | RGBA8;
const enum Clip { None, Inside, Outside }

// Signed distance computed lazily for the sides an effect reads (each side
// is a full distance transform); requesting a new side recomputes both.
function sdOf(c: Ctx, need: 'inside' | 'outside' | 'both'): Float32Array {
  const want = { inside: need !== 'outside', outside: need !== 'inside' };
  const have = c.sdSides;
  if (c.sd && have && (!want.inside || have.inside) && (!want.outside || have.outside)) return c.sd;
  const sides = { inside: want.inside || !!have?.inside, outside: want.outside || !!have?.outside };
  c.sdSides = sides;
  return (c.sd = signedDistance(c.alpha, c.ww, c.wh, sides));
}
const angleOf = (c: Ctx, fx: { angle: number; useGlobalLight: boolean }) =>
  rad(fx.useGlobalLight ? (c.style.globalAngle ?? 120) : fx.angle);

// Composites an effect into a bounds-sized state image. `strength` is
// per-work-pixel coverage (opacity included) or a constant; an image color
// source multiplies it by its own alpha. Inside clipping composites within
// the layer shape, renormalized by its coverage (the state's alpha divided
// by the shape alpha), so effects never widen the shape's soft edges and a
// zero fill still shows effects at full strength.
function compositeInto(c: Ctx, target: RGBA8, strength: Float32Array | number, src: ColorSource, mode: BlendMode | number, clip: Clip, seed = 0) {
  const m = blendModeIndex(mode);
  const sep = isSeparable(m) && m !== M.normal && m !== M.dissolve;
  const lut = sep ? separableLut(m) : undefined;
  const nonSep = !sep && m !== M.normal && m !== M.dissolve;
  const img = Array.isArray(src) ? undefined : (src as RGBA8).data;
  const sr = img ? 0 : (src as RGB)[0], sg = img ? 0 : (src as RGB)[1], sb = img ? 0 : (src as RGB)[2];
  const t = target.data, alpha = c.alpha;
  const constant = typeof strength === 'number' ? strength : -1;
  const sArr = typeof strength === 'number' ? undefined : strength;
  const bc = [0, 0, 0], scol = [0, 0, 0], out = [0, 0, 0];
  for (let j = 0; j < c.bh; j++) {
    let wi = (c.by + j - c.wy) * c.ww + (c.bx - c.wx);
    let ti = j * c.bw * 4;
    for (let i = 0; i < c.bw; i++, wi++, ti += 4) {
      let e = sArr ? sArr[wi] : constant;
      let er = sr, eg = sg, eb = sb;
      if (img) {
        e *= img[ti + 3] / 255;
        er = img[ti]; eg = img[ti + 1]; eb = img[ti + 2];
      }
      const sa = alpha[wi];
      if (clip === Clip.Outside) e *= 1 - sa;
      if (e <= 0.0005) continue;
      if (e > 1) e = 1;
      if (m === M.dissolve) {
        if (hash01(c.bx + i, c.by + j, seed) >= e) continue;
        e = 1;
      }
      let a: number;
      if (clip === Clip.Inside) {
        if (sa <= 0) continue;
        a = t[ti + 3] / 255 / sa;
        if (a > 1) a = 1;
      } else a = t[ti + 3] / 255;
      const ao = e + a * (1 - e);
      const ws = e / ao, wb = (a * (1 - e)) / ao;
      if (a === 0 || (!lut && !nonSep)) {
        t[ti] = er * ws + t[ti] * wb;
        t[ti + 1] = eg * ws + t[ti + 1] * wb;
        t[ti + 2] = eb * ws + t[ti + 2] * wb;
      } else if (lut) {
        const ka = 1 - a;
        const r0 = t[ti], g0 = t[ti + 1], b0 = t[ti + 2];
        t[ti] = (ka * er + a * lut[(r0 << 8) | Math.round(er)]) * ws + r0 * wb;
        t[ti + 1] = (ka * eg + a * lut[(g0 << 8) | Math.round(eg)]) * ws + g0 * wb;
        t[ti + 2] = (ka * eb + a * lut[(b0 << 8) | Math.round(eb)]) * ws + b0 * wb;
      } else {
        bc[0] = t[ti] / 255; bc[1] = t[ti + 1] / 255; bc[2] = t[ti + 2] / 255;
        scol[0] = er / 255; scol[1] = eg / 255; scol[2] = eb / 255;
        blendColor(m, bc, scol, out);
        const ka = 1 - a;
        for (let q = 0; q < 3; q++) t[ti + q] = ((ka * scol[q] + a * out[q]) * ws + bc[q] * wb) * 255;
      }
      t[ti + 3] = (clip === Clip.Inside ? ao * sa : ao) * 255;
    }
  }
}
// Composites into a stage image and, when requested, into its own pass.
function emit(c: Ctx, stage: 'below' | 'above', effect: string, target: RGBA8, strength: Float32Array | number, src: ColorSource, mode: BlendMode, clip: Clip, seed = 0) {
  compositeInto(c, target, strength, src, mode, clip, seed);
  if (c.passes) {
    const image: RGBA8 = { width: c.bw, height: c.bh, data: new Uint8ClampedArray(c.bw * c.bh * 4) };
    compositeInto(c, image, strength, src, 'normal', clip, seed);
    c.passes.push({ stage, effect, mode, image });
  }
}

// Shape grown by r as coverage (complement grown, i.e. shape shrunk, when
// inverted). r = 0 returns the exact alpha so anti-aliasing is preserved.
function grownMatte(c: Ctx, r: number, invert: boolean): Float32Array {
  const n = c.ww * c.wh, out = new Float32Array(n), a = c.alpha;
  if (r <= 0) {
    if (invert) for (let i = 0; i < n; i++) out[i] = 1 - a[i];
    else out.set(a);
    return out;
  }
  const sd = sdOf(c, invert ? 'inside' : 'outside'), r5 = r + 0.5;
  if (invert) for (let i = 0; i < n; i++) out[i] = clamp01(r5 + sd[i]);
  else for (let i = 0; i < n; i++) out[i] = clamp01(r5 - sd[i]);
  return out;
}
// out(x, y) = src(x - dx, y - dy), `outside` beyond the buffer.
function shifted(src: Float32Array, w: number, h: number, dx: number, dy: number, outside: number): Float32Array {
  if (dx === 0 && dy === 0) return src;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y - dy, row = y * w;
    if (sy < 0 || sy >= h) {
      out.fill(outside, row, row + w);
      continue;
    }
    const srow = sy * w;
    const x0 = Math.max(0, dx), x1 = Math.min(w, w + dx);
    if (x0 > 0) out.fill(outside, row, row + Math.min(w, x0));
    if (x1 < w) out.fill(outside, row + Math.max(0, x1), row + w);
    if (x1 > x0) out.set(src.subarray(srow + x0 - dx, srow + x1 - dx), row + x0);
  }
  return out;
}
function applyLut(buf: Float32Array, contour: Contour | undefined, aa: boolean | undefined) {
  if (isLinearContour(contour) && !aa) return;
  const lut = contourLut(contour, !!aa), n1 = CONTOUR_LUT_SIZE - 1;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i] <= 0 ? 0 : buf[i] >= 1 ? n1 : buf[i] * n1;
    const i0 = v | 0;
    buf[i] = i0 < n1 ? lut[i0] + (lut[i0 + 1] - lut[i0]) * (v - i0) : lut[n1];
  }
}
// Mean-preserving grain on coverage, keyed to document coordinates.
function applyNoise(c: Ctx, buf: Float32Array, noise: number | undefined, seed: number) {
  if (!noise) return;
  for (let y = 0; y < c.wh; y++)
    for (let x = 0, i = y * c.ww; x < c.ww; x++, i++)
      if (buf[i] > 0) buf[i] = clamp01(buf[i] * (1 + noise * (2 * hash01(c.wx + x, c.wy + y, seed) - 1)));
}
function scaleBy(buf: Float32Array, k: number) {
  if (k !== 1) for (let i = 0; i < buf.length; i++) buf[i] *= k;
}

function shadow(c: Ctx, fx: ShadowFx, inner: boolean, target: RGBA8, seed: number) {
  const size = Math.max(0, fx.size * c.k), r = size * clamp01(fx.spread), blur = size - r;
  const a = angleOf(c, fx), d = fx.distance * c.k;
  const dx = Math.round(-Math.cos(a) * d), dy = Math.round(Math.sin(a) * d);
  const outside = inner ? 1 : 0;
  let m = grownMatte(c, r, inner);
  if (blur > 0) gaussianBlur(m, c.ww, c.wh, sigmaForExtent(blur), outside);
  m = shifted(m, c.ww, c.wh, dx, dy, outside);
  applyLut(m, fx.contour, fx.antiAliased);
  applyNoise(c, m, fx.noise, seed);
  scaleBy(m, clamp01(fx.opacity));
  if (inner) {
    emitLayer(c, target, m, fx.color, fx.blendMode);
  } else {
    if (fx.knockout !== false) for (let i = 0; i < m.length; i++) m[i] *= 1 - c.alpha[i];
    emit(c, 'below', 'drop-shadow', target, m, fx.color, fx.blendMode, Clip.None, seed);
  }
}
const emitLayer = (c: Ctx, target: RGBA8, strength: Float32Array | number, src: ColorSource, mode: BlendMode, seed = 0) =>
  compositeInto(c, target, strength, src, mode, Clip.Inside, seed);

// Range reshapes the falloff before the contour: v^gamma with gamma chosen
// so range 0.5 is the identity.
function rangeGamma(range: number) {
  const r = Math.min(0.99, Math.max(0.01, range));
  return Math.log(0.5) / Math.log(r);
}
function glowFalloff(c: Ctx, fx: GlowFx, inner: boolean): Float32Array {
  const size = Math.max(0.5, fx.size * c.k), r = size * clamp01(fx.spread);
  let v: Float32Array;
  if (fx.technique === 'precise') {
    const sd = sdOf(c, inner ? 'inside' : 'outside'), span = Math.max(1e-3, size - r);
    v = new Float32Array(sd.length);
    for (let i = 0; i < v.length; i++) {
      const dist = inner ? -sd[i] : sd[i];
      v[i] = dist <= r ? 1 : clamp01(1 - (dist - r) / span);
    }
  } else {
    // A blurred matte is one half at the edge; doubling it puts full glow
    // at the edge and lets it fade to zero `size` pixels away.
    v = grownMatte(c, r, inner);
    if (size - r > 0) gaussianBlur(v, c.ww, c.wh, sigmaForExtent(size - r), inner ? 1 : 0);
    for (let i = 0; i < v.length; i++) v[i] = clamp01(2 * v[i]);
  }
  if (inner && fx.source === 'center') for (let i = 0; i < v.length; i++) v[i] = 1 - v[i];
  const g = rangeGamma(fx.range);
  if (Math.abs(g - 1) > 1e-6) for (let i = 0; i < v.length; i++) v[i] = Math.pow(v[i], g);
  return v;
}
function glow(c: Ctx, fx: GlowFx, inner: boolean, target: RGBA8, seed: number) {
  const v = glowFalloff(c, fx, inner);
  const strength = Float32Array.from(v);
  applyLut(strength, fx.contour, fx.antiAliased);
  applyNoise(c, strength, fx.noise, seed);
  scaleBy(strength, clamp01(fx.opacity));
  let src: ColorSource;
  if (fx.fill.type === 'color') src = fx.fill.color;
  else {
    // Gradient position: 0 at the edge (or center) running outward.
    const ramp = gradientRamp(fx.fill.gradient, { foreground: c.opts.foreground, background: c.opts.background, reverse: fx.fill.reverse });
    const img: RGBA8 = { width: c.bw, height: c.bh, data: new Uint8ClampedArray(c.bw * c.bh * 4) };
    const jitter = clamp01(fx.jitter), n1 = RAMP_SIZE - 1;
    for (let j = 0; j < c.bh; j++) {
      let wi = (c.by + j - c.wy) * c.ww + (c.bx - c.wx);
      for (let i = 0, ti = j * c.bw * 4; i < c.bw; i++, wi++, ti += 4) {
        let t = 1 - v[wi];
        if (jitter) t += jitter * (hash01(c.bx + i, c.by + j, seed + 7) - 0.5);
        const q = Math.round(clamp01(t) * n1) * 4;
        img.data[ti] = ramp[q]; img.data[ti + 1] = ramp[q + 1]; img.data[ti + 2] = ramp[q + 2]; img.data[ti + 3] = ramp[q + 3];
      }
    }
    src = img;
  }
  if (inner) emitLayer(c, target, strength, src, fx.blendMode, seed);
  else emit(c, 'below', 'outer-glow', target, strength, src, fx.blendMode, Clip.Outside, seed);
}

function satin(c: Ctx, target: RGBA8) {
  const fx = c.style.satin!;
  const b = Float32Array.from(c.alpha);
  gaussianBlur(b, c.ww, c.wh, sigmaForExtent(Math.max(0, fx.size * c.k)), 0);
  const a = rad(fx.angle), d = fx.distance * c.k;
  const dx = Math.round(Math.cos(a) * d), dy = Math.round(-Math.sin(a) * d);
  const p = shifted(b, c.ww, c.wh, dx, dy, 0), q = shifted(b, c.ww, c.wh, -dx, -dy, 0);
  const v = new Float32Array(b.length);
  for (let i = 0; i < v.length; i++) v[i] = Math.abs(p[i] - q[i]);
  applyLut(v, fx.contour, fx.antiAliased);
  if (fx.invert) for (let i = 0; i < v.length; i++) v[i] = 1 - v[i];
  scaleBy(v, clamp01(fx.opacity));
  emitLayer(c, target, v, fx.color, fx.blendMode);
}

function referenceRect(c: Ctx, align: boolean | undefined): IRect {
  const o = c.opts.origin;
  return align === false ? { x: -(o?.x ?? 0), y: -(o?.y ?? 0), width: c.docW, height: c.docH } : c.content;
}
// Renders a gradient across the reference rectangle into a bounds image.
function gradientImage(c: Ctx, gradient: Gradient, g: GradientGeometry): RGBA8 {
  const { start, end } = gradientGeometryPoints(referenceRect(c, g.alignWithLayer), g);
  const img: RGBA8 = { width: c.bw, height: c.bh, data: new Uint8ClampedArray(c.bw * c.bh * 4) };
  renderGradientInto(img, gradient, {
    type: g.style, start, end, reverse: g.reverse, dither: g.dither, method: g.method,
    foreground: c.opts.foreground, background: c.opts.background,
  }, { x: c.bx, y: c.by });
  return img;
}
function patternImage(c: Ctx, p: PatternPlacement, w = c.bw, h = c.bh, ox = c.bx, oy = c.by): RGBA8 | null {
  const pattern = c.opts.patterns(p.patternId);
  if (!pattern) return null;
  const o = c.opts.origin;
  const origin = p.linkWithLayer ? { x: c.content.x, y: c.content.y } : { x: -(o?.x ?? 0), y: -(o?.y ?? 0) };
  return renderPattern(w, h, pattern, {
    scale: Math.max(0.01, p.scale * c.k), angle: p.angle ?? 0,
    offset: { x: origin.x + (p.offset?.x ?? 0), y: origin.y + (p.offset?.y ?? 0) },
  }, { x: ox, y: oy });
}

function bevel(c: Ctx, fx: BevelFx, layerState: RGBA8, aboveState: RGBA8, strokeCov: Float32Array | null) {
  const n = c.ww * c.wh, S = Math.max(1, fx.size * c.k);
  const style = fx.style;
  if (style === 'stroke-emboss' && !strokeCov) return;
  const src = style === 'stroke-emboss' ? strokeCov! : c.alpha;
  const h = new Float32Array(n);
  if (fx.technique === 'smooth' || style === 'stroke-emboss') {
    h.set(src);
    gaussianBlur(h, c.ww, c.wh, sigmaForExtent(S), 0);
    for (let i = 0; i < n; i++) {
      const b = h[i];
      h[i] = style === 'inner-bevel' ? clamp01(2 * b - 1)
        : style === 'outer-bevel' ? clamp01(2 * b)
        : style === 'pillow-emboss' ? Math.abs(2 * b - 1) - 1
        : b;
    }
  } else {
    const sd = sdOf(c, style === 'inner-bevel' ? 'inside' : style === 'outer-bevel' ? 'outside' : 'both');
    for (let i = 0; i < n; i++) {
      const s = sd[i];
      h[i] = style === 'inner-bevel' ? clamp01(-s / S)
        : style === 'outer-bevel' ? clamp01(1 - s / S)
        : style === 'pillow-emboss' ? clamp01(Math.abs(s) / S) - 1
        : clamp01(0.5 - s / (2 * S));
    }
    if (fx.technique === 'chisel-soft') gaussianBlur(h, c.ww, c.wh, Math.max(0.6, S / 12), 0);
  }
  if (fx.contour) {
    const lut = contourLut(fx.contour.contour, !!fx.contour.antiAliased), n1 = CONTOUR_LUT_SIZE - 1;
    const g = rangeGamma(fx.contour.range), pillow = style === 'pillow-emboss';
    for (let i = 0; i < n; i++) {
      const x = Math.pow(clamp01(pillow ? h[i] + 1 : h[i]), g);
      const y = lut[Math.round(x * n1)];
      h[i] = pillow ? y - 1 : y;
    }
  }
  // Height in pixels: depth 1 gives a 45 degree slope across the bevel.
  const scale = S * fx.depth * (fx.direction === 'down' ? -1 : 1);
  for (let i = 0; i < n; i++) h[i] *= scale;
  if (fx.texture) {
    const t = fx.texture;
    const tex = patternImage(c, t, c.ww, c.wh, c.wx, c.wy);
    if (tex) {
      const amp = 2 * t.depth * (t.invert ? -1 : 1), td = tex.data;
      for (let i = 0; i < n; i++) {
        const lum = (0.299 * td[i * 4] + 0.587 * td[i * 4 + 1] + 0.114 * td[i * 4 + 2]) / 255;
        h[i] += (lum - 0.5) * (td[i * 4 + 3] / 255) * amp * c.alpha[i];
      }
    }
  }
  if (fx.soften > 0) gaussianBlur(h, c.ww, c.wh, (fx.soften * c.k) / 2, 0);

  const az = angleOf(c, fx);
  const alt = rad(fx.useGlobalLight ? (c.style.globalAltitude ?? 30) : fx.altitude);
  const lx = Math.cos(alt) * Math.cos(az), ly = Math.cos(alt) * Math.sin(az), lz = Math.sin(alt);
  const gloss = isLinearContour(fx.glossContour) && !fx.glossAntiAliased ? null : contourLut(fx.glossContour, !!fx.glossAntiAliased);
  const n1 = CONTOUR_LUT_SIZE - 1;
  const gmap = (v: number) => (gloss ? gloss[Math.round(clamp01(v) * n1)] : v);
  const gf = gmap((lz + 1) / 2);
  const hi = new Float32Array(n), sh = new Float32Array(n);
  const hiOp = clamp01(fx.highlightOpacity), shOp = clamp01(fx.shadowOpacity);
  const w = c.ww, hh = c.wh;
  for (let y = 0; y < hh; y++) {
    const up = y > 0 ? -w : 0, dn = y < hh - 1 ? w : 0;
    const sy = (up && dn) ? 0.5 : 1;
    for (let x = 0, i = y * w; x < w; x++, i++) {
      const l = x > 0 ? i - 1 : i, r = x < w - 1 ? i + 1 : i;
      const gx = (h[r] - h[l]) * (l !== i && r !== i ? 0.5 : 1);
      const gy = (h[i + dn] - h[i + up]) * sy;
      if (gx === 0 && gy === 0) continue;
      // Screen y points down, so the y-up normal is (-gx, gy, 1).
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const s01 = ((-gx * lx + gy * ly + lz) * inv + 1) / 2;
      const g = gmap(s01);
      if (g > gf) hi[i] = gf < 1 ? clamp01((g - gf) / (1 - gf)) * hiOp : 0;
      else if (g < gf) sh[i] = gf > 0 ? clamp01((gf - g) / gf) * shOp : 0;
    }
  }
  if (style === 'stroke-emboss')
    for (let i = 0; i < n; i++) {
      hi[i] *= strokeCov![i];
      sh[i] *= strokeCov![i];
    }
  const inside = style !== 'outer-bevel', outside = style !== 'inner-bevel';
  if (inside) {
    emitLayer(c, layerState, sh, fx.shadowColor, fx.shadowMode);
    emitLayer(c, layerState, hi, fx.highlightColor, fx.highlightMode);
  }
  if (outside) {
    emit(c, 'above', 'bevel-shadow', aboveState, sh, fx.shadowColor, fx.shadowMode, Clip.Outside);
    emit(c, 'above', 'bevel-highlight', aboveState, hi, fx.highlightColor, fx.highlightMode, Clip.Outside);
  }
}

function strokeSource(c: Ctx, fx: StrokeFx, inS: number, size: number): ColorSource | null {
  const f = fx.fill;
  if (f.type === 'color') return f.color;
  if (f.type === 'pattern') return patternImage(c, f);
  if (f.style !== 'shape-burst') return gradientImage(c, f.gradient, { ...f, style: f.style });
  const ramp = gradientRamp(f.gradient, { foreground: c.opts.foreground, background: c.opts.background, reverse: f.reverse, method: f.method });
  const sd = sdOf(c, 'both'), n1 = RAMP_SIZE - 1;
  const img: RGBA8 = { width: c.bw, height: c.bh, data: new Uint8ClampedArray(c.bw * c.bh * 4) };
  for (let j = 0; j < c.bh; j++) {
    let wi = (c.by + j - c.wy) * c.ww + (c.bx - c.wx);
    for (let i = 0, ti = j * c.bw * 4; i < c.bw; i++, wi++, ti += 4) {
      const q = Math.round(clamp01((sd[wi] + inS) / Math.max(size, 1e-3)) * n1) * 4;
      img.data[ti] = ramp[q]; img.data[ti + 1] = ramp[q + 1]; img.data[ti + 2] = ramp[q + 2]; img.data[ti + 3] = ramp[q + 3];
    }
  }
  return img;
}
// Strokes: the inside part composites onto the layer clipped to its shape;
// the outside part goes above. Where an outside stroke meets the layer's
// anti-aliased edge the two cover disjoint parts of each pixel, so the layer
// alpha there is raised to alpha / (1 - s): plain source-over of the stroke
// then yields the disjoint sum and no seam shows between layer and stroke.
function strokes(c: Ctx, fxs: StrokeFx[], layerState: RGBA8, aboveState: RGBA8): { cov: Float32Array; keep: Float32Array | null } | null {
  if (!fxs.length) return null;
  const n = c.ww * c.wh, a = c.alpha;
  const anyIn = fxs.some((f) => f.position !== 'outside'), anyOut = fxs.some((f) => f.position !== 'inside');
  const sd = sdOf(c, anyIn && anyOut ? 'both' : anyIn ? 'inside' : 'outside');
  const cov = new Float32Array(n);
  let keep: Float32Array | null = null;
  for (const fx of fxs) {
    const size = Math.max(0, fx.size * c.k);
    if (size <= 0) continue;
    const outS = fx.position === 'outside' ? size : fx.position === 'center' ? size / 2 : 0;
    const inS = fx.position === 'inside' ? size : fx.position === 'center' ? size / 2 : 0;
    const src = strokeSource(c, fx, inS, size);
    if (!src) continue;
    const op = clamp01(fx.opacity);
    if (inS > 0) {
      const e = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        if (a[i] <= 0) continue;
        const band = Math.max(0, a[i] - clamp01(0.5 - inS - sd[i]));
        e[i] = (band / a[i]) * op;
        if (band > cov[i]) cov[i] = band;
      }
      emitLayer(c, layerState, e, src, fx.blendMode);
    }
    if (outS > 0) {
      const s = new Float32Array(n);
      keep ??= new Float32Array(n).fill(1);
      for (let i = 0; i < n; i++) {
        const band = Math.max(0, clamp01(outS + 0.5 - sd[i]) - a[i]);
        s[i] = band * op;
        keep[i] *= 1 - s[i];
        const tot = band + (inS > 0 ? Math.max(0, a[i] - clamp01(0.5 - inS - sd[i])) : 0);
        if (tot > cov[i]) cov[i] = Math.min(1, tot);
      }
      emit(c, 'above', 'stroke', aboveState, s, src, fx.blendMode, Clip.None);
    }
  }
  return { cov, keep };
}
// Applied after everything else that composites into the layer.
function raiseUnderStroke(c: Ctx, layerState: RGBA8, keep: Float32Array) {
  const t = layerState.data;
  for (let j = 0; j < c.bh; j++) {
    let wi = (c.by + j - c.wy) * c.ww + (c.bx - c.wx);
    for (let i = 0, ti = j * c.bw * 4 + 3; i < c.bw; i++, wi++, ti += 4)
      if (t[ti] && keep[wi] < 1) t[ti] = Math.min(255, t[ti] / Math.max(keep[wi], 1e-3));
  }
}

function hasAnyEffect(s: LayerStyle) {
  return list(s.dropShadow).length > 0 || list(s.innerShadow).length > 0 || on(s.outerGlow) || on(s.innerGlow) ||
    on(s.bevel) || on(s.satin) || list(s.colorOverlay).length > 0 || list(s.gradientOverlay).length > 0 ||
    on(s.patternOverlay) || list(s.stroke).length > 0;
}

// Renders a layer style. `layer` holds the layer's pixels in document space
// (already masked); the document is the layer buffer's extent. Effects are
// composited in this order: drop shadows, outer glow (below); layer fill
// with fill opacity, satin, color overlays, gradient overlays, pattern
// overlay, inner glow, inner shadows, bevel (layer, with outer parts above);
// strokes on top.
export function renderLayerStyle(layer: RGBA8, style: LayerStyle, opts: LayerStyleOptions): LayerStyleResult {
  const fill = clamp01(opts.fillOpacity);
  const content = alphaBounds(layer);
  if (!content) return { below: null, layer: { width: 0, height: 0, data: new Uint8ClampedArray(0) }, above: null, bounds: { x: 0, y: 0, width: 0, height: 0 } };
  const active = style.enabled && hasAnyEffect(style);
  const k = (style.scale ?? 1) * (opts.scale ?? 1);
  const e = active ? styleBoundsExpansion(style, opts.scale ?? 1) : { left: 0, top: 0, right: 0, bottom: 0 };
  // One pixel of transparent margin lets distance transforms see the edge.
  const pad = active ? 1 : 0;
  const wx = content.x - e.left - pad, wy = content.y - e.top - pad;
  const ww = content.width + e.left + e.right + 2 * pad, wh = content.height + e.top + e.bottom + 2 * pad;
  const bx = Math.max(0, wx), by = Math.max(0, wy);
  const bw = Math.min(layer.width, wx + ww) - bx, bh = Math.min(layer.height, wy + wh) - by;
  const bounds = { x: bx, y: by, width: bw, height: bh };

  // Layer state: content with fill opacity.
  const layerState: RGBA8 = { width: bw, height: bh, data: new Uint8ClampedArray(bw * bh * 4) };
  for (let j = 0; j < bh; j++) {
    const s = ((by + j) * layer.width + bx) * 4;
    layerState.data.set(layer.data.subarray(s, s + bw * 4), j * bw * 4);
  }
  const fade = () => {
    if (fill < 1) for (let i = 3; i < layerState.data.length; i += 4) layerState.data[i] *= fill;
  };
  const group = !!opts.interiorAsGroup && active;
  if (!group) fade();
  if (!active) return { below: null, layer: layerState, above: null, bounds };

  const alpha = new Float32Array(ww * wh);
  for (let j = 0; j < bh; j++) {
    let s = ((by + j) * layer.width + bx) * 4 + 3;
    let wi = (by + j - wy) * ww + (bx - wx);
    for (let i = 0; i < bw; i++, s += 4, wi++) alpha[wi] = layer.data[s] / 255;
  }
  const c: Ctx = {
    style, opts, k, wx, wy, ww, wh, bx, by, bw, bh, docW: opts.documentSize?.width ?? layer.width, docH: opts.documentSize?.height ?? layer.height, content, alpha,
    passes: opts.separatePasses ? [] : undefined,
  };
  const p = opts.progress;
  const blank = () => ({ width: bw, height: bh, data: new Uint8ClampedArray(bw * bh * 4) });
  const below = blank(), above = blank();
  let usedBelow = false, usedAbove = false;
  const steps = 12;
  let step = 0;
  const tick = () => {
    checkCancelled(p);
    p?.report?.(Math.min(1, ++step / steps));
  };

  list(style.dropShadow).forEach((fx, i) => {
    shadow(c, fx, false, below, 101 + i);
    usedBelow = true;
  });
  tick();
  if (on(style.outerGlow)) {
    glow(c, style.outerGlow, false, below, 201);
    usedBelow = true;
  }
  tick();
  if (on(style.satin)) satin(c, layerState);
  tick();
  for (const fx of list(style.colorOverlay)) emitLayer(c, layerState, clamp01(fx.opacity), fx.color, fx.blendMode);
  tick();
  for (const fx of list(style.gradientOverlay))
    emitLayer(c, layerState, clamp01(fx.opacity), gradientImage(c, fx.gradient, fx), fx.blendMode);
  tick();
  if (on(style.patternOverlay)) {
    const img = patternImage(c, style.patternOverlay);
    if (img) emitLayer(c, layerState, clamp01(style.patternOverlay.opacity), img, style.patternOverlay.blendMode);
  }
  tick();
  if (on(style.innerGlow)) glow(c, style.innerGlow, true, layerState, 301);
  tick();
  list(style.innerShadow).forEach((fx, i) => shadow(c, fx, true, layerState, 401 + i));
  if (group) fade();
  tick();
  const bevelFx = on(style.bevel) ? style.bevel : undefined;
  if (bevelFx && bevelFx.style !== 'stroke-emboss') {
    bevel(c, bevelFx, layerState, above, null);
    if (bevelFx.style !== 'inner-bevel') usedAbove = true;
  }
  tick();
  const strokeList = list(style.stroke);
  const stroked = strokes(c, strokeList, layerState, above);
  if (strokeList.some((s) => s.position !== 'inside')) usedAbove = true;
  tick();
  if (bevelFx && bevelFx.style === 'stroke-emboss' && stroked) {
    bevel(c, bevelFx, layerState, above, stroked.cov);
    usedAbove = true;
  }
  if (stroked?.keep) raiseUnderStroke(c, layerState, stroked.keep);
  tick();
  return { below: usedBelow ? below : null, layer: layerState, above: usedAbove ? above : null, bounds, passes: c.passes };
}

// Reference CPU compositing of a styled layer onto `backdrop` (document
// sized) in place: below passes and the layer content with their own blend
// modes, then above passes, all as one group faded by `layerOpacity`.
// Interior effects blend against the layer fill (as rendered above), which
// differs from blending them against the backdrop only under partial fill.
export function compositeLayerStyle(
  backdrop: RGBA8,
  layer: RGBA8,
  style: LayerStyle,
  opts: LayerStyleOptions & { blendMode?: BlendMode; layerOpacity?: number },
): RGBA8 {
  const r = renderLayerStyle(layer, style, { ...opts, separatePasses: true });
  const b = r.bounds;
  if (b.width <= 0 || b.height <= 0) return backdrop;
  // The group composites onto a copy of the backdrop region.
  const region: RGBA8 = { width: b.width, height: b.height, data: new Uint8ClampedArray(b.width * b.height * 4) };
  for (let j = 0; j < b.height; j++) {
    const s = ((b.y + j) * backdrop.width + b.x) * 4;
    region.data.set(backdrop.data.subarray(s, s + b.width * 4), j * b.width * 4);
  }
  const group: RGBA8 = { width: region.width, height: region.height, data: new Uint8ClampedArray(region.data) };
  for (const pass of r.passes ?? []) if (pass.stage === 'below') compositeRGBA8(group, pass.image, pass.mode);
  compositeRGBA8(group, r.layer, opts.blendMode ?? 'normal');
  for (const pass of r.passes ?? []) if (pass.stage === 'above') compositeRGBA8(group, pass.image, pass.mode);
  const o = clamp01(opts.layerOpacity ?? 1);
  const g = group.data, d = region.data;
  for (let i = 0; i < g.length; i += 4) {
    // Fade the group toward the backdrop in premultiplied space.
    const ga = g[i + 3] / 255, da = d[i + 3] / 255;
    const a = da + (ga - da) * o;
    if (a <= 0) { g[i] = g[i + 1] = g[i + 2] = g[i + 3] = 0; continue; }
    for (let q = 0; q < 3; q++) g[i + q] = (d[i + q] * da * (1 - o) + g[i + q] * ga * o) / a;
    g[i + 3] = a * 255;
  }
  for (let j = 0; j < b.height; j++)
    backdrop.data.set(g.subarray(j * b.width * 4, (j + 1) * b.width * 4), ((b.y + j) * backdrop.width + b.x) * 4);
  return backdrop;
}
