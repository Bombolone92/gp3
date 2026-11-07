/**
 * Color match: measure how a clip's frames look (luma level and spread,
 * color cast, colorfulness, tone distribution) and work out the Color tab
 * settings that make another clip look like it. The result is ordinary
 * slider values (exposure, brightness, contrast, temperature, tint,
 * saturation) plus, when the tones differ in shape, a luma curve, so it
 * stays editable. Pure functions, no DOM.
 *
 * Statistics are taken in the same RGB space the grading shader works in,
 * so the slider math below can be solved exactly instead of guessed.
 */
import { packGrade, sampleCurve, effectiveAdjust, ensureGrade, ADJUST_PREFIX } from './color.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Nearest whole slider value (never -0). */
const int = (v) => Math.round(v) || 0;

/** Luma quantiles kept in the statistics (the tone curve is fitted on the inner ones). */
export const QUANTILES = [0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98];
const CURVE_AT = [1, 2, 3, 4, 5]; // indexes into QUANTILES used as curve points

/** Adjust keys a match sets. */
export const MATCH_KEYS = ['exposure', 'brightness', 'contrast', 'temperature', 'tint', 'saturation'];
/** Other light and color sliders, zeroed by a match because it is measured without them. */
export const MATCH_CLEARS = ['highlights', 'shadows', 'whites', 'blacks', 'brilliance', 'vibrance'];

// Per-unit effects of the sliders, as in COLOR_FN (engine/shaders.js).
const EXPOSURE = 0.015; // c *= 2^(exposure * 0.015)
const BRIGHTNESS = 0.0025; // c += brightness * 0.0025
const TEMP = 0.0011; // r += t * 0.0011, b -= t * 0.0011
const TINT_G = 0.0009; // g -= tint * 0.0009
const TINT_RB = 0.0003; // r, b += tint * 0.0003
// How much one unit of temperature or tint moves luma.
const TEMP_LUMA = TEMP * (0.2126 - 0.0722);
const TINT_LUMA = TINT_RB * (0.2126 + 0.0722) - TINT_G * 0.7152;

/**
 * Statistics of RGBA8 frames (all the same size), over the part inside
 * crop ({ l, t, r, b } fractions cut from each side), sampling about
 * `samples` pixels in all:
 *   mean, std:  luma level and spread
 *   q:          luma at QUANTILES
 *   rb, gm:     mean red minus blue, and green minus the red-blue average (the cast)
 *   chroma:     spread of color around gray (how colorful), cast excluded
 */
export function colorStats(frames, { crop = null, samples = 60000 } = {}) {
  const list = frames.filter((f) => f && f.data && f.width > 0 && f.height > 0);
  const bins = 1024;
  const hist = new Uint32Array(bins);
  let n = 0;
  let sl = 0;
  let sll = 0;
  let srb = 0;
  let sgm = 0;
  const sc = [0, 0, 0];
  const scc = [0, 0, 0];
  for (const f of list) {
    const { data, width, height } = f;
    const x0 = Math.floor((crop?.l || 0) * width);
    const x1 = Math.max(x0 + 1, Math.ceil((1 - (crop?.r || 0)) * width));
    const y0 = Math.floor((crop?.t || 0) * height);
    const y1 = Math.max(y0 + 1, Math.ceil((1 - (crop?.b || 0)) * height));
    const area = (x1 - x0) * (y1 - y0);
    const step = Math.max(1, Math.floor(Math.sqrt((area * list.length) / samples)));
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const i = (y * width + x) * 4;
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const l = luma(r, g, b);
        hist[Math.min(bins - 1, Math.floor(l * bins))]++;
        sl += l;
        sll += l * l;
        srb += r - b;
        sgm += g - (r + b) / 2;
        const d = [r - l, g - l, b - l];
        for (let c = 0; c < 3; c++) {
          sc[c] += d[c];
          scc[c] += d[c] * d[c];
        }
        n++;
      }
    }
  }
  if (!n) return { count: 0, mean: 0, std: 0, q: QUANTILES.map(() => 0), rb: 0, gm: 0, chroma: 0 };
  const mean = sl / n;
  let cv = 0;
  for (let c = 0; c < 3; c++) cv += Math.max(0, scc[c] / n - (sc[c] / n) ** 2);
  const q = QUANTILES.map((p) => {
    const target = p * n;
    let acc = 0;
    for (let i = 0; i < bins; i++) {
      acc += hist[i];
      if (acc >= target) return (i + 0.5) / bins;
    }
    return 1;
  });
  return { count: n, mean, std: Math.sqrt(Math.max(0, sll / n - mean * mean)), q, rb: srb / n, gm: sgm / n, chroma: Math.sqrt(cv) };
}

/** How far apart two looks are (0 = same statistics); used to report and test a match. */
export function statsDistance(a, b) {
  const dq = a.q.reduce((s, v, i) => s + (v - b.q[i]) ** 2, 0) / a.q.length;
  return Math.sqrt((a.mean - b.mean) ** 2 + (a.std - b.std) ** 2 + dq + (a.rb - b.rb) ** 2 + (a.gm - b.gm) ** 2 + (a.chroma - b.chroma) ** 2) * 100;
}

/* Grading on the CPU --------------------------------------------------------------- */

/** 256-entry table lookup with linear filtering (like the shader's curve texture). */
function tap(table, x) {
  const p = clamp(x, 0, 1) * 255;
  const i = Math.min(254, Math.floor(p));
  const f = p - i;
  return table[i] + (table[i + 1] - table[i]) * f;
}

/**
 * Apply the parts of a clip's grading that set its overall look to RGBA8
 * pixels: the Light and Color sliders (not brilliance), color wheels,
 * saturation, vibrance, curves and fade, in the shader's order. HSL ranges,
 * LUTs, clarity, vignette and grain are left out. Returns a new array.
 */
export function gradePixels(data, adjust = {}, grade = null) {
  const a = effectiveAdjust({ ...adjust }, grade) || {};
  const v = (k) => Number(a[k]) || 0;
  const exp = 2 ** (v('exposure') * EXPOSURE);
  const bri = v('brightness') * BRIGHTNESS;
  const con = 1 + v('contrast') * 0.01;
  const sh = v('shadows') * 0.003;
  const hi = v('highlights') * 0.003;
  const wh = v('whites') * 0.0035;
  const bl = v('blacks') * 0.003;
  const temp = v('temperature') * TEMP;
  const tint = v('tint');
  const sat = Math.max(0, 1 + v('saturation') * 0.01);
  const vib = v('vibrance') * 0.012;
  const fade = clamp(v('fade') * 0.01, -1, 1);
  const packed = packGrade(grade);
  const wheels = packed?.wheels || null;
  let curves = null;
  if (packed?.curves) {
    const c = packed.curves;
    curves = [c.master, c.red, c.green, c.blue].map((pts) => (pts ? sampleCurve(pts) : null));
  }
  const ss = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const out = new Uint8ClampedArray(data.length);
  const c = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 3; k++) c[k] = ((data[i + k] / 255) * exp + bri - 0.5) * con + 0.5;
    let l = luma(c[0], c[1], c[2]);
    const lift = sh * (1 - ss(0, 0.55, l)) + hi * ss(0.45, 1, l);
    for (let k = 0; k < 3; k++) c[k] += lift;
    if (wh || bl) {
      l = luma(c[0], c[1], c[2]);
      const d = wh * ss(0.5, 1.05, l) + bl * (1 - ss(-0.05, 0.4, l));
      for (let k = 0; k < 3; k++) c[k] += d;
    }
    c[0] += temp + tint * TINT_RB;
    c[1] -= tint * TINT_G;
    c[2] += -temp + tint * TINT_RB;
    if (wheels) {
      for (let k = 0; k < 3; k++) {
        let x = c[k];
        x += wheels.lift[k] * (1 - clamp(x, 0, 1));
        x *= 1 + wheels.gain[k];
        x = Math.max(x, 0) ** (1 / Math.max(1 + wheels.gamma[k], 0.05));
        c[k] = x + wheels.offset[k];
      }
    }
    l = luma(c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) c[k] = l + (c[k] - l) * sat;
    if (vib) {
      const s = clamp(Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]), 0, 1);
      const f = Math.max(0, 1 + vib * (1 - s));
      for (let k = 0; k < 3; k++) c[k] = l + (c[k] - l) * f;
    }
    if (curves) {
      for (let k = 0; k < 3; k++) c[k] = clamp(c[k], 0, 1);
      if (curves[0]) {
        const l0 = luma(c[0], c[1], c[2]);
        const d = tap(curves[0], l0) - l0;
        for (let k = 0; k < 3; k++) c[k] = clamp(c[k] + d, 0, 1);
      }
      for (let k = 0; k < 3; k++) if (curves[k + 1]) c[k] = tap(curves[k + 1], c[k]);
    }
    for (let k = 0; k < 3; k++) {
      let x = c[k];
      if (fade) x += (x * 0.82 + 0.13 - x) * fade;
      out[i + k] = Math.round(clamp(x, 0, 1) * 255);
    }
    out[i + 3] = data[i + 3];
  }
  return out;
}

/* Solving for the sliders ------------------------------------------------------------ */

/**
 * Exposure, brightness and contrast that take luma with mean m and spread
 * sd to targetMean and targetSd. All three make the same kind of straight-
 * line change to luma, so there is a spare degree of freedom: of the
 * settings that fit, pick the one with the smallest slider values.
 * Returns integer slider values and the luma gain they give.
 */
export function fitTone(m, sd, targetMean, targetSd) {
  const g = clamp(targetSd / Math.max(0.01, sd), 0.3, 3);
  let best = null;
  for (let s = 0.3; s <= 2.0001; s += 0.005) {
    const contrast = int((s - 1) * 100);
    const sc = 1 + contrast / 100;
    const exposure = int(clamp(Math.log2(g / sc) / EXPOSURE, -100, 100));
    const k = 2 ** (exposure * EXPOSURE);
    // mean' = sc * (k * m + b - 0.5) + 0.5
    const b = (targetMean - 0.5) / sc + 0.5 - k * m;
    const brightness = int(clamp(b / BRIGHTNESS, -100, 100));
    const gain = sc * k;
    const mean = sc * (k * m + brightness * BRIGHTNESS - 0.5) + 0.5;
    const cost = 1e7 * ((mean - targetMean) ** 2 + (gain * sd - targetSd) ** 2) + 0.01 * (contrast ** 2 + exposure ** 2 + brightness ** 2);
    if (!best || cost < best.cost) best = { cost, exposure, brightness, contrast, gain };
  }
  const { exposure, brightness, contrast, gain } = best;
  return { exposure, brightness, contrast, gain };
}

/**
 * Slider values that move a clip with statistics src toward ref:
 * exposure, brightness and contrast match luma level and spread,
 * saturation matches colorfulness, temperature and tint match the cast.
 * Temperature and tint shift luma a little, which the tone fit makes up for.
 */
export function matchAdjust(src, ref) {
  let shift = 0;
  let out = null;
  for (let pass = 0; pass < 3; pass++) {
    const tone = fitTone(src.mean, src.std, ref.mean - shift, ref.std);
    // Exposure and contrast scale the color around gray along with luma.
    const f = src.chroma > 0.004 ? clamp(ref.chroma / Math.max(1e-4, tone.gain * src.chroma), 0, 2) : 1;
    const saturation = int((f - 1) * 100);
    const fs = 1 + saturation / 100;
    let temperature = 0;
    let tint = 0;
    if (fs > 0.05) {
      // The saturation step scales the cast too, so aim for ref / fs before it.
      temperature = int(clamp((ref.rb / fs - tone.gain * src.rb) / (2 * TEMP), -100, 100));
      tint = int(clamp(-(ref.gm / fs - tone.gain * src.gm) / (TINT_G + TINT_RB), -100, 100));
    }
    shift = temperature * TEMP_LUMA + tint * TINT_LUMA;
    out = { exposure: tone.exposure, brightness: tone.brightness, contrast: tone.contrast, temperature, tint, saturation };
  }
  return out;
}

/**
 * A luma curve taking the tone distribution `have` (luma quantiles after
 * the slider match) to `want`, or null when they already agree within tol.
 * Points sit at the inner quantiles, moves are limited so the curve stays
 * gentle, and the ends stay at black and white.
 */
export function toneCurve(have, want, { tol = 0.015, maxMove = 0.2 } = {}) {
  let worst = 0;
  const pts = [[0, 0]];
  for (const i of CURVE_AT) {
    const x = have.q[i];
    const y = clamp(want.q[i], x - maxMove, x + maxMove);
    worst = Math.max(worst, Math.abs(y - x));
    const last = pts[pts.length - 1];
    if (x < 0.03 || x > 0.97 || x - last[0] < 0.04) continue;
    pts.push([x, Math.max(last[1], y)]);
  }
  if (worst < tol || pts.length < 2) return null;
  const last = pts[pts.length - 1];
  if (1 - last[0] < 0.04) pts.pop();
  pts.push([1, 1]);
  // Keep it rising: no point may sit above white.
  return pts.map(([x, y]) => [int(x * 1000) / 1000, int(Math.min(y, 1) * 1000) / 1000]);
}

/**
 * Work out a match: the slider values, and a luma curve for what the
 * sliders can not reach. refLook ({ adjust, grade }) is the reference
 * clip's own grading, applied to its frames first so the match follows
 * what it looks like on screen. Returns null when there is nothing to
 * measure.
 */
export function colorMatch(srcFrames, refFrames, { srcCrop = null, refCrop = null, refLook = null } = {}) {
  const looked = refLook ? refFrames.map((f) => ({ ...f, data: gradePixels(f.data, refLook.adjust || {}, refLook.grade || null) })) : refFrames;
  const ref = colorStats(looked, { crop: refCrop });
  const src = colorStats(srcFrames, { crop: srcCrop });
  if (src.count < 16 || ref.count < 16) return null;
  const predict = (adjust) => colorStats(srcFrames.map((f) => ({ ...f, data: gradePixels(f.data, adjust) })), { crop: srcCrop });
  let adjust = matchAdjust(src, ref);
  let after = predict(adjust);
  // Clipping at black and white makes the real result fall short of the
  // straight-line math; aim past the target by what was missed and keep
  // whichever try lands closest.
  let aim = ref;
  for (let pass = 0; pass < 3 && statsDistance(after, ref) > 0.5; pass++) {
    aim = {
      ...aim,
      mean: aim.mean + ref.mean - after.mean,
      std: aim.std * (ref.std / Math.max(1e-3, after.std)),
      rb: aim.rb + ref.rb - after.rb,
      gm: aim.gm + ref.gm - after.gm,
      chroma: aim.chroma * (ref.chroma / Math.max(1e-3, after.chroma)),
    };
    const next = matchAdjust(src, aim);
    const tried = predict(next);
    if (statsDistance(tried, ref) >= statsDistance(after, ref)) break;
    adjust = next;
    after = tried;
  }
  let curve = toneCurve(after, ref);
  let final = after;
  if (curve) {
    const curved = colorStats(srcFrames.map((f) => ({ ...f, data: gradePixels(f.data, adjust, { curves: { master: curve } }) })), { crop: srcCrop });
    if (statsDistance(curved, ref) < statsDistance(after, ref)) final = curved;
    else curve = null;
  }
  return { adjust, curve, src, ref, before: statsDistance(src, ref), after: statsDistance(final, ref) };
}

/** A match scaled to strength (0..100): slider values toward 0, the curve toward a straight line. */
export function scaleMatch(match, strength = 100) {
  const k = clamp(strength, 0, 100) / 100;
  const adjust = {};
  for (const key of MATCH_KEYS) adjust[key] = int((match.adjust[key] || 0) * k);
  const curve = match.curve && k > 0 ? match.curve.map(([x, y]) => [x, int((x + (y - x) * k) * 1000) / 1000]) : null;
  return { adjust, curve };
}

/**
 * Write a (scaled) match into a clip, for one undo step: the matched
 * sliders are set, the other light and color sliders are zeroed, their
 * keyframes dropped, and the luma curve replaced. Bypassed Light, Color and
 * Curves sections are turned back on so the match shows.
 */
export function applyMatch(clip, { adjust, curve }) {
  clip.adjust ||= {};
  for (const key of [...MATCH_KEYS, ...MATCH_CLEARS]) {
    clip.adjust[key] = adjust[key] || 0;
    if (clip.keyframes) delete clip.keyframes[ADJUST_PREFIX + key];
  }
  if (curve) {
    const g = ensureGrade(clip);
    g.curves.master = curve.map((p) => [...p]);
    delete g.off.curves;
  } else if (clip.grade?.curves?.master) delete clip.grade.curves.master;
  if (clip.grade?.off) {
    delete clip.grade.off.light;
    delete clip.grade.off.color;
  }
  return clip;
}

/* Reference clips ------------------------------------------------------------------- */

const isPicture = (c) => (c.type === 'video' || c.type === 'image') && Boolean(c.assetId);
const endOf = (c) => c.start + c.duration;

/**
 * Clips a clip can be matched to: every other video and photo clip (in
 * timeline order), plus two shortcuts, `before` (the previous picture on
 * the same track, else the one ending last before it on any track) and
 * `below` (the picture on the nearest lower track overlapping it).
 */
export function matchReferences(project, clipId) {
  let self = null;
  let selfTrack = -1;
  project.tracks.forEach((t, i) => {
    const c = t.clips.find((x) => x.id === clipId);
    if (c) {
      self = c;
      selfTrack = i;
    }
  });
  const all = [];
  project.tracks.forEach((t, ti) => {
    for (const c of t.clips) if (c.id !== clipId && isPicture(c)) all.push({ clip: c, track: ti });
  });
  all.sort((a, b) => a.clip.start - b.clip.start || b.track - a.track);
  if (!self) return { all: all.map((x) => x.clip), before: null, below: null };
  const latest = (list) => list.reduce((best, x) => (!best || endOf(x.clip) > endOf(best.clip) ? x : best), null);
  const earlier = all.filter((x) => endOf(x.clip) <= self.start + 1);
  const before = latest(earlier.filter((x) => x.track === selfTrack)) || latest(earlier);
  const mid = self.start + self.duration / 2;
  const under = all
    .filter((x) => x.track > selfTrack && x.clip.start < endOf(self) && endOf(x.clip) > self.start)
    .sort((a, b) => a.track - b.track || Math.abs(a.clip.start + a.clip.duration / 2 - mid) - Math.abs(b.clip.start + b.clip.duration / 2 - mid));
  return { all: all.map((x) => x.clip), before: before?.clip || null, below: under[0]?.clip || null };
}
