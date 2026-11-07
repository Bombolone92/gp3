// Distort filters. Each one is an inverse map (output pixel -> source point)
// rendered by warpImage over the selection's bounding box, which is also the
// frame that center-based effects (Pinch, Spherize, Twirl, ZigZag, Polar
// Coordinates) are normalized to, then blended back by selection coverage.
import type { ImageOperation, IRect, OperationContext, ParamValues, Progress, RGBA8 } from '../types';
import { cloneRGBA8 } from '../types';
import {
  type CoordMap,
  type EdgeMode,
  blendSelection,
  bool,
  boxBlurPlane,
  hash3,
  num,
  paste,
  rng,
  selectionBounds,
  str,
  warpImage,
} from './sampling';

function runWarp(
  src: RGBA8,
  ctx: OperationContext,
  make: (b: IRect) => CoordMap | null,
  edge: EdgeMode,
  progress?: Progress,
): RGBA8 {
  const b = selectionBounds(src, ctx.selection);
  if (!b) return cloneRGBA8(src);
  const map = make(b);
  if (!map) return cloneRGBA8(src);
  const part = warpImage(src, b.width, b.height, map, {
    offsetX: b.x,
    offsetY: b.y,
    edge,
    method: 'bilinear',
    progress,
  });
  return blendSelection(src, paste(cloneRGBA8(src), part, b.x, b.y), ctx.selection);
}
function seedOf(p: ParamValues, ctx: OperationContext) {
  return (Math.round(num(p, 'seed', 0)) ^ Math.imul((ctx.seed ?? 0) | 0, 0x9e3779b1)) >>> 0;
}
// Keeps a coordinate inside [lo, lo + n) by wrapping or by repeating the edge.
function fold(x: number, lo: number, n: number, wrap: boolean) {
  const t = x - lo;
  // Floored division: V8 compiles float `%` to a slow runtime call.
  if (wrap) return lo + t - n * Math.floor(t / n);
  return lo + (t < 0.5 ? 0.5 : t > n - 0.5 ? n - 0.5 : t);
}
const undefinedAreas = {
  key: 'undefined',
  label: 'Undefined areas',
  type: 'select' as const,
  options: [
    { value: 'wrap', label: 'Wrap around' },
    { value: 'repeat', label: 'Repeat edge pixels' },
  ],
  default: 'repeat',
};
const seedParam = { key: 'seed', label: 'Seed', type: 'number' as const, min: 0, max: 99999, step: 1, default: 1 };

// ---------------------------------------------------------------------------
// Center-based distortions.

export const pinch: ImageOperation = {
  id: 'pinch',
  label: 'Pinch',
  category: 'Distort',
  params: [{ key: 'amount', label: 'Amount', type: 'number', min: -100, max: 100, default: 50, unit: '%' }],
  apply(src, p, ctx, progress) {
    // pow(sin(pi/2 r), -a) has unit slope at the rim, so the effect blends in
    // without a crease; |a| < 1 keeps the center continuous.
    const a = Math.max(-1, Math.min(1, num(p, 'amount', 50) / 100)) * 0.95;
    if (!a) return cloneRGBA8(src);
    return runWarp(
      src,
      ctx,
      (b) => {
        const cx = b.x + b.width / 2,
          cy = b.y + b.height / 2,
          rx = b.width / 2,
          ry = b.height / 2;
        return (x, y, o) => {
          const nx = (x - cx) / rx,
            ny = (y - cy) / ry,
            r = Math.sqrt(nx * nx + ny * ny);
          if (r >= 1 || r === 0) return;
          const f = Math.pow(Math.sin((Math.PI / 2) * r), -a);
          o[0] = cx + nx * f * rx;
          o[1] = cy + ny * f * ry;
        };
      },
      'clamp',
      progress,
    );
  },
};

export const spherize: ImageOperation = {
  id: 'spherize',
  label: 'Spherize',
  category: 'Distort',
  params: [
    { key: 'amount', label: 'Amount', type: 'number', min: -100, max: 100, default: 100, unit: '%' },
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'horizontal', label: 'Horizontal only' },
        { value: 'vertical', label: 'Vertical only' },
      ],
      default: 'normal',
    },
  ],
  apply(src, p, ctx, progress) {
    const a = Math.max(-1, Math.min(1, num(p, 'amount', 100) / 100)),
      mode = str(p, 'mode', 'normal');
    if (!a) return cloneRGBA8(src);
    // Positive: refraction through a sphere, r_s = (2/pi) asin(r) magnifies the
    // center; negative uses sin(pi/2 r), the inverse-shaped curve, to shrink it.
    const radial = (r: number) =>
      a > 0 ? r + a * ((2 / Math.PI) * Math.asin(r) - r) : r - a * (Math.sin((Math.PI / 2) * r) - r);
    return runWarp(
      src,
      ctx,
      (b) => {
        const cx = b.x + b.width / 2,
          cy = b.y + b.height / 2,
          rx = b.width / 2,
          ry = b.height / 2;
        if (mode === 'horizontal')
          return (x, _y, o) => {
            const nx = (x - cx) / rx,
              r = Math.abs(nx);
            if (r < 1 && r > 0) o[0] = cx + Math.sign(nx) * radial(r) * rx;
          };
        if (mode === 'vertical')
          return (_x, y, o) => {
            const ny = (y - cy) / ry,
              r = Math.abs(ny);
            if (r < 1 && r > 0) o[1] = cy + Math.sign(ny) * radial(r) * ry;
          };
        return (x, y, o) => {
          const nx = (x - cx) / rx,
            ny = (y - cy) / ry,
            r = Math.sqrt(nx * nx + ny * ny);
          if (r >= 1 || r === 0) return;
          const f = radial(r) / r;
          o[0] = cx + nx * f * rx;
          o[1] = cy + ny * f * ry;
        };
      },
      'clamp',
      progress,
    );
  },
};

export const twirl: ImageOperation = {
  id: 'twirl',
  label: 'Twirl',
  category: 'Distort',
  params: [{ key: 'angle', label: 'Angle', type: 'number', min: -999, max: 999, default: 50, unit: '°' }],
  apply(src, p, ctx, progress) {
    const ang = (num(p, 'angle', 50) * Math.PI) / 180;
    if (!ang) return cloneRGBA8(src);
    return runWarp(
      src,
      ctx,
      (b) => {
        const cx = b.x + b.width / 2,
          cy = b.y + b.height / 2,
          rx = b.width / 2,
          ry = b.height / 2;
        return (x, y, o) => {
          const nx = (x - cx) / rx,
            ny = (y - cy) / ry,
            r2 = nx * nx + ny * ny;
          if (r2 >= 1) return;
          const f = 1 - Math.sqrt(r2),
            t = -ang * f * f,
            c = Math.cos(t),
            s = Math.sin(t);
          o[0] = cx + (nx * c - ny * s) * rx;
          o[1] = cy + (nx * s + ny * c) * ry;
        };
      },
      'clamp',
      progress,
    );
  },
};

export const zigzag: ImageOperation = {
  id: 'zigzag',
  label: 'ZigZag',
  category: 'Distort',
  params: [
    { key: 'amount', label: 'Amount', type: 'number', min: -100, max: 100, default: 10 },
    { key: 'ridges', label: 'Ridges', type: 'number', min: 1, max: 20, step: 1, default: 5 },
    {
      key: 'style',
      label: 'Style',
      type: 'select',
      options: [
        { value: 'pond-ripples', label: 'Pond ripples' },
        { value: 'out-from-center', label: 'Out from center' },
        { value: 'around-center', label: 'Around center' },
      ],
      default: 'pond-ripples',
    },
  ],
  apply(src, p, ctx, progress) {
    const a = num(p, 'amount', 10) / 100,
      ridges = Math.max(1, num(p, 'ridges', 5)),
      style = str(p, 'style', 'pond-ripples');
    if (!a) return cloneRGBA8(src);
    const radialAmp = style === 'around-center' ? 0 : (style === 'pond-ripples' ? 0.5 : 1) * (2 / ridges) * a,
      angAmp = style === 'out-from-center' ? 0 : (style === 'pond-ripples' ? 0.5 : 1) * (Math.PI / 2) * a;
    return runWarp(
      src,
      ctx,
      (b) => {
        const cx = b.x + b.width / 2,
          cy = b.y + b.height / 2,
          rx = b.width / 2,
          ry = b.height / 2;
        return (x, y, o) => {
          const nx = (x - cx) / rx,
            ny = (y - cy) / ry,
            r = Math.sqrt(nx * nx + ny * ny);
          if (r >= 1 || r === 0) return;
          const fade = 1 - r,
            w = Math.sin(2 * Math.PI * ridges * r) * fade;
          const rs = (r + radialAmp * w) / r,
            t = angAmp * w,
            c = Math.cos(t) * rs,
            s = Math.sin(t) * rs;
          o[0] = cx + (nx * c - ny * s) * rx;
          o[1] = cy + (nx * s + ny * c) * ry;
        };
      },
      'clamp',
      progress,
    );
  },
};

export const polarCoordinates: ImageOperation = {
  id: 'polar-coordinates',
  label: 'Polar Coordinates',
  category: 'Distort',
  params: [
    {
      key: 'mode',
      label: 'Conversion',
      type: 'select',
      options: [
        { value: 'rect-to-polar', label: 'Rectangular to polar' },
        { value: 'polar-to-rect', label: 'Polar to rectangular' },
      ],
      default: 'rect-to-polar',
    },
  ],
  apply(src, p, ctx, progress) {
    const toPolar = str(p, 'mode', 'rect-to-polar') === 'rect-to-polar';
    return runWarp(
      src,
      ctx,
      (b) => {
        const W = b.width,
          H = b.height,
          cx = b.x + W / 2,
          cy = b.y + H / 2;
        // The source's top row becomes the center and its x axis the angle,
        // measured clockwise from 12 o'clock; radius 1 touches the box edges.
        if (toPolar)
          return (x, y, o) => {
            const nx = (x - cx) / (W / 2),
              ny = (y - cy) / (H / 2);
            let th = Math.atan2(nx, -ny);
            if (th < 0) th += 2 * Math.PI;
            o[0] = b.x + (th / (2 * Math.PI)) * W;
            o[1] = b.y + Math.sqrt(nx * nx + ny * ny) * H;
            if (o[1] > b.y + H - 0.5) o[1] = b.y + H - 0.5;
          };
        return (x, y, o) => {
          const th = ((x - b.x) / W) * 2 * Math.PI,
            r = (y - b.y) / H;
          o[0] = cx + r * Math.sin(th) * (W / 2);
          o[1] = cy - r * Math.cos(th) * (H / 2);
        };
      },
      'clamp',
      progress,
    );
  },
};

// ---------------------------------------------------------------------------
// Waves and ripples.

export const ripple: ImageOperation = {
  id: 'ripple',
  label: 'Ripple',
  category: 'Distort',
  params: [
    { key: 'amount', label: 'Amount', type: 'number', min: -999, max: 999, default: 100, unit: '%' },
    {
      key: 'size',
      label: 'Size',
      type: 'select',
      options: [
        { value: 'small', label: 'Small' },
        { value: 'medium', label: 'Medium' },
        { value: 'large', label: 'Large' },
      ],
      default: 'medium',
    },
  ],
  apply(src, p, ctx, progress) {
    const scale = ctx.scale ?? 1,
      size = str(p, 'size', 'medium');
    const lambda = (size === 'small' ? 6 : size === 'large' ? 30 : 14) * scale,
      amp = (num(p, 'amount', 100) / 100) * lambda * 0.18;
    if (!amp) return cloneRGBA8(src);
    // Two incommensurate harmonics so the ripples look less mechanical.
    const k1 = (2 * Math.PI) / lambda,
      k2 = (2 * Math.PI) / (lambda * 1.618);
    return runWarp(
      src,
      ctx,
      (b) => (x, y, o) => {
        const dx = amp * (0.75 * Math.sin(k1 * y) + 0.25 * Math.sin(k2 * y + 1.3)),
          dy = amp * (0.75 * Math.sin(k1 * x) + 0.25 * Math.sin(k2 * x + 2.1));
        o[0] = fold(x + dx, b.x, b.width, false);
        o[1] = fold(y + dy, b.y, b.height, false);
      },
      'clamp',
      progress,
    );
  },
};

export const wave: ImageOperation = {
  id: 'wave',
  label: 'Wave',
  category: 'Distort',
  params: [
    { key: 'generators', label: 'Number of generators', type: 'number', min: 1, max: 999, step: 1, default: 5 },
    { key: 'wavelengthMin', label: 'Wavelength min', type: 'number', min: 1, max: 998, step: 1, default: 10 },
    { key: 'wavelengthMax', label: 'Wavelength max', type: 'number', min: 2, max: 999, step: 1, default: 120 },
    { key: 'amplitudeMin', label: 'Amplitude min', type: 'number', min: 1, max: 998, step: 1, default: 5 },
    { key: 'amplitudeMax', label: 'Amplitude max', type: 'number', min: 1, max: 999, step: 1, default: 35 },
    { key: 'scaleH', label: 'Horizontal scale', type: 'number', min: 0, max: 100, default: 100, unit: '%' },
    { key: 'scaleV', label: 'Vertical scale', type: 'number', min: 0, max: 100, default: 100, unit: '%' },
    {
      key: 'type',
      label: 'Type',
      type: 'select',
      options: [
        { value: 'sine', label: 'Sine' },
        { value: 'triangle', label: 'Triangle' },
        { value: 'square', label: 'Square' },
      ],
      default: 'sine',
    },
    { ...undefinedAreas, default: 'wrap' },
    seedParam,
  ],
  apply(src, p, ctx, progress) {
    const b = selectionBounds(src, ctx.selection);
    if (!b) return cloneRGBA8(src);
    const scale = ctx.scale ?? 1,
      n = Math.max(1, Math.min(999, Math.round(num(p, 'generators', 5))));
    let wl0 = num(p, 'wavelengthMin', 10),
      wl1 = num(p, 'wavelengthMax', 120),
      am0 = num(p, 'amplitudeMin', 5),
      am1 = num(p, 'amplitudeMax', 35);
    if (wl1 < wl0) [wl0, wl1] = [wl1, wl0];
    if (am1 < am0) [am0, am1] = [am1, am0];
    const sh = num(p, 'scaleH', 100) / 100,
      sv = num(p, 'scaleV', 100) / 100,
      type = str(p, 'type', 'sine'),
      wrap = str(p, 'undefined', 'wrap') === 'wrap';
    const R = rng(seedOf(p, ctx));
    const gens = Array.from({ length: n }, () => ({
      lx: (wl0 + (wl1 - wl0) * R()) * scale,
      ly: (wl0 + (wl1 - wl0) * R()) * scale,
      ax: (am0 + (am1 - am0) * R()) * scale,
      ay: (am0 + (am1 - am0) * R()) * scale,
      px: R(),
      py: R(),
    }));
    const shapeFn = (t: number) => {
      const f = t - Math.floor(t);
      if (type === 'triangle') return f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4;
      if (type === 'square') return f < 0.5 ? 1 : -1;
      return Math.sin(2 * Math.PI * f);
    };
    // Displacement is separable (dx depends on y, dy on x), so tabulate it once
    // per row and column instead of summing every generator at every pixel.
    const norm = 1 / Math.sqrt(n),
      dxRow = new Float32Array(b.height),
      dyCol = new Float32Array(b.width);
    for (let j = 0; j < b.height; j++) {
      let s = 0;
      for (const g of gens) s += g.ax * shapeFn((b.y + j + 0.5) / g.lx + g.px);
      dxRow[j] = s * norm * sh;
    }
    for (let i = 0; i < b.width; i++) {
      let s = 0;
      for (const g of gens) s += g.ay * shapeFn((b.x + i + 0.5) / g.ly + g.py);
      dyCol[i] = s * norm * sv;
    }
    return runWarp(
      src,
      ctx,
      () => (x, y, o) => {
        const i = Math.min(b.width - 1, Math.max(0, Math.floor(x - b.x))),
          j = Math.min(b.height - 1, Math.max(0, Math.floor(y - b.y)));
        o[0] = fold(x + dxRow[j], b.x, b.width, wrap);
        o[1] = fold(y + dyCol[i], b.y, b.height, wrap);
      },
      'clamp',
      progress,
    );
  },
};

export const shear: ImageOperation = {
  id: 'shear',
  label: 'Shear',
  category: 'Distort',
  // Horizontal offsets (percent of half the width) at five evenly spaced heights,
  // joined by a Catmull-Rom curve.
  params: [
    { key: 'p0', label: 'Top', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
    { key: 'p1', label: 'Upper', type: 'number', min: -100, max: 100, default: 25, unit: '%' },
    { key: 'p2', label: 'Middle', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
    { key: 'p3', label: 'Lower', type: 'number', min: -100, max: 100, default: -25, unit: '%' },
    { key: 'p4', label: 'Bottom', type: 'number', min: -100, max: 100, default: 0, unit: '%' },
    { ...undefinedAreas, default: 'wrap' },
  ],
  apply(src, p, ctx, progress) {
    const pts = [0, 1, 2, 3, 4].map((i) => num(p, 'p' + i, [0, 25, 0, -25, 0][i]) / 100);
    if (pts.every((v) => v === 0)) return cloneRGBA8(src);
    const wrap = str(p, 'undefined', 'wrap') === 'wrap';
    return runWarp(
      src,
      ctx,
      (b) => {
        const rows = new Float32Array(b.height);
        for (let j = 0; j < b.height; j++) {
          const t = (b.height > 1 ? (j + 0.5) / b.height : 0.5) * 4,
            k = Math.min(3, Math.floor(t)),
            f = t - k;
          const P = (i: number) => pts[Math.max(0, Math.min(4, i))];
          const p0 = P(k - 1),
            p1 = P(k),
            p2 = P(k + 1),
            p3 = P(k + 2);
          rows[j] =
            0.5 *
            (2 * p1 +
              (-p0 + p2) * f +
              (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
              (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f) *
            (b.width / 2);
        }
        return (x, y, o) => {
          const j = Math.min(b.height - 1, Math.max(0, Math.floor(y - b.y)));
          o[0] = fold(x - rows[j], b.x, b.width, wrap);
        };
      },
      'clamp',
      progress,
    );
  },
};

// ---------------------------------------------------------------------------
// Displacement-map based distortions.

export type DisplaceFit = 'stretch' | 'tile';
// Moves pixels by a displacement map: the map's red channel drives horizontal
// and green vertical displacement; 128 is neutral, 0 and 255 shift by
// -/+ scale% of 128 px (the source is read at the displaced position).
export function displace(
  src: RGBA8,
  map: RGBA8,
  hScale: number,
  vScale: number,
  fit: DisplaceFit = 'stretch',
  undefinedAreas: 'wrap' | 'repeat' = 'repeat',
  region?: IRect,
  progress?: Progress,
): RGBA8 {
  const b = region ?? { x: 0, y: 0, width: src.width, height: src.height };
  const mw = map.width,
    mh = map.height,
    md = map.data;
  const hx = new Float32Array(mw * mh),
    vy = new Float32Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) {
    hx[i] = (md[i * 4] - 128) * (hScale / 100);
    vy[i] = (md[i * 4 + 1] - 128) * (vScale / 100);
  }
  const wrap = undefinedAreas === 'wrap',
    W = src.width,
    H = src.height;
  const fn: CoordMap =
    fit === 'tile'
      ? (x, y, o) => {
          const i = (((Math.floor(x) | 0) % mw) + mw) % mw,
            j = (((Math.floor(y) | 0) % mh) + mh) % mh,
            k = j * mw + i;
          o[0] = fold(x + hx[k], 0, W, wrap);
          o[1] = fold(y + vy[k], 0, H, wrap);
        }
      : (x, y, o) => {
          // Bilinear lookup of the map stretched over the whole image.
          const u = Math.min(mw - 1, Math.max(0, (x / W) * mw - 0.5)),
            v = Math.min(mh - 1, Math.max(0, (y / H) * mh - 0.5));
          const i = Math.min(mw - 2, Math.floor(u)),
            j = Math.min(mh - 2, Math.floor(v));
          let dx: number, dy: number;
          if (i < 0 || j < 0) {
            const k = Math.max(0, j) * mw + Math.max(0, i);
            dx = hx[k];
            dy = vy[k];
          } else {
            const fu = u - i,
              fv = v - j,
              k = j * mw + i;
            const w00 = (1 - fu) * (1 - fv),
              w10 = fu * (1 - fv),
              w01 = (1 - fu) * fv,
              w11 = fu * fv;
            dx = w00 * hx[k] + w10 * hx[k + 1] + w01 * hx[k + mw] + w11 * hx[k + mw + 1];
            dy = w00 * vy[k] + w10 * vy[k + 1] + w01 * vy[k + mw] + w11 * vy[k + mw + 1];
          }
          o[0] = fold(x + dx, 0, W, wrap);
          o[1] = fold(y + dy, 0, H, wrap);
        };
  const part = warpImage(src, b.width, b.height, fn, { offsetX: b.x, offsetY: b.y, edge: 'clamp', progress });
  if (!region) return part;
  return paste(cloneRGBA8(src), part, b.x, b.y);
}

export const displaceOp: ImageOperation = {
  id: 'displace',
  label: 'Displace',
  category: 'Distort',
  params: [
    { key: 'hScale', label: 'Horizontal scale', type: 'number', min: -999, max: 999, default: 10, unit: '%' },
    { key: 'vScale', label: 'Vertical scale', type: 'number', min: -999, max: 999, default: 10, unit: '%' },
    {
      key: 'fit',
      label: 'Displacement map',
      type: 'select',
      options: [
        { value: 'stretch', label: 'Stretch to fit' },
        { value: 'tile', label: 'Tile' },
      ],
      default: 'stretch',
    },
    undefinedAreas,
  ],
  apply(src, p, ctx, progress) {
    // Without an external map the image's own luminance drives the shift.
    const b = selectionBounds(src, ctx.selection);
    if (!b) return cloneRGBA8(src);
    const scale = ctx.scale ?? 1,
      n = src.width * src.height,
      s = src.data;
    const map = { width: src.width, height: src.height, data: new Uint8ClampedArray(n * 4) };
    for (let i = 0; i < n * 4; i += 4) {
      const l = 0.2126 * s[i] + 0.7152 * s[i + 1] + 0.0722 * s[i + 2],
        v = 128 + (l - 128) * (s[i + 3] / 255);
      map.data[i] = map.data[i + 1] = v;
    }
    const out = displace(
      src,
      map,
      num(p, 'hScale', 10) * scale,
      num(p, 'vScale', 10) * scale,
      'stretch',
      str(p, 'undefined', 'repeat') === 'wrap' ? 'wrap' : 'repeat',
      b,
      progress,
    );
    return blendSelection(src, out, ctx.selection);
  },
};

// Tileable procedural height field in [0, 1], size T x T.
function glassTexture(texture: string, T: number, smooth: number, seed: number): Float32Array {
  const h = new Float32Array(T * T);
  const cell = Math.max(4, Math.round(T / 8));
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      let v: number;
      if (texture === 'blocks') v = hash3(Math.floor(x / cell), Math.floor(y / cell), seed);
      else if (texture === 'tiny-lens') {
        const u = ((x % cell) + 0.5) / cell - 0.5,
          w = ((y % cell) + 0.5) / cell - 0.5,
          r2 = 4 * (u * u + w * w);
        v = r2 < 1 ? Math.sqrt(1 - r2) : 0;
      } else if (texture === 'canvas') {
        // Over-under weave of horizontal and vertical threads.
        const cx = Math.floor(x / cell),
          cy = Math.floor(y / cell),
          fx = (x % cell) / cell,
          fy = (y % cell) / cell;
        v = (cx + cy) & 1 ? Math.sin(Math.PI * fy) : Math.sin(Math.PI * fx);
      } else v = hash3(x, y, seed);
      h[y * T + x] = v;
    }
  const r = Math.max(1, Math.round(smooth));
  const tmp = new Float32Array(T);
  for (let k = 0; k < 3; k++) boxBlurPlane(h, T, T, r, true, tmp);
  let lo = Infinity,
    hi = -Infinity;
  for (const v of h) ((lo = Math.min(lo, v)), (hi = Math.max(hi, v)));
  const s = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) * s;
  return h;
}
// Central-difference gradient of a tileable field, normalized to unit peak.
function gradientTile(h: Float32Array, T: number): [Float32Array, Float32Array] {
  const gx = new Float32Array(T * T),
    gy = new Float32Array(T * T);
  let m = 1e-9;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const k = y * T + x;
      gx[k] = (h[y * T + ((x + 1) % T)] - h[y * T + ((x + T - 1) % T)]) / 2;
      gy[k] = (h[((y + 1) % T) * T + x] - h[((y + T - 1) % T) * T + x]) / 2;
      m = Math.max(m, Math.abs(gx[k]), Math.abs(gy[k]));
    }
  for (let k = 0; k < T * T; k++) ((gx[k] /= m), (gy[k] /= m));
  return [gx, gy];
}
function tileWarp(
  src: RGBA8,
  ctx: OperationContext,
  gx: Float32Array,
  gy: Float32Array,
  T: number,
  amp: number,
  progress?: Progress,
) {
  return runWarp(
    src,
    ctx,
    () => (x, y, o) => {
      const k = ((((Math.floor(y) | 0) % T) + T) % T) * T + ((((Math.floor(x) | 0) % T) + T) % T);
      o[0] = x + amp * gx[k];
      o[1] = y + amp * gy[k];
    },
    'clamp',
    progress,
  );
}

export const glass: ImageOperation = {
  id: 'glass',
  label: 'Glass',
  category: 'Distort',
  params: [
    { key: 'distortion', label: 'Distortion', type: 'number', min: 0, max: 20, default: 5 },
    { key: 'smoothness', label: 'Smoothness', type: 'number', min: 1, max: 15, default: 3 },
    {
      key: 'texture',
      label: 'Texture',
      type: 'select',
      options: [
        { value: 'frosted', label: 'Frosted' },
        { value: 'blocks', label: 'Blocks' },
        { value: 'canvas', label: 'Canvas' },
        { value: 'tiny-lens', label: 'Tiny lens' },
      ],
      default: 'frosted',
    },
    { key: 'scaling', label: 'Scaling', type: 'number', min: 50, max: 200, default: 100, unit: '%' },
    { key: 'invert', label: 'Invert', type: 'checkbox', default: false },
    seedParam,
  ],
  apply(src, p, ctx, progress) {
    const scale = ctx.scale ?? 1,
      dist = num(p, 'distortion', 5);
    if (!dist) return cloneRGBA8(src);
    const sz = num(p, 'scaling', 100) / 100,
      texture = str(p, 'texture', 'frosted');
    const T = Math.max(16, Math.round((texture === 'frosted' ? 256 : 128) * sz * scale));
    const smooth = num(p, 'smoothness', 3) * (texture === 'frosted' ? 1 : 2) * sz * scale;
    const [gx, gy] = gradientTile(glassTexture(texture, T, smooth, seedOf(p, ctx)), T);
    const amp = dist * 1.5 * scale * (bool(p, 'invert', false) ? -1 : 1);
    return tileWarp(src, ctx, gx, gy, T, amp, progress);
  },
};

export const oceanRipple: ImageOperation = {
  id: 'ocean-ripple',
  label: 'Ocean Ripple',
  category: 'Distort',
  params: [
    { key: 'size', label: 'Ripple size', type: 'number', min: 1, max: 15, step: 1, default: 9 },
    { key: 'magnitude', label: 'Ripple magnitude', type: 'number', min: 0, max: 20, step: 1, default: 9 },
    seedParam,
  ],
  apply(src, p, ctx, progress) {
    const scale = ctx.scale ?? 1,
      mag = num(p, 'magnitude', 9);
    if (!mag) return cloneRGBA8(src);
    const size = num(p, 'size', 9),
      T = Math.max(32, Math.round(256 * scale));
    // Two independent smoothed noise fields give a choppy water-surface shift.
    const seed = seedOf(p, ctx),
      fx = new Float32Array(T * T),
      fy = new Float32Array(T * T);
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        fx[y * T + x] = hash3(x, y, seed) - 0.5;
        fy[y * T + x] = hash3(x, y, seed ^ 0x5bd1e995) - 0.5;
      }
    const r = Math.max(1, Math.round(size * 0.5 * scale)),
      tmp = new Float32Array(T);
    for (let k = 0; k < 2; k++) {
      boxBlurPlane(fx, T, T, r, true, tmp);
      boxBlurPlane(fy, T, T, r, true, tmp);
    }
    let m = 1e-9;
    for (let i = 0; i < T * T; i++) m = Math.max(m, Math.abs(fx[i]), Math.abs(fy[i]));
    for (let i = 0; i < T * T; i++) ((fx[i] /= m), (fy[i] /= m));
    return tileWarp(src, ctx, fx, fy, T, mag * 0.6 * scale, progress);
  },
};

export const distortOps: ImageOperation[] = [
  pinch,
  spherize,
  twirl,
  ripple,
  wave,
  zigzag,
  polarCoordinates,
  shear,
  displaceOp,
  glass,
  oceanRipple,
];
