import type { Layer } from './document';

// Advanced blending options of a layer (Layer Style → Blending Options).
//
// Blend If: per channel, a layer pixel shows only where its own value ("this
// layer") and the value of the composite under it ("underlying") fall inside
// a range. A range is [black low, black high, white low, white high] in
// 0..255 levels: below `black low` hides, `black low`..`black high` fades in,
// `white low`..`white high` fades out, above `white high` hides. A split pair
// (low < high) gives a smooth transition. The weights of every channel
// (gray and the color channels) multiply.
export type BlendRange = [number, number, number, number];
export type BlendIfChannel = 'gray' | 'red' | 'green' | 'blue';
export const blendIfChannels: BlendIfChannel[] = ['gray', 'red', 'green', 'blue'];
export type ChannelRanges = { this: BlendRange; underlying: BlendRange };
export type AdvancedBlending = {
  ranges?: Partial<Record<BlendIfChannel, ChannelRanges>>;
  // Color channels the layer leaves untouched (the result keeps the
  // underlying value there).
  exclude?: { r?: boolean; g?: boolean; b?: boolean };
  // Knockout: inside the layer's shape the backdrop is replaced by the
  // bottom of the enclosing group (shallow) or the Background layer (deep).
  knockout?: 'shallow' | 'deep';
  // Interior effects (overlays, satin, inner glow, inner shadow) fade with
  // fill opacity together with the layer content.
  interiorAsGroup?: boolean;
  // false: clipped layers blend with the backdrop directly instead of
  // compositing with the base first (default true).
  clippedAsGroup?: boolean;
  // The mask cuts off effects too, rather than shaping the content they are
  // drawn from.
  maskHidesEffects?: boolean;
  vectorMaskHidesEffects?: boolean;
};

export const fullRange = (): BlendRange => [0, 0, 255, 255];
export const openRanges = (): ChannelRanges => ({ this: fullRange(), underlying: fullRange() });
const isFull = (r: BlendRange) => r[0] <= 0 && r[1] <= 0 && r[2] >= 255 && r[3] >= 255;

/** Orders and clamps a range: integers in 0..255 with low <= high on each side
 * and the black pair left of the white pair. */
export function normalizeRange(r: readonly number[]): BlendRange {
  const v = [0, 1, 2, 3].map((i) => Math.max(0, Math.min(255, Math.round(Number.isFinite(r[i]) ? r[i] : i < 2 ? 0 : 255))));
  const b0 = Math.min(v[0], v[1]), b1 = Math.max(v[0], v[1]);
  const w0 = Math.min(v[2], v[3]), w1 = Math.max(v[2], v[3]);
  // The white pair cannot fall left of the black pair.
  return [b0, b1, Math.max(w0, b0), Math.max(w1, b1)];
}

/** Moves handle `h` of a Blend If range to `v`. A joined pair moves together
 * unless `split` (Alt) is held; a split pair moves one half at a time. */
export function moveRangeHandle(r: BlendRange, h: number, v: number, split: boolean): BlendRange {
  const out: BlendRange = [...r];
  const pair = h < 2 ? 0 : 2;
  const joined = r[pair] === r[pair + 1];
  v = Math.round(Math.max(0, Math.min(255, v)));
  if (joined && !split) {
    // The black pair stays left of the white pair and vice versa.
    v = pair === 0 ? Math.min(v, r[2]) : Math.max(v, r[1]);
    out[pair] = out[pair + 1] = v;
  } else {
    const lo = h === 0 ? 0 : h === 1 ? r[0] : h === 2 ? r[1] : r[2];
    const hi = h === 0 ? r[1] : h === 1 ? r[2] : h === 2 ? r[3] : 255;
    out[h] = Math.max(lo, Math.min(hi, v));
  }
  return normalizeRange(out);
}

/** Visibility weight (0..1) of a level `v` (0..255) inside a range. */
export function rangeWeight(v: number, r: BlendRange): number {
  const lo = r[1] > r[0] ? Math.min(1, Math.max(0, (v - r[0]) / (r[1] - r[0]))) : v >= r[0] ? 1 : 0;
  const hi = r[3] > r[2] ? Math.min(1, Math.max(0, (r[3] - v) / (r[3] - r[2]))) : v <= r[3] ? 1 : 0;
  return lo * hi;
}
// Levels are compared as integers; colors are in 0..1 (clamped).
export const level = (c: number) => Math.floor(Math.max(0, Math.min(1, c)) * 255 + 0.5);
export const grayOf = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

/** Combined Blend If weight of a layer color over an underlying color
 * (straight RGB in 0..1). The compositor shaders implement the same formula. */
export function blendIfWeight(blending: AdvancedBlending | undefined, src: readonly number[], under: readonly number[]): number {
  const ranges = blending?.ranges;
  if (!ranges) return 1;
  let w = 1;
  for (const ch of blendIfChannels) {
    const r = ranges[ch];
    if (!r) continue;
    const s = ch === 'gray' ? grayOf(src[0], src[1], src[2]) : src[blendIfChannels.indexOf(ch) - 1];
    const u = ch === 'gray' ? grayOf(under[0], under[1], under[2]) : under[blendIfChannels.indexOf(ch) - 1];
    w *= rangeWeight(level(s), r.this) * rangeWeight(level(u), r.underlying);
  }
  return w;
}

/** Drops default values; returns undefined when nothing is set. */
export function cleanBlending(b: AdvancedBlending | undefined): AdvancedBlending | undefined {
  if (!b) return undefined;
  const out: AdvancedBlending = {};
  const ranges: AdvancedBlending['ranges'] = {};
  for (const ch of blendIfChannels) {
    const r = b.ranges?.[ch];
    if (!r) continue;
    const t = normalizeRange(r.this), u = normalizeRange(r.underlying);
    if (!isFull(t) || !isFull(u)) ranges[ch] = { this: t, underlying: u };
  }
  if (Object.keys(ranges).length) out.ranges = ranges;
  if (b.exclude && (b.exclude.r || b.exclude.g || b.exclude.b)) {
    out.exclude = {};
    for (const k of ['r', 'g', 'b'] as const) if (b.exclude[k]) out.exclude[k] = true;
  }
  if (b.knockout === 'shallow' || b.knockout === 'deep') out.knockout = b.knockout;
  if (b.interiorAsGroup) out.interiorAsGroup = true;
  if (b.clippedAsGroup === false) out.clippedAsGroup = false;
  if (b.maskHidesEffects) out.maskHidesEffects = true;
  if (b.vectorMaskHidesEffects) out.vectorMaskHidesEffects = true;
  return Object.keys(out).length ? out : undefined;
}

/** Whether the layer's mask cuts off its effects (the vector mask, when the
 * layer has one, is the mask the renderer draws). */
export function maskHidesEffects(l: Layer): boolean {
  const b = l.blending;
  if (!b) return false;
  return l.vectorMask ? !!b.vectorMaskHidesEffects : !!b.maskHidesEffects;
}

export function validateBlending(b: unknown) {
  if (b === undefined) return;
  const fail = () => {
    throw new Error('Invalid advanced blending options.');
  };
  if (!b || typeof b !== 'object') fail();
  const v = b as AdvancedBlending;
  const range = (r: unknown) =>
    Array.isArray(r) && r.length === 4 && r.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) && r[0] <= r[1] && r[2] <= r[3];
  if (v.ranges !== undefined) {
    if (!v.ranges || typeof v.ranges !== 'object') fail();
    for (const [k, r] of Object.entries(v.ranges))
      if (!blendIfChannels.includes(k as BlendIfChannel) || !r || !range(r.this) || !range(r.underlying)) fail();
  }
  if (v.exclude !== undefined && (!v.exclude || typeof v.exclude !== 'object' || Object.entries(v.exclude).some(([k, x]) => !['r', 'g', 'b'].includes(k) || typeof x !== 'boolean'))) fail();
  if (v.knockout !== undefined && v.knockout !== 'shallow' && v.knockout !== 'deep') fail();
  for (const k of ['interiorAsGroup', 'clippedAsGroup', 'maskHidesEffects', 'vectorMaskHidesEffects'] as const)
    if (v[k] !== undefined && typeof v[k] !== 'boolean') fail();
}

// Compositor uniforms (see renderer/shaders.ts): eight vec4 ranges from float
// 48 (gray this, gray underlying, red this, …, blue underlying) in levels,
// then float 80 = Blend If on, 81..83 = red/green/blue excluded.
export const BLEND_IF_UNIFORM = 48;
export function blendingUniforms(l: Pick<Layer, 'blending'>, u: Float32Array) {
  const b = l.blending;
  if (!b) return;
  if (b.ranges) {
    blendIfChannels.forEach((ch, i) => {
      const r = b.ranges![ch] ?? openRanges();
      u.set(r.this, BLEND_IF_UNIFORM + i * 8);
      u.set(r.underlying, BLEND_IF_UNIFORM + i * 8 + 4);
    });
    u[80] = 1;
  }
  if (b.exclude) {
    u[81] = b.exclude.r ? 1 : 0;
    u[82] = b.exclude.g ? 1 : 0;
    u[83] = b.exclude.b ? 1 : 0;
  }
}

// Blend If and excluded channels change the pixels a layer contributes.
export const hasBlendIf = (l: Pick<Layer, 'blending'>) => !!l.blending?.ranges || !!(l.blending?.exclude && (l.blending.exclude.r || l.blending.exclude.g || l.blending.exclude.b));

// PSD interchange: ag-psd blendingRanges (gray then one entry per color
// channel) and channel blending restrictions (excluded channel indices).
export type PsdBlendingRanges = {
  compositeGrayBlendSource: number[];
  compositeGraphBlendDestinationRange: number[];
  ranges: { sourceRange: number[]; destRange: number[] }[];
};
export function blendingToPsd(b: AdvancedBlending | undefined): PsdBlendingRanges | undefined {
  if (!b?.ranges) return undefined;
  const r = (ch: BlendIfChannel) => b.ranges![ch] ?? openRanges();
  return {
    compositeGrayBlendSource: [...r('gray').this],
    compositeGraphBlendDestinationRange: [...r('gray').underlying],
    ranges: (['red', 'green', 'blue'] as const).map((ch) => ({ sourceRange: [...r(ch).this], destRange: [...r(ch).underlying] })),
  };
}
export function blendingFromPsd(p: PsdBlendingRanges | undefined): AdvancedBlending['ranges'] | undefined {
  if (!p) return undefined;
  const ranges: AdvancedBlending['ranges'] = {
    gray: { this: normalizeRange(p.compositeGrayBlendSource ?? []), underlying: normalizeRange(p.compositeGraphBlendDestinationRange ?? []) },
  };
  (['red', 'green', 'blue'] as const).forEach((ch, i) => {
    const e = p.ranges?.[i];
    if (e) ranges[ch] = { this: normalizeRange(e.sourceRange ?? []), underlying: normalizeRange(e.destRange ?? []) };
  });
  return cleanBlending({ ranges })?.ranges;
}
