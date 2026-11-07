// Editors for the slider-based adjustment kinds.
import {
  BUILTIN_LOOKS,
  HUE_RANGES,
  LUMA_GRAY_WEIGHTS,
  PHOTO_FILTER_PRESETS,
  SELECTIVE_RANGES,
  hexToRgb8,
  hueRangeWeight,
  parseCubeLut,
  rgb8ToHex,
  DEFAULT_HUE_RANGES,
  type BlackWhiteParams,
  type BuiltinLookId,
  type HueRangeName,
  type MixerRow,
  type PhotoFilterPreset,
  type RGB8,
  type SelectiveRangeName,
} from '../../imaging/adjust';
import type { AdjustHost } from './host';
import { button, checkbox, grayTrack, h, histogramSvg, hueTrack, select, slider, twoTone } from './ui';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const hueColor: Record<HueRangeName, string> = { reds: '#e33', yellows: '#ec3', greens: '#3b4', cyans: '#3cd', blues: '#36e', magentas: '#d3d' };

export function brightnessContrastEditor(body: HTMLElement, host: AdjustHost<'brightness-contrast'>) {
  const p = host.params;
  const lim = () => (p.legacy ? { b: [-100, 100], c: [-100, 100] } : { b: [-150, 150], c: [-50, 100] });
  const l = lim();
  body.append(
    slider({ label: 'Brightness', min: l.b[0], max: l.b[1], value: p.brightness, track: grayTrack, onInput: (v, c) => ((p.brightness = v), host.change(c)) }).el,
    slider({ label: 'Contrast', min: l.c[0], max: l.c[1], value: p.contrast, track: twoTone('#777', '#000 50%, #fff'), onInput: (v, c) => ((p.contrast = v), host.change(c)) }).el,
    checkbox('Use Legacy', p.legacy, (v) => {
      p.legacy = v;
      const r = lim();
      p.brightness = Math.min(r.b[1], Math.max(r.b[0], p.brightness));
      p.contrast = Math.min(r.c[1], Math.max(r.c[0], p.contrast));
      host.change(true);
      host.rerender();
    }).el,
  );
}

export function exposureEditor(body: HTMLElement, host: AdjustHost<'exposure'>) {
  const p = host.params;
  body.append(
    slider({ label: 'Exposure', min: -20, max: 20, step: 0.01, value: p.exposure, track: grayTrack, onInput: (v, c) => ((p.exposure = v), host.change(c)) }).el,
    slider({ label: 'Offset', min: -0.5, max: 0.5, step: 0.0001, value: p.offset, track: grayTrack, onInput: (v, c) => ((p.offset = v), host.change(c)) }).el,
    slider({ label: 'Gamma Correction', min: 0.01, max: 9.99, step: 0.01, value: p.gamma, log: true, track: twoTone('#fff', '#000'), onInput: (v, c) => ((p.gamma = v), host.change(c)) }).el,
  );
}

export function vibranceEditor(body: HTMLElement, host: AdjustHost<'vibrance'>) {
  const p = host.params;
  const sat = twoTone('#888', '#e33 33%, #3b4 66%, #36e');
  body.append(
    slider({ label: 'Vibrance', min: -100, max: 100, value: p.vibrance, track: sat, onInput: (v, c) => ((p.vibrance = v), host.change(c)) }).el,
    slider({ label: 'Saturation', min: -100, max: 100, value: p.saturation, track: sat, onInput: (v, c) => ((p.saturation = v), host.change(c)) }).el,
  );
}

export function colorBalanceEditor(body: HTMLElement, host: AdjustHost<'color-balance'>) {
  const p = host.params;
  const tone = (host.ui.tone as 'shadows' | 'midtones' | 'highlights') ?? 'midtones';
  const seg = h('div', { class: 'segmented adj-tone', role: 'group', 'aria-label': 'Tone' });
  for (const t of ['shadows', 'midtones', 'highlights'] as const)
    seg.append(
      button(cap(t), () => {
        host.ui.tone = t;
        host.rerender();
      }, { pressed: t === tone, cls: '' }),
    );
  body.append(h('div', { class: 'adj-field-label' }, 'Tone'), seg);
  const pairs: [string, string, string, string][] = [
    ['Cyan', 'Red', '#0cc', '#e33'],
    ['Magenta', 'Green', '#d3d', '#3b4'],
    ['Yellow', 'Blue', '#ec3', '#36e'],
  ];
  pairs.forEach(([a, b, ca, cb], k) => {
    const s = slider({ label: `${a} — ${b}`, min: -100, max: 100, value: p[tone][k], track: twoTone(ca, cb), onInput: (v, c) => ((p[tone][k] = v), host.change(c)) });
    body.append(s.el);
  });
  body.append(checkbox('Preserve Luminosity', p.preserveLuminosity, (v) => ((p.preserveLuminosity = v), host.change(true))).el);
}

// Original weight sets for common photographic looks.
const BW_PRESETS: Record<string, { label: string; w: Record<HueRangeName, number> }> = {
  default: { label: 'Default', w: { ...LUMA_GRAY_WEIGHTS } },
  red: { label: 'Red Filter', w: { reds: 115, yellows: 105, greens: -15, cyans: -45, blues: -40, magentas: 95 } },
  yellow: { label: 'Yellow Filter', w: { reds: 85, yellows: 110, greens: 35, cyans: -10, blues: -25, magentas: 55 } },
  green: { label: 'Green Filter', w: { reds: 25, yellows: 75, greens: 115, cyans: 55, blues: 5, magentas: 15 } },
  blue: { label: 'Blue Filter', w: { reds: -5, yellows: 5, greens: 15, cyans: 105, blues: 125, magentas: 75 } },
  infrared: { label: 'Infrared', w: { reds: -35, yellows: 190, greens: 210, cyans: -35, blues: -55, magentas: -15 } },
  bright: { label: 'Brighter', w: { reds: 60, yellows: 120, greens: 100, cyans: 105, blues: 40, magentas: 70 } },
  dark: { label: 'Darker', w: { reds: 10, yellows: 60, greens: 45, cyans: 50, blues: -10, magentas: 15 } },
};

/** Weights that spread the image's dominant hues across the gray scale:
 * hues whose pixels are brighter on average get larger weights. */
export function autoBlackWhite(img: { data: Uint8ClampedArray }, base: BlackWhiteParams): Record<HueRangeName, number> {
  const sum = Object.fromEntries(HUE_RANGES.map((n) => [n, 0])) as Record<HueRangeName, number>;
  const lum = { ...sum },
    d = img.data;
  const step = Math.max(1, Math.floor(d.length / 4 / 250_000)) * 4;
  for (let i = 0; i < d.length; i += step) {
    if (!d[i + 3]) continue;
    const r = d[i] / 255,
      g = d[i + 1] / 255,
      b = d[i + 2] / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      c = max - min;
    if (c < 0.06) continue;
    let hue = max === r ? (g - b) / c : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
    hue = ((hue * 60) % 360 + 360) % 360;
    for (const n of HUE_RANGES) {
      const w = hueRangeWeight(hue, DEFAULT_HUE_RANGES[n]) * c;
      sum[n] += w;
      lum[n] += w * (max + min) / 2;
    }
  }
  const present = HUE_RANGES.filter((n) => sum[n] > 0);
  const out = Object.fromEntries(HUE_RANGES.map((n) => [n, base[n]])) as Record<HueRangeName, number>;
  if (!present.length) return { ...LUMA_GRAY_WEIGHTS };
  const order = present.sort((a, b) => lum[a] / sum[a] - lum[b] / sum[b]);
  order.forEach((n, i) => (out[n] = Math.round(order.length === 1 ? 60 : 10 + (i / (order.length - 1)) * 110)));
  for (const n of HUE_RANGES) if (!sum[n]) out[n] = Math.round(LUMA_GRAY_WEIGHTS[n]);
  return out;
}

export function blackWhiteEditor(body: HTMLElement, host: AdjustHost<'black-white'>) {
  const p = host.params;
  const match = Object.entries(BW_PRESETS).find(([, v]) => HUE_RANGES.every((n) => Math.abs(v.w[n] - p[n]) < 0.01))?.[0] ?? 'custom';
  const top = h('div', { class: 'adj-row' });
  top.append(
    select('Preset', [...Object.entries(BW_PRESETS).map(([k, v]) => [k, v.label] as [string, string]), ['custom', 'Custom']], match, (v) => {
      const preset = BW_PRESETS[v];
      if (!preset) return;
      Object.assign(p, preset.w);
      host.change(true);
      host.rerender();
    }).el,
    button('Auto', async () => {
      const src = await host.source();
      if (!src) return;
      Object.assign(p, autoBlackWhite(src.image, p));
      host.change(true);
      host.rerender();
    }),
  );
  body.append(top);
  for (const n of HUE_RANGES)
    body.append(slider({ label: cap(n), min: -200, max: 300, value: Math.round(p[n] * 100) / 100, unit: '%', track: twoTone('#000', hueColor[n]), onInput: (v, c) => ((p[n] = v), host.change(c)) }).el);
  body.append(checkbox('Tint', p.tint, (v) => ((p.tint = v), host.change(true), host.rerender())).el);
  if (p.tint)
    body.append(
      slider({ label: 'Hue', min: 0, max: 360, value: p.tintHue, unit: '°', track: hueTrack, onInput: (v, c) => ((p.tintHue = v), host.change(c)) }).el,
      slider({ label: 'Saturation', min: 0, max: 100, value: p.tintSaturation, unit: '%', track: twoTone('#888', `hsl(${p.tintHue} 100% 50%)`), onInput: (v, c) => ((p.tintSaturation = v), host.change(c)) }).el,
    );
}

export function photoFilterEditor(body: HTMLElement, host: AdjustHost<'photo-filter'>) {
  const p = host.params;
  const presets = Object.entries(PHOTO_FILTER_PRESETS).map(([k, v]) => [k, v.label] as [string, string]);
  body.append(
    select('Filter', [...presets, ['custom', 'Custom color']], p.preset, (v) => {
      p.preset = v as PhotoFilterPreset;
      if (v !== 'custom') p.color = [...PHOTO_FILTER_PRESETS[v as Exclude<PhotoFilterPreset, 'custom'>].color] as RGB8;
      host.change(true);
      host.rerender();
    }).el,
  );
  const color = h('label', { class: 'adj-color' });
  color.innerHTML = `<span>Color</span><input type="color" value="${rgb8ToHex(p.color)}" aria-label="Filter color">`;
  const input = color.querySelector('input')!;
  input.addEventListener('input', () => {
    p.color = hexToRgb8(input.value);
    p.preset = 'custom';
    host.change(false);
  });
  input.addEventListener('change', () => {
    p.color = hexToRgb8(input.value);
    p.preset = 'custom';
    host.change(true);
    host.rerender();
  });
  body.append(
    color,
    slider({ label: 'Density', min: 0, max: 100, value: p.density, unit: '%', track: twoTone('#fff', rgb8ToHex(p.color)), onInput: (v, c) => ((p.density = v), host.change(c)) }).el,
    checkbox('Preserve Luminosity', p.preserveLuminosity, (v) => ((p.preserveLuminosity = v), host.change(true))).el,
  );
}

export function channelMixerEditor(body: HTMLElement, host: AdjustHost<'channel-mixer'>) {
  const p = host.params;
  const outs = p.monochrome ? (['gray'] as const) : (['red', 'green', 'blue'] as const);
  let out = (host.ui.output as keyof typeof p) ?? 'red';
  if (!(outs as readonly string[]).includes(out as string)) out = outs[0];
  body.append(
    select('Output Channel', outs.map((k) => [k, cap(k)] as [string, string]), out as string, (v) => {
      host.ui.output = v;
      host.rerender();
    }).el,
  );
  const row = p[out as 'red'] as MixerRow;
  const total = h('div', { class: 'adj-total' });
  const showTotal = () => {
    const t = row.r + row.g + row.b;
    total.textContent = `Total ${t > 0 ? '+' : ''}${Math.round(t)}%`;
    total.classList.toggle('warn', t > 100);
  };
  const tracks = { r: twoTone('#000', '#e33'), g: twoTone('#000', '#3b4'), b: twoTone('#000', '#36e') };
  for (const k of ['r', 'g', 'b'] as const)
    body.append(slider({ label: { r: 'Red', g: 'Green', b: 'Blue' }[k], min: -200, max: 200, value: row[k], unit: '%', track: tracks[k], onInput: (v, c) => ((row[k] = v), showTotal(), host.change(c)) }).el);
  showTotal();
  body.append(
    total,
    slider({ label: 'Constant', min: -200, max: 200, value: row.constant, unit: '%', track: grayTrack, onInput: (v, c) => ((row.constant = v), host.change(c)) }).el,
    checkbox('Monochrome', p.monochrome, (v) => {
      p.monochrome = v;
      host.ui.output = v ? 'gray' : 'red';
      host.change(true);
      host.rerender();
    }).el,
  );
}

export function colorLookupEditor(body: HTMLElement, host: AdjustHost<'color-lookup'>) {
  const p = host.params;
  const s = p.source;
  const current = !s ? '' : s.type === 'builtin' ? `builtin:${s.id}` : 'file';
  const options: [string, string][] = [['', 'None'], ...BUILTIN_LOOKS.map((l) => [`builtin:${l.id}`, l.label] as [string, string])];
  if (s && s.type !== 'builtin') options.push(['file', s.name || 'Loaded table']);
  const file = h('input', { type: 'file', accept: '.cube,text/plain', hidden: '' });
  const error = h('p', { class: 'adj-error', role: 'alert' });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      if (f.size > 64 * 1024 * 1024) throw new Error('The color table file is too large.');
      const text = await f.text();
      parseCubeLut(text);
      p.source = { type: 'cube', name: f.name.replace(/\.cube$/i, ''), text };
      host.change(true);
      host.rerender();
    } catch (err) {
      error.textContent = `Could not load ${f.name}: ${err instanceof Error ? err.message : String(err)}`;
    }
  });
  body.append(
    select('Look', options, current, (v) => {
      if (v === 'file') return;
      p.source = v ? { type: 'builtin', id: v.slice(8) as BuiltinLookId } : null;
      host.change(true);
      host.rerender();
    }).el,
    file,
    button('Load .cube file…', () => file.click(), { icon: 'upload' }),
    error,
    slider({ label: 'Amount', min: 0, max: 100, value: p.amount, unit: '%', onInput: (v, c) => ((p.amount = v), host.change(c)) }).el,
  );
}

export function invertEditor(body: HTMLElement) {
  body.append(h('p', { class: 'adj-note' }, 'Inverts every color channel. There are no settings.'));
}

export function posterizeEditor(body: HTMLElement, host: AdjustHost<'posterize'>) {
  const p = host.params;
  body.append(slider({ label: 'Levels', min: 2, max: 255, value: p.levels, onInput: (v, c) => ((p.levels = v), host.change(c)) }).el);
}

export function thresholdEditor(body: HTMLElement, host: AdjustHost<'threshold'>) {
  const p = host.params;
  const hist = h('div', { class: 'adj-hist-box' }, histogramSvg(null, 'luminosity'));
  const marker = h('div', { class: 'adj-threshold-marker' });
  hist.append(marker);
  const place = () => (marker.style.left = `${(p.level / 255) * 100}%`);
  place();
  void host.source().then((s) => {
    if (s) hist.querySelector('svg')!.outerHTML = histogramSvg(s.hist, 'luminosity');
  });
  body.append(hist, slider({ label: 'Threshold Level', min: 1, max: 255, value: p.level, track: twoTone('#000', '#fff'), onInput: (v, c) => ((p.level = v), place(), host.change(c)) }).el);
}

export function selectiveColorEditor(body: HTMLElement, host: AdjustHost<'selective-color'>) {
  const p = host.params;
  const range = (host.ui.range as SelectiveRangeName) ?? 'reds';
  body.append(
    select('Colors', SELECTIVE_RANGES.map((n) => [n, cap(n)] as [string, string]), range, (v) => {
      host.ui.range = v;
      host.rerender();
    }).el,
  );
  const q = p.ranges[range];
  const tracks = { cyan: twoTone('#fff', '#0bd'), magenta: twoTone('#fff', '#d2a'), yellow: twoTone('#fff', '#ed2'), black: grayTrack.replace('#000,#fff', '#fff,#000') };
  for (const k of ['cyan', 'magenta', 'yellow', 'black'] as const) body.append(slider({ label: cap(k), min: -100, max: 100, value: q[k], unit: '%', track: tracks[k], onInput: (v, c) => ((q[k] = v), host.change(c)) }).el);
  const method = h('div', { class: 'adj-radio', role: 'radiogroup', 'aria-label': 'Method' });
  for (const m of ['relative', 'absolute'] as const) {
    const l = h('label');
    l.innerHTML = `<input type="radio" name="adj-method-${host.dialog ? 'd' : 'p'}" value="${m}" ${p.method === m ? 'checked' : ''}><span>${cap(m)}</span>`;
    l.querySelector('input')!.addEventListener('change', () => ((p.method = m), host.change(true)));
    method.append(l);
  }
  body.append(method);
}

// Light & Tone, Color & Vibrance, Clarity & Dehaze and Grain share one shape:
// a column of sliders over named parameters, with a heading per group.
type SliderSpec<P> = { key: keyof P & string; label: string; min: number; max: number; step?: number; track?: string; unit?: string };
function sliderGroups<P extends Record<string, number>>(body: HTMLElement, host: { params: P; change(commit: boolean): void }, groups: [string, SliderSpec<P>[]][]) {
  for (const [title, specs] of groups) {
    if (title) body.append(h('div', { class: 'adj-field-label' }, title));
    for (const s of specs)
      body.append(
        slider({
          label: s.label, min: s.min, max: s.max, step: s.step, unit: s.unit, value: host.params[s.key], track: s.track,
          onInput: (v, c) => (((host.params as Record<string, number>)[s.key] = v), host.change(c)),
        }).el,
      );
  }
}

export function lightToneEditor(body: HTMLElement, host: AdjustHost<'light-tone'>) {
  sliderGroups(body, host, [
    ['', [{ key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01, track: grayTrack }, { key: 'contrast', label: 'Contrast', min: -100, max: 100, track: twoTone('#777', '#000 50%, #fff') }]],
    ['Tones', [
      { key: 'highlights', label: 'Highlights', min: -100, max: 100, track: twoTone('#999', '#fff') },
      { key: 'shadows', label: 'Shadows', min: -100, max: 100, track: twoTone('#000', '#666') },
      { key: 'whites', label: 'Whites', min: -100, max: 100, track: twoTone('#bbb', '#fff') },
      { key: 'blacks', label: 'Blacks', min: -100, max: 100, track: twoTone('#000', '#444') },
    ]],
  ]);
}

export function colorVibranceEditor(body: HTMLElement, host: AdjustHost<'color-vibrance'>) {
  const sat = twoTone('#888', '#e33 33%, #3b4 66%, #36e');
  sliderGroups(body, host, [
    ['White Balance', [
      { key: 'temperature', label: 'Temperature', min: -100, max: 100, track: twoTone('#4a7fe0', '#e0b04a') },
      { key: 'tint', label: 'Tint', min: -100, max: 100, track: twoTone('#4cbf50', '#cf4cc8') },
    ]],
    ['Color', [
      { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, track: sat },
      { key: 'saturation', label: 'Saturation', min: -100, max: 100, track: sat },
    ]],
  ]);
}

export function clarityDehazeEditor(body: HTMLElement, host: AdjustHost<'clarity-dehaze'>) {
  sliderGroups(body, host, [
    ['', [
      { key: 'clarity', label: 'Clarity', min: -100, max: 100, track: twoTone('#888', '#000 50%, #fff') },
      { key: 'dehaze', label: 'Dehaze', min: -100, max: 100, track: twoTone('#d8dde2', '#2a4058') },
    ]],
  ]);
}

export function grainEditor(body: HTMLElement, host: AdjustHost<'grain'>) {
  sliderGroups(body, host, [
    ['', [
      { key: 'amount', label: 'Amount', min: 0, max: 100, track: grayTrack },
      { key: 'size', label: 'Size', min: 0, max: 100 },
      { key: 'roughness', label: 'Roughness', min: 0, max: 100 },
      { key: 'color', label: 'Color', min: 0, max: 100, track: twoTone('#888', '#e33 33%, #3b4 66%, #36e') },
    ]],
  ]);
}
