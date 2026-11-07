/**
 * Flicker removal: measure the brightness of each frame, split it into the
 * slow changes that belong to the shot (clouds, a light switched on, a cut)
 * and the quick wobble on top, and turn the wobble into exposure keyframes
 * that cancel it. Exposure multiplies the picture by 2^(units * 0.015), so
 * a brightness ratio maps straight to slider units.
 */
import { US } from '../lib/time.js';
import { sourceTimeAt } from '../model/timeline.js';
import { rgbaFrames } from './frame-sampler.js';

export const FL_W = 32;
export const FL_H = 18;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Mean luma (0..1) of an RGBA8 frame. */
export function meanLuma(data) {
  let s = 0;
  const n = data.length >> 2;
  for (let i = 0; i < data.length; i += 4) s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  return n ? s / n / 255 : 0;
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Where the brightness really jumps (a cut, a light switched on): the
 * median level over k frames after an index differs from the k before by
 * more than `threshold` stops. Medians ignore single-frame flashes and the
 * wobble itself; inside each stretch over the threshold the biggest
 * frame-to-frame jump is the cut. Values are log2 brightness.
 */
export function cutPoints(logs, { k = 3, threshold = 0.3 } = {}) {
  const cuts = [];
  let run = null;
  const close = () => {
    if (!run) return;
    let best = run[0];
    for (let i = run[0]; i <= run[1]; i++) if (Math.abs(logs[i] - logs[i - 1]) > Math.abs(logs[best] - logs[best - 1])) best = i;
    cuts.push(best);
    run = null;
  };
  for (let i = k; i <= logs.length - k; i++) {
    const d = Math.abs(median(logs.slice(i, i + k)) - median(logs.slice(i - k, i)));
    if (d > threshold) run = run ? [run[0], i] : [i, i];
    else close();
  }
  close();
  return cuts;
}

/**
 * Local straight-line fit through values[lo..hi) evaluated at i: averages
 * the wobble away while keeping steady ramps, even where the window is cut
 * short at the ends.
 */
function lineAt(values, lo, hi, i) {
  const n = hi - lo;
  let sx = 0;
  let sy = 0;
  for (let j = lo; j < hi; j++) {
    sx += j;
    sy += values[j];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (let j = lo; j < hi; j++) {
    sxy += (j - mx) * (values[j] - my);
    sxx += (j - mx) * (j - mx);
  }
  return sxx > 0 ? my + (sxy / sxx) * (i - mx) : my;
}

/**
 * The slow part of a brightness series: split at real jumps (cutPoints),
 * then a running straight-line fit over 2 * radius + 1 frames inside each
 * piece, in log brightness so that flicker, which multiplies, averages out
 * evenly.
 */
export function steadyLevel(values, radius) {
  const logs = values.map((v) => Math.log2(Math.max(1e-4, v)));
  const r = Math.max(1, radius);
  const edges = [0, ...cutPoints(logs, { k: Math.max(2, Math.min(4, r)) }), logs.length];
  const out = new Array(logs.length);
  for (let s = 0; s < edges.length - 1; s++) {
    const a = edges[s];
    const b = edges[s + 1];
    for (let i = a; i < b; i++) out[i] = 2 ** lineAt(logs, Math.max(a, i - r), Math.min(b, i + r + 1), i);
  }
  return out;
}

/**
 * Exposure corrections (slider units) that bring each frame to the steady
 * level. Near-black frames (where a ratio means little) and wobble under
 * `floor` units are left alone; corrections stay within ±maxUnits.
 */
export function flickerCorrections(lumas, { radius = 6, maxUnits = 40, minLuma = 0.03, floor = 0.3 } = {}) {
  const level = steadyLevel(lumas, radius);
  return lumas.map((l, i) => {
    if (l < minLuma || level[i] < minLuma) return 0;
    const u = Math.log2(level[i] / l) / 0.015;
    return Math.abs(u) < floor ? 0 : clamp(u, -maxUnits, maxUnits);
  });
}

/** Brightness after an exposure correction (for checking a result). */
export const corrected = (lumas, units) => lumas.map((l, i) => l * 2 ** ((units[i] || 0) * 0.015));

/** How much a brightness series wobbles: mean size of the frame-to-frame change, in stops. */
export function wobble(lumas) {
  let s = 0;
  for (let i = 1; i < lumas.length; i++) s += Math.abs(Math.log2(Math.max(1e-4, lumas[i]) / Math.max(1e-4, lumas[i - 1])));
  return lumas.length > 1 ? s / (lumas.length - 1) : 0;
}

/**
 * Exposure keyframes (clip-local times, one per measured frame) adding
 * the corrections to the clip's own exposure. Each key holds until the
 * next, so every frame gets exactly its own correction; keys that would
 * not change the value by tol units are left out.
 */
export function flickerKeys(times, corrections, base = 0, tol = 0.25) {
  const out = [];
  times.forEach((t, i) => {
    const v = Math.round(clamp(base + (corrections[i] || 0), -100, 100) * 10) / 10;
    if (!out.length || Math.abs(v - out[out.length - 1].v) >= tol) out.push({ t, v, ease: 'hold' });
  });
  return out;
}

/**
 * Frames to measure for a clip: where each source frame starts on the
 * clip's own time (`local`, µs) and a source time in its middle
 * (`source`, µs), so a held key per frame lines up with the picture.
 * Fast clips, long clips and speed curves get an even grid of at most
 * maxRate per second and maxCount in all instead.
 */
export function frameGrid(clip, fps, { maxRate = 60, maxCount = 3000 } = {}) {
  const speed = clip.speed || 1;
  const perSecond = fps * speed;
  const rate = Math.min(perSecond, maxRate, maxCount / Math.max(1e-3, clip.duration / US));
  const local = [];
  const source = [];
  if (!clip.speedCurve && rate >= perSecond - 1e-6) {
    // The frame on screen at the in point, then every one after it.
    const k0 = Math.floor((clip.in * fps) / US + 1e-6);
    for (let k = k0; ; k++) {
      const t = Math.max(0, Math.round(((k * US) / fps - clip.in) / speed));
      if (t >= clip.duration) break;
      local.push(t);
      source.push(Math.round(((k + 0.5) * US) / fps));
    }
  } else {
    const step = US / rate;
    for (let t = 0; t < clip.duration; t += step) {
      local.push(Math.round(t));
      source.push(sourceTimeAt(clip, clip.start + Math.round(Math.min(clip.duration - 1, t + step / 2))));
    }
  }
  return { local, source };
}

/**
 * Mean luma of a video blob at the given source times (µs, ascending).
 * Frames that can not be decoded come back as null.
 */
export async function frameLumas(blob, times, { signal, onProgress } = {}) {
  const out = new Array(times.length).fill(null);
  for await (const f of rgbaFrames(blob, times, { width: FL_W, height: FL_H, signal })) {
    out[f.i] = meanLuma(f.data);
    if (f.i % 20 === 0) onProgress?.(f.i / times.length);
  }
  return out;
}

/** Fill missing values from the nearest measured neighbor (null when none were measured). */
export function fillGaps(values) {
  const first = values.findIndex((v) => v !== null);
  if (first < 0) return null;
  const out = values.slice();
  let last = values[first];
  for (let i = 0; i < out.length; i++) {
    if (out[i] === null) out[i] = last;
    else last = out[i];
  }
  return out;
}
