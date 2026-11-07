// Mixer brush: a brush that carries paint. The reservoir holds the loaded
// paint (a solid color or a sampled image the size of the tip) and runs dry
// along a stroke; the tip holds paint picked up from the canvas, which moves
// with the brush, so colors drag and blend along the stroke. Deposited paint
// mixes the two subtractively, so blue and yellow make green rather than gray.
//
// Mixing uses a single-constant Kubelka–Munk model per channel: reflectance R
// maps to an absorption/scattering ratio k = (1 − R)² / 2R, ratios mix
// linearly by paint amount, and R = 1 + k − √(k² + 2k) maps back.

export type MixerSettings = {
  // Fractions in [0, 1].
  wet: number; // how much canvas paint the tip picks up
  load: number; // reservoir capacity: high load paints longer strokes
  mix: number; // share of picked-up paint in the deposited color
  flow: number; // how fast paint leaves the brush
};
export const mixerPresets: { id: string; label: string; settings: Omit<MixerSettings, 'flow'> | null }[] = [
  { id: 'custom', label: 'Custom', settings: null },
  { id: 'dry', label: 'Dry', settings: { wet: 0, load: 0.5, mix: 0 } },
  { id: 'dry-light', label: 'Dry, Light Load', settings: { wet: 0, load: 0.15, mix: 0 } },
  { id: 'dry-heavy', label: 'Dry, Heavy Load', settings: { wet: 0, load: 0.9, mix: 0 } },
  { id: 'moist', label: 'Moist', settings: { wet: 0.1, load: 0.5, mix: 0.5 } },
  { id: 'moist-light', label: 'Moist, Light Load', settings: { wet: 0.1, load: 0.15, mix: 0.5 } },
  { id: 'moist-heavy', label: 'Moist, Heavy Load', settings: { wet: 0.1, load: 0.9, mix: 0.5 } },
  { id: 'wet', label: 'Wet', settings: { wet: 0.5, load: 0.5, mix: 0.5 } },
  { id: 'wet-light', label: 'Wet, Light Load', settings: { wet: 0.5, load: 0.15, mix: 0.5 } },
  { id: 'wet-heavy', label: 'Wet, Heavy Load', settings: { wet: 0.5, load: 0.9, mix: 0.5 } },
  { id: 'very-wet', label: 'Very Wet', settings: { wet: 1, load: 0.5, mix: 1 } },
  { id: 'very-wet-light', label: 'Very Wet, Light Load', settings: { wet: 1, load: 0.15, mix: 1 } },
  { id: 'very-wet-heavy', label: 'Very Wet, Heavy Load', settings: { wet: 1, load: 0.9, mix: 1 } },
];

const toK = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const r = Math.max(0.002, i / 255);
  toK[i] = ((1 - r) * (1 - r)) / (2 * r);
}
const fromK = (k: number) => Math.max(0, Math.min(255, (1 + k - Math.sqrt(k * k + 2 * k)) * 255));
/** Subtractive mix of two colors (0..255 channels) with weights wa and wb. */
export function mixPaint(a: ArrayLike<number>, wa: number, b: ArrayLike<number>, wb: number, out: number[] | Uint8ClampedArray = [0, 0, 0]) {
  const t = wa + wb;
  if (t <= 0) {
    out[0] = a[0]; out[1] = a[1]; out[2] = a[2];
    return out;
  }
  const fa = wa / t,
    fb = wb / t;
  for (let c = 0; c < 3; c++) out[c] = fromK(toK[Math.round(a[c])] * fa + toK[Math.round(b[c])] * fb);
  return out;
}

/** Paint held by the brush between dabs. Buffers are tip-sized squares
 * centred on the dab; each pixel stores RGB and an amount in [0, 1]. */
export class MixerBrush {
  size = 0;
  private res = new Float32Array(0); // reservoir RGB + amount
  private tip = new Float32Array(0); // picked-up RGB + amount
  // Remaining paint in the reservoir (scales every reservoir amount).
  level = 1;
  private cx = 0;
  private cy = 0;
  private solid?: [number, number, number];
  private scratch = [0, 0, 0];
  constructor(size: number) {
    this.resize(size);
  }
  resize(size: number) {
    const n = Math.max(1, Math.ceil(size) + 2);
    if (n === this.size) return;
    const old = { size: this.size, res: this.res, tip: this.tip };
    this.size = n;
    this.res = new Float32Array(n * n * 4);
    this.tip = new Float32Array(n * n * 4);
    // Keep the paint where the old tip overlaps the new one (centered).
    const d = Math.floor((n - old.size) / 2);
    for (let y = 0; y < old.size; y++)
      for (let x = 0; x < old.size; x++) {
        const nx = x + d,
          ny = y + d;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        this.res.set(old.res.subarray((y * old.size + x) * 4, (y * old.size + x) * 4 + 4), (ny * n + nx) * 4);
        this.tip.set(old.tip.subarray((y * old.size + x) * 4, (y * old.size + x) * 4 + 4), (ny * n + nx) * 4);
      }
    if (this.solid) this.loadColor(this.solid);
  }
  /** Fill the reservoir with one color. */
  loadColor(rgb: [number, number, number]) {
    this.solid = [...rgb];
    for (let i = 0; i < this.res.length; i += 4) this.res.set([rgb[0], rgb[1], rgb[2], 1], i);
    this.level = 1;
  }
  /** Load the reservoir with an image the size of the tip (row-major RGBA). */
  loadImage(rgba: Uint8ClampedArray, width: number, height: number) {
    this.solid = undefined;
    const n = this.size;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const sx = Math.min(width - 1, Math.floor(((x + 0.5) / n) * width)),
          sy = Math.min(height - 1, Math.floor(((y + 0.5) / n) * height));
        const i = (sy * width + sx) * 4;
        this.res.set([rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3] / 255], (y * n + x) * 4);
      }
    this.level = 1;
  }
  /** Empty the reservoir (and the tip). */
  clean(reservoir = true) {
    this.tip.fill(0);
    if (reservoir) {
      this.res.fill(0);
      this.solid = undefined;
      this.level = 0;
    }
  }
  /** Average loaded color (the option bar swatch), or undefined when empty. */
  loadedColor(): [number, number, number] | undefined {
    if (this.solid) return this.level > 0 ? [...this.solid] : undefined;
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < this.res.length; i += 4) {
      const w = this.res[i + 3];
      r += this.res[i] * w;
      g += this.res[i + 1] * w;
      b += this.res[i + 2] * w;
      a += w;
    }
    return a > 0 && this.level > 0 ? [r / a, g / a, b / a] : undefined;
  }
  private last?: [number, number];
  /** Start a dab at (cx, cy); the reservoir drains with the distance painted. */
  dab(cx: number, cy: number, s: MixerSettings) {
    this.cx = Math.round(cx);
    this.cy = Math.round(cy);
    // In brush diameters; a full load lasts dozens, a light load a few.
    const travel = this.last ? Math.hypot(cx - this.last[0], cy - this.last[1]) / Math.max(1, this.size - 2) : 0;
    this.last = [cx, cy];
    // Pickup and deposit rates are per brush diameter of travel, so the
    // result does not depend on how closely dabs are spaced.
    this.step = Math.max(travel, this.first ? 0.25 : 0.02);
    this.first = false;
    this.level = Math.max(0, this.level - travel * s.flow * (0.01 + 0.25 * (1 - s.load) ** 2));
  }
  /** Forget the previous dab position (a new stroke starts). */
  lift() {
    this.last = undefined;
    this.first = true;
  }
  private step = 0.25;
  private first = true;
  // Fraction of `perDiameter` applied over this dab's travel.
  private rate(perDiameter: number) {
    return 1 - Math.pow(1 - Math.min(0.995, Math.max(0, perDiameter)), this.step);
  }
  /** Paint one pixel: `cur` is the canvas pixel, `under` the color the tip
   * picks up there (the canvas, or the merged image below), `alpha` tip coverage. */
  pixel(x: number, y: number, alpha: number, cur: ArrayLike<number>, under: ArrayLike<number>, s: MixerSettings, out: Uint8ClampedArray) {
    out[0] = cur[0]; out[1] = cur[1]; out[2] = cur[2]; out[3] = cur[3];
    if (alpha <= 0) return;
    const n = this.size,
      h = n >> 1;
    const u = x - this.cx + h,
      v = y - this.cy + h;
    if (u < 0 || v < 0 || u >= n || v >= n) return;
    const i = (v * n + u) * 4;
    const tip = this.tip,
      res = this.res;
    // Pick up wet paint from the canvas into the tip.
    const ua = (under[3] ?? 255) / 255;
    if (s.wet > 0 && ua > 0) {
      const k = this.rate(s.wet * alpha) * ua;
      const ta = tip[i + 3];
      const na = ta + (1 - ta) * k;
      if (na > 0) {
        if (ta > 0) {
          mixPaint([tip[i], tip[i + 1], tip[i + 2]], ta * (1 - k), under, k, this.scratch);
          tip[i] = this.scratch[0]; tip[i + 1] = this.scratch[1]; tip[i + 2] = this.scratch[2];
        } else {
          tip[i] = under[0]; tip[i + 1] = under[1]; tip[i + 2] = under[2];
        }
        tip[i + 3] = na;
      }
    }
    // Deposit: reservoir paint and picked-up paint in the chosen ratio.
    // Paint flows fully until the reservoir is nearly empty, then fades out.
    const ra = res[i + 3] * Math.min(1, this.level * 3) * (1 - s.mix),
      ta = tip[i + 3] * s.mix;
    const amount = Math.min(1, ra + ta);
    if (amount <= 0) return;
    const color = ta <= 0 ? [res[i], res[i + 1], res[i + 2]] : ra <= 0 ? [tip[i], tip[i + 1], tip[i + 2]] : mixPaint([res[i], res[i + 1], res[i + 2]], ra, [tip[i], tip[i + 1], tip[i + 2]], ta, this.scratch);
    const a = this.rate(alpha * amount);
    const ba = cur[3] / 255;
    const oa = a + ba * (1 - a);
    if (oa <= 0) return;
    // Wet paint mixes subtractively with the paint it lands on; dry paint covers it.
    if (ba > 0 && s.wet > 0) {
      const m = mixPaint(color, a, cur, ba * (1 - a), [0, 0, 0]);
      out[0] = m[0]; out[1] = m[1]; out[2] = m[2];
    } else for (let c = 0; c < 3; c++) out[c] = (color[c] * a + cur[c] * ba * (1 - a)) / oa;
    out[3] = oa * 255;
    // Depositing uses up a little of the tip's picked-up paint.
    if (ta > 0) tip[i + 3] *= 1 - this.rate(alpha * s.flow * 0.3);
  }
}
