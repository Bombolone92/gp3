import { describe, it, expect } from 'vitest';
import {
  colorStats, statsDistance, gradePixels, fitTone, matchAdjust, toneCurve, colorMatch, scaleMatch, applyMatch, matchReferences, MATCH_KEYS,
} from '../src/model/color-match.js';
import { makeClip, createProject } from '../src/model/project.js';
import * as T from '../src/model/timeline.js';
import { US } from '../src/lib/time.js';

/** Small deterministic random generator. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** An RGBA8 frame with smooth gradients and some texture, colors kept away from the ends. */
function picture(w, h, seed = 1, { lo = 50, hi = 200 } = {}) {
  const rand = rng(seed);
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const base = lo + ((hi - lo) * (x + y)) / (w + h);
      d[i] = base + (rand() - 0.5) * 40 + 10 * Math.sin(x * 0.3);
      d[i + 1] = base + (rand() - 0.5) * 30;
      d[i + 2] = base + (rand() - 0.5) * 40 + 10 * Math.cos(y * 0.25);
      d[i + 3] = 255;
    }
  }
  return { data: d, width: w, height: h };
}

const graded = (f, adjust, grade) => ({ ...f, data: gradePixels(f.data, adjust, grade) });

describe('color statistics', () => {
  it('measures level, spread, cast and colorfulness', () => {
    const gray = { data: new Uint8ClampedArray(16 * 16 * 4).fill(128), width: 16, height: 16 };
    const s = colorStats([gray]);
    expect(s.count).toBe(256);
    expect(s.mean).toBeCloseTo(128 / 255, 3);
    expect(s.std).toBeCloseTo(0, 5);
    expect(s.rb).toBeCloseTo(0, 5);
    expect(s.chroma).toBeCloseTo(0, 5);
    const warm = gradePixels(gray.data, { temperature: 50 });
    const w = colorStats([{ ...gray, data: warm }]);
    expect(w.rb).toBeGreaterThan(0.08);
    expect(w.chroma).toBeCloseTo(0, 5); // a uniform cast is not colorfulness
    expect(statsDistance(s, s)).toBe(0);
    expect(statsDistance(s, w)).toBeGreaterThan(5);
  });

  it('only looks inside the crop and pools several frames', () => {
    const f = { data: new Uint8ClampedArray(20 * 10 * 4), width: 20, height: 10 };
    for (let i = 0; i < 200; i++) f.data.fill(i % 20 < 10 ? 0 : 255, i * 4, i * 4 + 3);
    expect(colorStats([f], { crop: { l: 0.5, t: 0, r: 0, b: 0 } }).mean).toBeCloseTo(1, 3);
    expect(colorStats([f], { crop: { l: 0, t: 0, r: 0.5, b: 0 } }).mean).toBeCloseTo(0, 3);
    expect(colorStats([f, f]).count).toBe(400);
    expect(colorStats([]).count).toBe(0);
  });
});

describe('grading on the CPU', () => {
  it('follows the shader for the basic sliders', () => {
    const px = new Uint8ClampedArray([100, 100, 100, 255]);
    expect([...gradePixels(px, {})]).toEqual([100, 100, 100, 255]);
    expect(gradePixels(px, { brightness: 40 })[0]).toBe(126);
    expect(gradePixels(px, { exposure: 100 / 1.5 })[0]).toBe(200); // one stop
    const warm = gradePixels(px, { temperature: 100 });
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect([...gradePixels(new Uint8ClampedArray([200, 100, 50, 7]), { saturation: -100 })].slice(0, 3).every((v, _, a) => v === a[0])).toBe(true);
  });

  it('applies curves and skips bypassed sections', () => {
    const px = new Uint8ClampedArray([64, 64, 64, 255]);
    const lift = { curves: { master: [[0, 0.2], [1, 1]] } };
    expect(gradePixels(px, {}, lift)[0]).toBeGreaterThan(100);
    expect(gradePixels(px, {}, { ...lift, off: { curves: true } })[0]).toBe(64);
    expect(gradePixels(px, { exposure: 50 }, { off: { light: true } })[0]).toBe(64);
  });
});

describe('solving for the sliders', () => {
  it('leaves a clip that already matches alone', () => {
    const f = picture(64, 48, 3);
    const s = colorStats([f]);
    expect(matchAdjust(s, s)).toEqual({ exposure: 0, brightness: 0, contrast: 0, temperature: 0, tint: 0, saturation: 0 });
  });

  it('fits luma level and spread with small slider values', () => {
    const t = fitTone(0.3, 0.15, 0.5, 0.15);
    const k = 2 ** (t.exposure * 0.015);
    const sc = 1 + t.contrast / 100;
    expect(sc * (k * 0.3 + t.brightness * 0.0025 - 0.5) + 0.5).toBeCloseTo(0.5, 2);
    expect(t.gain * 0.15).toBeCloseTo(0.15, 2);
    // Spreading the brightening over the three sliders keeps each one modest.
    for (const v of [t.exposure, t.brightness, t.contrast]) expect(Math.abs(v)).toBeLessThan(60);
    const same = fitTone(0.4, 0.2, 0.4, 0.2);
    expect(same).toMatchObject({ exposure: 0, brightness: 0, contrast: 0 });
  });

  it('recovers a known grade: the matched frame lands on the reference statistics', () => {
    const src = picture(96, 54, 7);
    const ref = graded(src, { exposure: 20, contrast: -15, temperature: 25, tint: -10, saturation: -30 });
    const m = colorMatch([src], [ref]);
    const after = colorStats([graded(src, m.adjust)]);
    const want = colorStats([ref]);
    expect(Math.abs(after.mean - want.mean)).toBeLessThan(0.008);
    expect(Math.abs(after.std - want.std)).toBeLessThan(0.008);
    expect(Math.abs(after.rb - want.rb)).toBeLessThan(0.004);
    expect(Math.abs(after.gm - want.gm)).toBeLessThan(0.004);
    expect(Math.abs(after.chroma - want.chroma)).toBeLessThan(0.004);
    expect(m.adjust.temperature).toBeGreaterThan(10);
    expect(m.adjust.tint).toBeLessThan(0);
    expect(m.adjust.saturation).toBeLessThan(-15);
    expect(m.after).toBeLessThan(m.before / 5);
  });

  it('matches a different picture with a strong cast and darker exposure', () => {
    const src = picture(96, 54, 11, { lo: 90, hi: 230 });
    const other = picture(80, 60, 5, { lo: 20, hi: 140 });
    // A cool, dim reference.
    const ref = graded(other, { temperature: -40, tint: 15, saturation: 30 });
    const m = colorMatch([src], [ref]);
    const want = colorStats([ref]);
    const after = colorStats([graded(src, m.adjust, m.curve ? { curves: { master: m.curve } } : null)]);
    expect(Math.abs(after.mean - want.mean)).toBeLessThan(0.02);
    expect(Math.abs(after.rb - want.rb)).toBeLessThan(0.01);
    expect(m.adjust.temperature).toBeLessThan(-20);
    expect(statsDistance(after, want)).toBeLessThan(statsDistance(colorStats([src]), want) / 4);
  });

  it('follows the reference grade when asked to', () => {
    const src = picture(64, 36, 2);
    const ref = picture(64, 36, 2);
    expect(colorMatch([src], [ref]).adjust.temperature).toBe(0);
    const m = colorMatch([src], [ref], { refLook: { adjust: { temperature: 40 } } });
    expect(m.adjust.temperature).toBeGreaterThan(30);
  });

  it('adds a luma curve only when the tones differ in shape', () => {
    const src = picture(96, 54, 4);
    // A gamma change: same ends, different middle.
    const ref = graded(src, {}, { curves: { master: [[0, 0], [0.5, 0.68], [1, 1]] } });
    const m = colorMatch([src], [ref]);
    expect(m.curve).not.toBe(null);
    expect(m.curve[0]).toEqual([0, 0]);
    expect(m.curve.at(-1)).toEqual([1, 1]);
    for (let i = 1; i < m.curve.length; i++) {
      expect(m.curve[i][0]).toBeGreaterThan(m.curve[i - 1][0]);
      expect(m.curve[i][1]).toBeGreaterThanOrEqual(m.curve[i - 1][1]);
    }
    const s = colorStats([src]);
    expect(toneCurve(s, s)).toBe(null);
  });

  it('returns null with nothing to measure', () => {
    expect(colorMatch([], [picture(8, 8)])).toBe(null);
  });
});

describe('strength and applying', () => {
  const match = { adjust: { exposure: 20, brightness: -10, contrast: 8, temperature: 30, tint: -6, saturation: -40 }, curve: [[0, 0], [0.5, 0.6], [1, 1]] };

  it('scales toward no change', () => {
    expect(scaleMatch(match, 0)).toEqual({ adjust: Object.fromEntries(MATCH_KEYS.map((k) => [k, 0])), curve: null });
    const half = scaleMatch(match, 50);
    expect(half.adjust).toMatchObject({ exposure: 10, brightness: -5, temperature: 15, saturation: -20 });
    expect(half.curve[1]).toEqual([0.5, 0.55]);
    expect(scaleMatch(match, 100).adjust).toEqual(match.adjust);
  });

  it('sets the sliders, clears the other tone sliders and their keys, and sets the luma curve', () => {
    const c = makeClip('video', { assetId: 'a', duration: US });
    c.adjust.highlights = 30;
    c.adjust.vignette = 20;
    c.keyframes['adjust.exposure'] = [{ t: 0, v: 5, ease: 'linear' }];
    c.keyframes['adjust.shadows'] = [{ t: 0, v: 5, ease: 'linear' }];
    c.grade = { off: { light: true, curves: true }, curves: { red: [[0, 0.1], [1, 1]] } };
    applyMatch(c, match);
    expect(c.adjust).toMatchObject({ ...match.adjust, highlights: 0, vignette: 20 });
    expect(c.keyframes['adjust.exposure']).toBeUndefined();
    expect(c.keyframes['adjust.shadows']).toBeUndefined();
    expect(c.grade.curves.master).toEqual(match.curve);
    expect(c.grade.curves.red).toEqual([[0, 0.1], [1, 1]]);
    expect(c.grade.off).toEqual({});
    applyMatch(c, { adjust: match.adjust, curve: null });
    expect(c.grade.curves.master).toBeUndefined();
  });
});

describe('reference clips', () => {
  it('offers the clip before, the clip below and every other picture', () => {
    const p = createProject();
    const main = T.mainTrack(p);
    const a = makeClip('video', { assetId: 'v', start: 0, duration: 4 * US, name: 'A' });
    const b = makeClip('video', { assetId: 'v', start: 4 * US, duration: 4 * US, name: 'B' });
    main.clips.push(a, b);
    const over = makeClip('image', { assetId: 'i', start: 5 * US, duration: 2 * US, name: 'Over' });
    const text = makeClip('text', { start: 0, duration: US });
    T.addClip(p, over);
    T.addClip(p, text);
    const forB = matchReferences(p, b.id);
    expect(forB.before.id).toBe(a.id);
    expect(forB.below).toBe(null);
    expect(forB.all.map((c) => c.name)).toEqual(['A', 'Over']);
    const forOver = matchReferences(p, over.id);
    expect(forOver.below.id).toBe(b.id);
    expect(forOver.before.id).toBe(a.id);
    expect(matchReferences(p, a.id).before).toBe(null);
    expect(matchReferences(p, 'nope').all.length).toBe(3);
  });
});
