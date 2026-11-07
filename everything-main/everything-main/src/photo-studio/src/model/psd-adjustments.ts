// PSD adjustment layers <-> editable adjustment layers. ag-psd decodes the
// adjustment tagged blocks (levl, curv, hue2, ...) into `layer.adjustment`;
// these helpers translate between that form and the engine's parameters.
// Kinds or variants without a faithful mapping (noise gradients, color
// lookups other than embedded .cube tables, 32-bit documents whose float
// values the LUT pass would clamp) keep the composite fallback.
import type { AdjustmentLayer, Color, Layer as PsdLayer, PixelData } from 'ag-psd';
import {
  adjustmentToCubeLut,
  defaultParams,
  hslToRgb,
  labToRgb,
  parseCubeLut,
  PHOTO_FILTER_PRESETS,
  rgbToHsl,
  serializeCubeLut,
  SELECTIVE_RANGES,
  HUE_RANGES,
  type Adjustment,
  type AdjustmentParamsMap,
  type HueSatRange,
  type PhotoFilterPreset,
  type RGB8,
} from '../imaging/adjust';
import { specAdjustment, valuesToPoints } from '../features/adjust/spec';
import { layer as newLayer, type AdjustmentSpec, type Layer } from './document';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const byte = (v: number) => Math.round(clampN(v, 0, 255));
const mod360 = (v: number) => ((Math.round(v) % 360) + 360) % 360;

function colorRgb(c: Color | undefined): RGB8 | undefined {
  if (!c) return undefined;
  if ('r' in c) return [byte(c.r), byte(c.g), byte(c.b)];
  if ('fr' in c) return [byte(c.fr * 255), byte(c.fg * 255), byte(c.fb * 255)];
  if ('l' in c) {
    // ag-psd reports Lab either normalized (L/100, a/128) or in native units.
    const L = c.l <= 1 ? c.l * 100 : c.l,
      A = Math.abs(c.a) <= 1.01 && Math.abs(c.b) <= 1.01 ? c.a * 128 : c.a,
      B = Math.abs(c.a) <= 1.01 && Math.abs(c.b) <= 1.01 ? c.b * 128 : c.b;
    const rgb = labToRgb(L, A, B);
    return [byte(rgb[0] * 255), byte(rgb[1] * 255), byte(rgb[2] * 255)];
  }
  if ('h' in c) {
    const h = c.h * 360,
      s = c.s,
      v = c.b;
    const k = (n: number) => (n + h / 60) % 6;
    const f = (n: number) => v - v * s * Math.max(0, Math.min(k(n), 4 - k(n), 1));
    return [byte(f(5) * 255), byte(f(3) * 255), byte(f(1) * 255)];
  }
  if ('k' in c && !('c' in c)) return [byte(255 - c.k), byte(255 - c.k), byte(255 - c.k)];
  return undefined;
}

type Params<K extends keyof AdjustmentParamsMap> = AdjustmentParamsMap[K];

/** Editable spec for a PSD adjustment layer, or undefined when it must stay
 * a composite (unsupported kind, variant or document depth). */
export function importPsdAdjustment(item: PsdLayer, depth = 8): AdjustmentSpec | undefined {
  const a = item.adjustment;
  if (!a || item.children || depth > 16) return undefined;
  const adj = convertIn(a);
  return adj ? { kind: adj.kind, params: adj.params as unknown as Record<string, unknown> } : undefined;
}
export const supportedPsdAdjustment = (item: PsdLayer, depth = 8) => !!importPsdAdjustment(item, depth);

function convertIn(a: AdjustmentLayer): Adjustment | undefined {
  switch (a.type) {
    case 'brightness/contrast':
      return { kind: 'brightness-contrast', params: { brightness: num(a.brightness, 0), contrast: num(a.contrast, 0), legacy: !!a.useLegacy } };
    case 'levels': {
      const p = defaultParams('levels');
      const map = { rgb: a.rgb, r: a.red, g: a.green, b: a.blue };
      for (const [k, c] of Object.entries(map))
        if (c)
          p[k as 'rgb'] = {
            inBlack: clampN(num(c.shadowInput, 0), 0, 253),
            inWhite: clampN(num(c.highlightInput, 255), 2, 255),
            gamma: clampN(num(c.midtoneInput, 1), 0.01, 9.99),
            outBlack: clampN(num(c.shadowOutput, 0), 0, 255),
            outWhite: clampN(num(c.highlightOutput, 255), 0, 255),
          };
      return { kind: 'levels', params: p };
    }
    case 'curves': {
      const p = defaultParams('curves');
      const map = { rgb: a.rgb, r: a.red, g: a.green, b: a.blue };
      for (const [k, c] of Object.entries(map)) {
        if (!c?.length) continue;
        const pts = c.map((n) => [byte(n.input), byte(n.output)] as [number, number]).sort((x, y) => x[0] - y[0]);
        const unique = pts.filter((q, i) => i === 0 || q[0] !== pts[i - 1][0]);
        if (unique.length >= 2) p[k as 'rgb'].points = unique;
        else if (unique.length === 1) p[k as 'rgb'].points = [unique[0], unique[0][0] < 255 ? [255, 255] : [0, 0]].sort((x, y) => x[0] - y[0]) as [number, number][];
      }
      return { kind: 'curves', params: p };
    }
    case 'exposure':
      return { kind: 'exposure', params: { exposure: num(a.exposure, 0), offset: num(a.offset, 0), gamma: num(a.gamma, 1) || 1 } };
    case 'vibrance':
      return { kind: 'vibrance', params: { vibrance: num(a.vibrance, 0), saturation: num(a.saturation, 0) } };
    case 'hue/saturation': {
      const p = defaultParams('hue-saturation');
      const m = a.master;
      if (m) {
        // The master record carries the colorize flag (high byte of a) and
        // the colorization hue, saturation and lightness (b, c, d).
        p.colorize = (m.a & 0xff00) !== 0 || m.a === 1;
        p.colorizeHue = mod360(num(m.b, 30));
        p.colorizeSaturation = clampN(num(m.c, 25), 0, 100);
        p.master = { hue: num(m.hue, 0), saturation: num(m.saturation, 0), lightness: num(p.colorize ? m.d : m.lightness, 0) };
      }
      for (const n of HUE_RANGES) {
        const r = a[n];
        if (!r) continue;
        const range = [r.a, r.b, r.c, r.d].map(mod360) as HueSatRange['range'];
        p.ranges[n] = { hue: num(r.hue, 0), saturation: num(r.saturation, 0), lightness: num(r.lightness, 0), range: range.every((v) => v === 0) ? p.ranges[n].range : range };
      }
      return { kind: 'hue-saturation', params: p };
    }
    case 'color balance': {
      const t = (v: typeof a.shadows): [number, number, number] => [num(v?.cyanRed, 0), num(v?.magentaGreen, 0), num(v?.yellowBlue, 0)];
      return { kind: 'color-balance', params: { shadows: t(a.shadows), midtones: t(a.midtones), highlights: t(a.highlights), preserveLuminosity: a.preserveLuminosity !== false } };
    }
    case 'black & white': {
      const p = defaultParams('black-white');
      for (const n of HUE_RANGES) p[n] = num(a[n], p[n]);
      p.tint = !!a.useTint;
      const c = colorRgb(a.tintColor);
      if (c) {
        const [h, s] = rgbToHsl(c[0] / 255, c[1] / 255, c[2] / 255);
        p.tintHue = Math.round(h);
        p.tintSaturation = Math.round(s * 100);
      }
      return { kind: 'black-white', params: p };
    }
    case 'photo filter': {
      const color = colorRgb(a.color) ?? PHOTO_FILTER_PRESETS.warming.color;
      const preset = (Object.entries(PHOTO_FILTER_PRESETS).find(([, v]) => v.color.every((x, i) => x === color[i]))?.[0] ?? 'custom') as PhotoFilterPreset;
      return { kind: 'photo-filter', params: { preset, color: [...color] as RGB8, density: clampN(num(a.density, 25), 0, 100), preserveLuminosity: !!a.preserveLuminosity } };
    }
    case 'channel mixer': {
      const p = defaultParams('channel-mixer');
      const row = (c: typeof a.red, d: Params<'channel-mixer'>['red']) => (c ? { r: num(c.red, 0), g: num(c.green, 0), b: num(c.blue, 0), constant: num(c.constant, 0) } : d);
      p.monochrome = !!a.monochrome;
      p.red = row(a.red, p.red);
      p.green = row(a.green, p.green);
      p.blue = row(a.blue, p.blue);
      p.gray = row(a.gray, p.gray);
      return { kind: 'channel-mixer', params: p };
    }
    case 'color lookup': {
      if ((a.lookupType ?? '3dlut') !== '3dlut' || a.lutFormat !== 'cube' || !a.lut3DFileData?.length) return undefined;
      try {
        const text = new TextDecoder().decode(a.lut3DFileData);
        parseCubeLut(text);
        const name = (a.name || a.lut3DFileName || 'Look').replace(/\.cube$/i, '');
        return { kind: 'color-lookup', params: { source: { type: 'cube', name, text }, amount: 100 } };
      } catch {
        return undefined;
      }
    }
    case 'invert':
      return { kind: 'invert', params: {} };
    case 'posterize':
      return { kind: 'posterize', params: { levels: clampN(Math.round(num(a.levels, 4)), 2, 255) } };
    case 'threshold':
      return { kind: 'threshold', params: { level: clampN(Math.round(num(a.level, 128)), 1, 255) } };
    case 'gradient map': {
      if (a.gradientType !== 'solid' || !a.colorStops?.length) return undefined;
      const stops = a.colorStops
        .map((s) => ({ location: clampN(num(s.location, 0), 0, 1), color: colorRgb(s.color) ?? ([0, 0, 0] as RGB8), midpoint: clampN(num(s.midpoint, 0.5), 0.01, 0.99) }))
        .sort((x, y) => x.location - y.location);
      const opacityStops = a.opacityStops?.map((s) => ({ location: clampN(num(s.location, 0), 0, 1), opacity: clampN(num(s.opacity, 1), 0, 1), midpoint: clampN(num(s.midpoint, 0.5), 0.01, 0.99) }));
      return { kind: 'gradient-map', params: { gradient: { stops, ...(opacityStops?.length ? { opacityStops } : {}) }, reverse: !!a.reverse, dither: !!a.dither } };
    }
    case 'selective color': {
      const p = defaultParams('selective-color');
      p.method = a.mode === 'absolute' ? 'absolute' : 'relative';
      for (const n of SELECTIVE_RANGES) {
        const c = a[n];
        if (c) p.ranges[n] = { cyan: num(c.c, 0), magenta: num(c.m, 0), yellow: num(c.y, 0), black: num(c.k, 0) };
      }
      return { kind: 'selective-color', params: p };
    }
  }
  return undefined;
}

const rgbColor = (c: readonly number[]) => ({ r: byte(c[0]), g: byte(c[1]), b: byte(c[2]) });

/** ag-psd adjustment record for an editable adjustment layer. */
export function exportPsdAdjustment(spec: AdjustmentSpec | undefined): AdjustmentLayer | undefined {
  const adj = specAdjustment(spec);
  if (!adj) return undefined;
  switch (adj.kind) {
    case 'brightness-contrast':
      return { type: 'brightness/contrast', brightness: Math.round(adj.params.brightness), contrast: Math.round(adj.params.contrast), useLegacy: adj.params.legacy, meanValue: 127, labColorOnly: false };
    case 'levels': {
      const c = (l: Params<'levels'>['rgb']) => ({ shadowInput: Math.round(l.inBlack), highlightInput: Math.round(l.inWhite), shadowOutput: Math.round(l.outBlack), highlightOutput: Math.round(l.outWhite), midtoneInput: Math.round(l.gamma * 100) / 100 });
      const p = adj.params;
      return { type: 'levels', rgb: c(p.rgb), red: c(p.r), green: c(p.g), blue: c(p.b) };
    }
    case 'curves': {
      const ch = (c: Params<'curves'>['rgb']) => {
        // Free-form curves are stored as points sampled from the drawn values.
        const pts = c.mode === 'pencil' && c.values?.length === 256 ? valuesToPoints(c.values) : c.points;
        return pts.map(([x, y]) => ({ input: byte(x), output: byte(y) }));
      };
      const p = adj.params;
      return { type: 'curves', rgb: ch(p.rgb), red: ch(p.r), green: ch(p.g), blue: ch(p.b) };
    }
    case 'exposure':
      return { type: 'exposure', exposure: adj.params.exposure, offset: adj.params.offset, gamma: adj.params.gamma };
    case 'vibrance':
      return { type: 'vibrance', vibrance: Math.round(adj.params.vibrance), saturation: Math.round(adj.params.saturation) };
    case 'hue-saturation': {
      const p = adj.params;
      const r = (n: (typeof HUE_RANGES)[number]) => {
        const q = p.ranges[n];
        return { a: q.range[0], b: q.range[1], c: q.range[2], d: q.range[3], hue: Math.round(q.hue), saturation: Math.round(q.saturation), lightness: Math.round(q.lightness) };
      };
      return {
        type: 'hue/saturation',
        master: { a: p.colorize ? 0x100 : 0, b: Math.round(p.colorizeHue), c: Math.round(p.colorizeSaturation), d: Math.round(p.master.lightness), hue: Math.round(p.master.hue), saturation: Math.round(p.master.saturation), lightness: Math.round(p.master.lightness) },
        reds: r('reds'),
        yellows: r('yellows'),
        greens: r('greens'),
        cyans: r('cyans'),
        blues: r('blues'),
        magentas: r('magentas'),
      };
    }
    case 'color-balance': {
      const t = (v: [number, number, number]) => ({ cyanRed: Math.round(v[0]), magentaGreen: Math.round(v[1]), yellowBlue: Math.round(v[2]) });
      const p = adj.params;
      return { type: 'color balance', shadows: t(p.shadows), midtones: t(p.midtones), highlights: t(p.highlights), preserveLuminosity: p.preserveLuminosity };
    }
    case 'black-white': {
      const p = adj.params;
      const tint = hslToRgb(p.tintHue, p.tintSaturation / 100, 0.5);
      return { type: 'black & white', reds: p.reds, yellows: p.yellows, greens: p.greens, cyans: p.cyans, blues: p.blues, magentas: p.magentas, useTint: p.tint, tintColor: rgbColor([tint[0] * 255, tint[1] * 255, tint[2] * 255]) };
    }
    case 'photo-filter':
      return { type: 'photo filter', color: rgbColor(adj.params.color), density: Math.round(adj.params.density), preserveLuminosity: adj.params.preserveLuminosity };
    case 'channel-mixer': {
      const p = adj.params;
      const row = (m: Params<'channel-mixer'>['red']) => ({ red: Math.round(m.r), green: Math.round(m.g), blue: Math.round(m.b), constant: Math.round(m.constant) });
      return { type: 'channel mixer', monochrome: p.monochrome, red: row(p.red), green: row(p.green), blue: row(p.blue), gray: row(p.gray) };
    }
    case 'color-lookup': {
      const p = adj.params;
      if (!p.source) return undefined;
      const name = p.source.type === 'builtin' ? p.source.id : p.source.name || 'Look';
      // Embedded tables are kept verbatim; built-in looks and partial amounts
      // are baked into a 33-point table.
      const text = p.source.type === 'cube' && p.amount >= 100 ? p.source.text : serializeCubeLut(adjustmentToCubeLut(adj, 33, name));
      return { type: 'color lookup', lookupType: '3dlut', name, lutFormat: 'cube', dataOrder: 'rgb', tableOrder: 'rgb', lut3DFileData: new TextEncoder().encode(text), lut3DFileName: `${name}.cube` };
    }
    // Combined tone and color kinds have no PSD record of their own: they are
    // baked into an embedded color table (a look-alike color lookup layer).
    // Spatial kinds return undefined and export as pixels.
    case 'light-tone':
    case 'color-vibrance': {
      const name = adj.kind === 'light-tone' ? 'Light and Tone' : 'Color and Vibrance';
      const text = serializeCubeLut(adjustmentToCubeLut(adj, 33, name));
      return { type: 'color lookup', lookupType: '3dlut', name, lutFormat: 'cube', dataOrder: 'rgb', tableOrder: 'rgb', lut3DFileData: new TextEncoder().encode(text), lut3DFileName: `${name}.cube` };
    }
    case 'invert':
      return { type: 'invert' };
    case 'posterize':
      return { type: 'posterize', levels: Math.round(adj.params.levels) };
    case 'threshold':
      return { type: 'threshold', level: Math.round(adj.params.level) };
    case 'gradient-map': {
      const g = adj.params.gradient;
      return {
        type: 'gradient map',
        gradientType: 'solid',
        name: 'Gradient',
        smoothness: 1,
        reverse: adj.params.reverse,
        dither: adj.params.dither,
        colorStops: [...g.stops].sort((a, b) => a.location - b.location).map((s) => ({ location: s.location, midpoint: s.midpoint ?? 0.5, color: rgbColor(s.color) })),
        opacityStops: (g.opacityStops?.length ? g.opacityStops : [{ location: 0, opacity: 1 }, { location: 1, opacity: 1 }]).map((s) => ({ location: s.location, midpoint: s.midpoint ?? 0.5, opacity: s.opacity })),
      };
    }
    case 'selective-color': {
      const p = adj.params;
      const c = (n: (typeof SELECTIVE_RANGES)[number]) => ({ c: Math.round(p.ranges[n].cyan), m: Math.round(p.ranges[n].magenta), y: Math.round(p.ranges[n].yellow), k: Math.round(p.ranges[n].black) });
      return {
        type: 'selective color',
        mode: p.method,
        reds: c('reds'),
        yellows: c('yellows'),
        greens: c('greens'),
        cyans: c('cyans'),
        blues: c('blues'),
        magentas: c('magentas'),
        whites: c('whites'),
        neutrals: c('neutrals'),
        blacks: c('blacks'),
      };
    }
  }
  return undefined;
}

/** PSD mask record for a painted layer mask (`maskGrid`), recovered by
 * rendering a white stand-in through the mask. Returns undefined when the
 * layer has no grid mask. */
export async function exportGridMask(
  l: Layer,
  doc: { width: number; height: number },
  render: (layers: Layer[]) => Promise<PixelData>,
): Promise<PsdLayer['mask'] | undefined> {
  if (!l.maskGrid) return undefined;
  const probe: Layer = { ...newLayer('solid', 'mask', doc.width, doc.height), color: '#ffffff', maskGrid: l.maskGrid };
  const px = await render([probe]);
  const max = px.data instanceof Float32Array ? 1 : px.data instanceof Uint16Array ? 65535 : 255;
  const fill = (l.maskGrid.fill ?? 0) / 255;
  const near = (v: number) => Math.abs(v / max - fill) < 0.5 / 255;
  let x0 = doc.width,
    y0 = doc.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < doc.height; y++)
    for (let x = 0; x < doc.width; x++)
      if (!near(px.data[(y * doc.width + x) * 4 + 3])) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const base = { defaultColor: Math.round(fill * 255), disabled: !!l.maskDisabled, inverted: !!l.maskInverted, positionRelativeToLayer: false };
  if (x1 < 0) return { ...base, left: 0, top: 0, right: 0, bottom: 0 };
  const w = x1 - x0 + 1,
    h = y1 - y0 + 1;
  const Ctor = px.data.constructor as Uint8ClampedArrayConstructor;
  const data = new Ctor(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = px.data[((y + y0) * doc.width + x + x0) * 4 + 3],
        o = (y * w + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = max;
    }
  return { ...base, left: x0, top: y0, right: x1 + 1, bottom: y1 + 1, imageData: { width: w, height: h, data } };
}
