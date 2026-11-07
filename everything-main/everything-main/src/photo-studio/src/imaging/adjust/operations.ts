// Destructive Image > Adjustments commands. Each adjustment kind is mirrored
// through ParamSpec (complex kinds expose their most important controls; the
// dialogs use the typed API). Any operation also accepts a string parameter
// `adjustment` holding a JSON Adjustment of the same kind, which overrides the
// sliders, so recorded actions and Live Filters can carry full settings.
import type { ImageOperation, Mask8, OperationContext, ParamSpec, ParamValues, RGBA8 } from '../types';
import { hexToRgb8, rgb8ToHex } from './color-math';
import { applyAdjustment } from './engine';
import { twoColorGradient, type Gradient, type RGB8 } from './gradient-stops';
import { autoLevels, equalizeMap, histograms } from './histogram';
import { BUILTIN_LOOKS, type BuiltinLookId } from './looks';
import {
  ADJUSTMENT_LABELS,
  defaultParams,
  HUE_RANGES,
  LUMA_GRAY_WEIGHTS,
  PHOTO_FILTER_PRESETS,
  SELECTIVE_RANGES,
  type Adjustment,
  type AdjustmentKind,
  type ChannelKey,
  type PhotoFilterPreset,
  type SelectiveRangeName,
  type HueRangeName,
} from './model';
import { replaceColor } from './replace-color';
import { DEFAULT_SHADOWS_HIGHLIGHTS, shadowsHighlights } from './shadows-highlights';
import { hdrToningOperation } from './hdr-toning';

const num = (p: ParamValues, k: string, d: number) => (typeof p[k] === 'number' && Number.isFinite(p[k]) ? (p[k] as number) : d);
const str = (p: ParamValues, k: string, d: string) => (typeof p[k] === 'string' ? (p[k] as string) : d);
const bool = (p: ParamValues, k: string, d: boolean) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : d);
const rgb = (p: ParamValues, k: string, d: RGB8): RGB8 => (typeof p[k] === 'string' ? hexToRgb8(p[k] as string) : d);

const n = (key: string, label: string, min: number, max: number, def: number, step?: number, unit?: string): ParamSpec => ({
  key,
  label,
  type: 'number',
  min,
  max,
  default: def,
  ...(step !== undefined ? { step } : {}),
  ...(unit ? { unit } : {}),
});
const sel = (key: string, label: string, options: [string, string][], def: string): ParamSpec => ({
  key,
  label,
  type: 'select',
  options: options.map(([value, l]) => ({ value, label: l })),
  default: def,
});
const check = (key: string, label: string, def: boolean): ParamSpec => ({ key, label, type: 'checkbox', default: def });
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

const CHANNELS: [string, string][] = [
  ['rgb', 'RGB'],
  ['r', 'Red'],
  ['g', 'Green'],
  ['b', 'Blue'],
];

function fromJson(p: ParamValues, kind: AdjustmentKind): Adjustment | undefined {
  const raw = p.adjustment;
  if (typeof raw !== 'string') return undefined;
  try {
    const adj = JSON.parse(raw) as Adjustment;
    return adj && adj.kind === kind && adj.params ? adj : undefined;
  } catch {
    return undefined;
  }
}

type Builder<K extends AdjustmentKind> = (p: ParamValues, ctx: OperationContext) => Extract<Adjustment, { kind: K }>['params'];
function kindOp<K extends AdjustmentKind>(kind: K, params: ParamSpec[], build: Builder<K>, immediate = false): ImageOperation {
  return {
    id: `adjust.${kind}`,
    label: ADJUSTMENT_LABELS[kind],
    category: 'Adjustments',
    params,
    ...(immediate ? { immediate } : {}),
    apply(src, values, ctx, progress) {
      const adj = fromJson(values, kind) ?? ({ kind, params: build(values, ctx) } as Adjustment);
      return applyAdjustment(src, adj, ctx.selection, progress);
    },
  };
}

const CURVE_INPUTS = [0, 64, 128, 192, 255];
const GRADIENT_PRESETS: Record<string, { label: string; make: (ctx: OperationContext) => Gradient }> = {
  'foreground-background': { label: 'Foreground to Background', make: (c) => twoColorGradient(c.foreground, c.background) },
  'black-white': { label: 'Black, White', make: () => twoColorGradient([0, 0, 0], [255, 255, 255]) },
  sepia: {
    label: 'Sepia Tone',
    make: () => ({
      stops: [
        { location: 0, color: [28, 16, 8], midpoint: 0.5 },
        { location: 0.55, color: [150, 110, 70], midpoint: 0.5 },
        { location: 1, color: [250, 240, 222], midpoint: 0.5 },
      ],
    }),
  },
  'teal-orange': {
    label: 'Teal to Orange',
    make: () => ({
      stops: [
        { location: 0, color: [8, 30, 40], midpoint: 0.5 },
        { location: 0.5, color: [96, 120, 118], midpoint: 0.5 },
        { location: 1, color: [255, 200, 140], midpoint: 0.5 },
      ],
    }),
  },
};

const MIXER_KEYS = ['red', 'green', 'blue'] as const;
const MIXER_PARAMS: ParamSpec[] = MIXER_KEYS.flatMap((out) => [
  n(`${out}R`, `${cap(out)} from Red`, -200, 200, out === 'red' ? 100 : 0, 1, '%'),
  n(`${out}G`, `${cap(out)} from Green`, -200, 200, out === 'green' ? 100 : 0, 1, '%'),
  n(`${out}B`, `${cap(out)} from Blue`, -200, 200, out === 'blue' ? 100 : 0, 1, '%'),
  n(`${out}Constant`, `${cap(out)} Constant`, -200, 200, 0, 1, '%'),
]);

const kindOperations: ImageOperation[] = [
  kindOp('brightness-contrast', [n('brightness', 'Brightness', -150, 150, 0), n('contrast', 'Contrast', -100, 100, 0), check('legacy', 'Use Legacy', false)], (p) => ({
    brightness: num(p, 'brightness', 0),
    contrast: num(p, 'contrast', 0),
    legacy: bool(p, 'legacy', false),
  })),
  kindOp(
    'levels',
    [
      sel('channel', 'Channel', CHANNELS, 'rgb'),
      n('inBlack', 'Input Black', 0, 253, 0),
      n('gamma', 'Gamma', 0.01, 9.99, 1, 0.01),
      n('inWhite', 'Input White', 2, 255, 255),
      n('outBlack', 'Output Black', 0, 255, 0),
      n('outWhite', 'Output White', 0, 255, 255),
    ],
    (p) => {
      const params = defaultParams('levels');
      params[str(p, 'channel', 'rgb') as ChannelKey] = {
        inBlack: num(p, 'inBlack', 0),
        inWhite: num(p, 'inWhite', 255),
        gamma: num(p, 'gamma', 1),
        outBlack: num(p, 'outBlack', 0),
        outWhite: num(p, 'outWhite', 255),
      };
      return params;
    },
  ),
  kindOp(
    'curves',
    [sel('channel', 'Channel', CHANNELS, 'rgb'), ...CURVE_INPUTS.map((x) => n(`out${x}`, `Output at ${x}`, 0, 255, x))],
    (p) => {
      const params = defaultParams('curves');
      params[str(p, 'channel', 'rgb') as ChannelKey] = { mode: 'points', points: CURVE_INPUTS.map((x) => [x, num(p, `out${x}`, x)]) };
      return params;
    },
  ),
  kindOp('exposure', [n('exposure', 'Exposure', -20, 20, 0, 0.01), n('offset', 'Offset', -0.5, 0.5, 0, 0.0001), n('gamma', 'Gamma Correction', 0.01, 9.99, 1, 0.01)], (p) => ({
    exposure: num(p, 'exposure', 0),
    offset: num(p, 'offset', 0),
    gamma: num(p, 'gamma', 1),
  })),
  kindOp('vibrance', [n('vibrance', 'Vibrance', -100, 100, 0), n('saturation', 'Saturation', -100, 100, 0)], (p) => ({
    vibrance: num(p, 'vibrance', 0),
    saturation: num(p, 'saturation', 0),
  })),
  kindOp(
    'hue-saturation',
    [
      sel('range', 'Range', [['master', 'Master'], ...HUE_RANGES.map((r) => [r, cap(r)] as [string, string])], 'master'),
      n('hue', 'Hue', -180, 180, 0),
      n('saturation', 'Saturation', -100, 100, 0),
      n('lightness', 'Lightness', -100, 100, 0),
      check('colorize', 'Colorize', false),
      n('colorizeHue', 'Colorize Hue', 0, 360, 30),
      n('colorizeSaturation', 'Colorize Saturation', 0, 100, 25),
    ],
    (p) => {
      const params = defaultParams('hue-saturation');
      const amounts = { hue: num(p, 'hue', 0), saturation: num(p, 'saturation', 0), lightness: num(p, 'lightness', 0) };
      const range = str(p, 'range', 'master');
      if (range === 'master' || bool(p, 'colorize', false)) params.master = amounts;
      else if ((HUE_RANGES as readonly string[]).includes(range)) Object.assign(params.ranges[range as HueRangeName], amounts);
      params.colorize = bool(p, 'colorize', false);
      params.colorizeHue = num(p, 'colorizeHue', 30);
      params.colorizeSaturation = num(p, 'colorizeSaturation', 25);
      return params;
    },
  ),
  kindOp(
    'color-balance',
    [
      sel('tone', 'Tone', [['shadows', 'Shadows'], ['midtones', 'Midtones'], ['highlights', 'Highlights']], 'midtones'),
      n('cyanRed', 'Cyan / Red', -100, 100, 0),
      n('magentaGreen', 'Magenta / Green', -100, 100, 0),
      n('yellowBlue', 'Yellow / Blue', -100, 100, 0),
      check('preserveLuminosity', 'Preserve Luminosity', true),
    ],
    (p) => {
      const params = defaultParams('color-balance');
      const tone = str(p, 'tone', 'midtones');
      if (tone === 'shadows' || tone === 'midtones' || tone === 'highlights')
        params[tone] = [num(p, 'cyanRed', 0), num(p, 'magentaGreen', 0), num(p, 'yellowBlue', 0)];
      params.preserveLuminosity = bool(p, 'preserveLuminosity', true);
      return params;
    },
  ),
  kindOp(
    'black-white',
    [
      ...HUE_RANGES.map((r) => n(r, cap(r), -200, 300, LUMA_GRAY_WEIGHTS[r], 1, '%')),
      check('tint', 'Tint', false),
      n('tintHue', 'Tint Hue', 0, 360, 35),
      n('tintSaturation', 'Tint Saturation', 0, 100, 25),
    ],
    (p) => {
      const params = defaultParams('black-white');
      for (const r of HUE_RANGES) params[r] = num(p, r, LUMA_GRAY_WEIGHTS[r]);
      params.tint = bool(p, 'tint', false);
      params.tintHue = num(p, 'tintHue', 35);
      params.tintSaturation = num(p, 'tintSaturation', 25);
      return params;
    },
  ),
  kindOp(
    'photo-filter',
    [
      sel(
        'preset',
        'Filter',
        [...Object.entries(PHOTO_FILTER_PRESETS).map(([k, v]) => [k, v.label] as [string, string]), ['custom', 'Custom Color']],
        'warming',
      ),
      { key: 'color', label: 'Color', type: 'color', default: rgb8ToHex(PHOTO_FILTER_PRESETS.warming.color) },
      n('density', 'Density', 0, 100, 25, 1, '%'),
      check('preserveLuminosity', 'Preserve Luminosity', true),
    ],
    (p) => {
      const preset = str(p, 'preset', 'warming') as PhotoFilterPreset;
      const known = preset !== 'custom' && PHOTO_FILTER_PRESETS[preset];
      return {
        preset: known ? preset : 'custom',
        color: known ? ([...known.color] as RGB8) : rgb(p, 'color', [...PHOTO_FILTER_PRESETS.warming.color] as RGB8),
        density: num(p, 'density', 25),
        preserveLuminosity: bool(p, 'preserveLuminosity', true),
      };
    },
  ),
  kindOp('channel-mixer', [...MIXER_PARAMS, check('monochrome', 'Monochrome (uses the Red row)', false)], (p) => {
    const params = defaultParams('channel-mixer');
    for (const out of MIXER_KEYS)
      params[out] = {
        r: num(p, `${out}R`, out === 'red' ? 100 : 0),
        g: num(p, `${out}G`, out === 'green' ? 100 : 0),
        b: num(p, `${out}B`, out === 'blue' ? 100 : 0),
        constant: num(p, `${out}Constant`, 0),
      };
    params.monochrome = bool(p, 'monochrome', false);
    if (params.monochrome) params.gray = { ...params.red };
    return params;
  }),
  kindOp(
    'color-lookup',
    [sel('look', 'Look', BUILTIN_LOOKS.map((l) => [l.id, l.label]), BUILTIN_LOOKS[0].id), n('amount', 'Amount', 0, 100, 100, 1, '%')],
    (p) => ({ source: { type: 'builtin', id: str(p, 'look', BUILTIN_LOOKS[0].id) as BuiltinLookId }, amount: num(p, 'amount', 100) }),
  ),
  kindOp('invert', [], () => ({}), true),
  kindOp('posterize', [n('levels', 'Levels', 2, 255, 4, 1)], (p) => ({ levels: num(p, 'levels', 4) })),
  kindOp('threshold', [n('level', 'Threshold Level', 1, 255, 128, 1)], (p) => ({ level: num(p, 'level', 128) })),
  kindOp(
    'gradient-map',
    [
      sel('gradient', 'Gradient', Object.entries(GRADIENT_PRESETS).map(([k, v]) => [k, v.label]), 'foreground-background'),
      check('reverse', 'Reverse', false),
      check('dither', 'Dither', false),
    ],
    (p, ctx) => ({
      gradient: (GRADIENT_PRESETS[str(p, 'gradient', 'foreground-background')] ?? GRADIENT_PRESETS['foreground-background']).make(ctx),
      reverse: bool(p, 'reverse', false),
      dither: bool(p, 'dither', false),
    }),
  ),
  kindOp(
    'selective-color',
    [
      sel('range', 'Colors', SELECTIVE_RANGES.map((r) => [r, cap(r)]), 'reds'),
      n('cyan', 'Cyan', -100, 100, 0, 1, '%'),
      n('magenta', 'Magenta', -100, 100, 0, 1, '%'),
      n('yellow', 'Yellow', -100, 100, 0, 1, '%'),
      n('black', 'Black', -100, 100, 0, 1, '%'),
      sel('method', 'Method', [['relative', 'Relative'], ['absolute', 'Absolute']], 'relative'),
    ],
    (p) => {
      const params = defaultParams('selective-color');
      const range = str(p, 'range', 'reds');
      if ((SELECTIVE_RANGES as readonly string[]).includes(range))
        params.ranges[range as SelectiveRangeName] = {
          cyan: num(p, 'cyan', 0),
          magenta: num(p, 'magenta', 0),
          yellow: num(p, 'yellow', 0),
          black: num(p, 'black', 0),
        };
      params.method = str(p, 'method', 'relative') === 'absolute' ? 'absolute' : 'relative';
      return params;
    },
  ),
];

const clipParams = (snap: boolean): ParamSpec[] => [
  n('shadowClip', 'Clip Shadows', 0, 10, 0.1, 0.01, '%'),
  n('highlightClip', 'Clip Highlights', 0, 10, 0.1, 0.01, '%'),
  ...(snap ? [check('snapNeutral', 'Snap Neutral Midtones', true)] : []),
];
function autoOp(mode: 'tone' | 'contrast' | 'color', label: string): ImageOperation {
  return {
    id: `adjust.auto-${mode}`,
    label,
    category: 'Adjustments',
    params: clipParams(mode === 'color'),
    immediate: true,
    apply(src, p, ctx, progress) {
      const levels = autoLevels(src, mode, {
        shadowClip: num(p, 'shadowClip', 0.1),
        highlightClip: num(p, 'highlightClip', 0.1),
        snapNeutral: bool(p, 'snapNeutral', true),
        selection: ctx.selection,
      });
      return applyAdjustment(src, { kind: 'levels', params: levels }, ctx.selection, progress);
    },
  };
}

// Equalize from the selected pixels' histogram; scope decides whether the
// mapping applies only inside the selection or to the whole image.
export function equalize(src: RGBA8, selection?: Mask8, scope: 'selection' | 'entire' = 'selection'): RGBA8 {
  const map = equalizeMap(histograms(src, selection).rgb);
  const params = defaultParams('curves');
  params.rgb = { mode: 'pencil', points: params.rgb.points, values: Array.from(map) };
  return applyAdjustment(src, { kind: 'curves', params }, scope === 'selection' ? selection : undefined);
}

const extraOperations: ImageOperation[] = [
  autoOp('tone', 'Auto Tone'),
  autoOp('contrast', 'Auto Contrast'),
  autoOp('color', 'Auto Color'),
  {
    id: 'adjust.desaturate',
    label: 'Desaturate',
    category: 'Adjustments',
    params: [],
    immediate: true,
    apply(src, _p, ctx, progress) {
      // HSL saturation to zero: gray = (max + min) / 2.
      const params = defaultParams('hue-saturation');
      params.master.saturation = -100;
      return applyAdjustment(src, { kind: 'hue-saturation', params }, ctx.selection, progress);
    },
  },
  {
    id: 'adjust.equalize',
    label: 'Equalize',
    category: 'Adjustments',
    params: [sel('scope', 'With a selection', [['selection', 'Equalize selected area only'], ['entire', 'Equalize entire image based on selection']], 'selection')],
    immediate: true,
    apply(src, p, ctx) {
      return equalize(src, ctx.selection, str(p, 'scope', 'selection') === 'entire' ? 'entire' : 'selection');
    },
  },
  {
    id: 'adjust.shadows-highlights',
    label: 'Shadows/Highlights',
    category: 'Adjustments',
    params: [
      n('shadowsAmount', 'Shadows Amount', 0, 100, DEFAULT_SHADOWS_HIGHLIGHTS.shadowsAmount, 1, '%'),
      n('shadowsTone', 'Shadows Tone', 0, 100, DEFAULT_SHADOWS_HIGHLIGHTS.shadowsTone, 1, '%'),
      n('shadowsRadius', 'Shadows Radius', 0, 2500, DEFAULT_SHADOWS_HIGHLIGHTS.shadowsRadius, 1, 'px'),
      n('highlightsAmount', 'Highlights Amount', 0, 100, DEFAULT_SHADOWS_HIGHLIGHTS.highlightsAmount, 1, '%'),
      n('highlightsTone', 'Highlights Tone', 0, 100, DEFAULT_SHADOWS_HIGHLIGHTS.highlightsTone, 1, '%'),
      n('highlightsRadius', 'Highlights Radius', 0, 2500, DEFAULT_SHADOWS_HIGHLIGHTS.highlightsRadius, 1, 'px'),
      n('colorCorrection', 'Color', -100, 100, DEFAULT_SHADOWS_HIGHLIGHTS.colorCorrection),
      n('midtoneContrast', 'Midtone Contrast', -100, 100, DEFAULT_SHADOWS_HIGHLIGHTS.midtoneContrast),
    ],
    apply(src, p, ctx, progress) {
      const d = DEFAULT_SHADOWS_HIGHLIGHTS;
      return shadowsHighlights(
        src,
        {
          shadowsAmount: num(p, 'shadowsAmount', d.shadowsAmount),
          shadowsTone: num(p, 'shadowsTone', d.shadowsTone),
          shadowsRadius: num(p, 'shadowsRadius', d.shadowsRadius),
          highlightsAmount: num(p, 'highlightsAmount', d.highlightsAmount),
          highlightsTone: num(p, 'highlightsTone', d.highlightsTone),
          highlightsRadius: num(p, 'highlightsRadius', d.highlightsRadius),
          colorCorrection: num(p, 'colorCorrection', d.colorCorrection),
          midtoneContrast: num(p, 'midtoneContrast', d.midtoneContrast),
        },
        ctx.selection,
        progress,
        ctx.scale ?? 1,
      );
    },
  },
  {
    id: 'adjust.replace-color',
    label: 'Replace Color',
    category: 'Adjustments',
    params: [
      { key: 'color', label: 'Sampled Color', type: 'color', default: '#c83c32' },
      n('fuzziness', 'Fuzziness', 0, 200, 40),
      n('hue', 'Hue', -180, 180, 0),
      n('saturation', 'Saturation', -100, 100, 0),
      n('lightness', 'Lightness', -100, 100, 0),
    ],
    apply(src, p, ctx, progress) {
      return replaceColor(
        src,
        {
          color: rgb(p, 'color', [200, 60, 50]),
          fuzziness: num(p, 'fuzziness', 40),
          hue: num(p, 'hue', 0),
          saturation: num(p, 'saturation', 0),
          lightness: num(p, 'lightness', 0),
        },
        ctx.selection,
        progress,
      );
    },
  },
];

export const adjustmentOperations: ImageOperation[] = [...kindOperations, ...extraOperations, hdrToningOperation];
