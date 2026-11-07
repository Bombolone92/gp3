import { describe, it, expect } from 'vitest';
import { meanLuma, cutPoints, steadyLevel, flickerCorrections, corrected, wobble, flickerKeys, frameGrid, fillGaps } from '../src/media/flicker.js';
import { makeClip } from '../src/model/project.js';
import { US } from '../src/lib/time.js';

/** A slow ramp from a to b over n frames. */
const ramp = (n, a, b) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const maxRel = (a, b) => Math.max(...a.map((v, i) => Math.abs(v / b[i] - 1)));

describe('flicker removal', () => {
  it('measures mean luma of a frame', () => {
    const d = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(meanLuma(d)).toBeCloseTo(0.5, 5);
    expect(meanLuma(new Uint8ClampedArray(0))).toBe(0);
  });

  it('evens out frame-to-frame flicker and keeps a slow change', () => {
    const base = ramp(150, 0.3, 0.5);
    const flicker = base.map((v, i) => v * (i % 2 ? 1.08 : 0.93));
    const units = flickerCorrections(flicker, { radius: 6 });
    const out = corrected(flicker, units);
    expect(wobble(flicker)).toBeGreaterThan(0.15);
    expect(wobble(out)).toBeLessThan(wobble(flicker) / 8);
    // The ramp survives (up to the overall level of the flicker's average).
    expect(maxRel(out, base)).toBeLessThan(0.03);
    expect(out.at(-1) / out[0]).toBeCloseTo(0.5 / 0.3, 1);
  });

  it('removes irregular pulsing from a timelapse', () => {
    let s = 7;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const base = ramp(200, 0.45, 0.35);
    const pulsing = base.map((v) => v * (1 + (rand() - 0.5) * 0.25));
    const out = corrected(pulsing, flickerCorrections(pulsing, { radius: 8 }));
    expect(wobble(out)).toBeLessThan(wobble(pulsing) / 4);
    expect(maxRel(out, base)).toBeLessThan(0.06);
  });

  it('leaves a cut and a steady clip alone', () => {
    const step = [...Array(60).fill(0.25), ...Array(60).fill(0.6)];
    expect(cutPoints(step.map(Math.log2))).toEqual([60]);
    expect(flickerCorrections(step).every((u) => u === 0)).toBe(true);
    expect(flickerCorrections(ramp(90, 0.2, 0.7)).every((u) => Math.abs(u) < 0.5)).toBe(true);
    // A cut in a flickering clip stays a cut.
    const both = step.map((v, i) => v * (i % 2 ? 1.06 : 0.95));
    const out = corrected(both, flickerCorrections(both));
    expect(out[58] / out[57]).toBeCloseTo(1, 1);
    expect(out[61] / out[58]).toBeGreaterThan(2);
  });

  it('ignores near-black frames and caps corrections', () => {
    const dark = Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.02 : 0.01));
    expect(flickerCorrections(dark).every((u) => u === 0)).toBe(true);
    const wild = Array.from({ length: 40 }, (_, i) => (i % 2 ? 0.9 : 0.1));
    expect(Math.max(...flickerCorrections(wild, { maxUnits: 30 }).map(Math.abs))).toBeLessThanOrEqual(30);
  });

  it('turns corrections into held exposure keys on top of the clip exposure', () => {
    const times = Array.from({ length: 10 }, (_, i) => i * 33333);
    const keys = flickerKeys(times, [0, 0, 0, 0, 0, 5, -5, 5, -5, 0], 10);
    expect(keys[0]).toEqual({ t: 0, v: 10, ease: 'hold' });
    expect(keys.map((k) => [k.t, k.v])).toEqual([[0, 10], [5 * 33333, 15], [6 * 33333, 5], [7 * 33333, 15], [8 * 33333, 5], [9 * 33333, 10]]);
    expect(flickerKeys(times, new Array(10).fill(0), 0)).toEqual([{ t: 0, v: 0, ease: 'hold' }]);
    expect(flickerKeys([0, 1], [500, -500], 0).map((k) => k.v)).toEqual([100, -100]);
  });

  it('measures one frame per source frame and keys it where that frame starts', () => {
    // 30 fps source, in point inside frame 3, normal speed.
    const clip = makeClip('video', { assetId: 'a', start: 5 * US, in: 0.11 * US, duration: 0.2 * US });
    const g = frameGrid(clip, 30);
    expect(g.local[0]).toBe(0);
    expect(g.source[0]).toBe(Math.round(3.5 * US / 30));
    expect(g.local[1]).toBe(Math.round(4 * US / 30 - 0.11 * US));
    expect(g.source[1]).toBe(Math.round(4.5 * US / 30));
    expect(g.local.length).toBe(g.source.length);
    expect(g.local.at(-1)).toBeLessThan(clip.duration);
    // Half speed: each source frame lasts twice as long on the timeline.
    const slow = makeClip('video', { assetId: 'a', in: 0, duration: US, speed: 0.5 });
    const gs = frameGrid(slow, 30);
    expect(gs.local.length).toBe(15);
    expect(gs.local[1] - gs.local[0]).toBe(Math.round(2 * US / 30));
    // A long clip gets an even grid within the limit.
    const long = makeClip('video', { assetId: 'a', in: 0, duration: 600 * US });
    const gl = frameGrid(long, 30, { maxCount: 3000 });
    expect(gl.local.length).toBeLessThanOrEqual(3001);
    expect(gl.source[1]).toBeGreaterThan(gl.source[0]);
  });

  it('fills frames that could not be decoded', () => {
    expect(fillGaps([null, 0.2, null, 0.4, null])).toEqual([0.2, 0.2, 0.2, 0.4, 0.4]);
    expect(fillGaps([null, null])).toBe(null);
  });

  it('keeps a steady level equal to a clean ramp', () => {
    const r = ramp(50, 0.2, 0.4);
    expect(maxRel(steadyLevel(r, 5), r)).toBeLessThan(0.02);
  });
});
