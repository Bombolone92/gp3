import { describe, it, expect } from 'vitest';
import { valueAt, ease, EASINGS, setKey, removeKey, keyIndexAt, keyTimes, splitKeyframes, shiftKeyframes, scaleKeyframes, cubicEase, cubicName, parseCubic, isEase } from '../src/model/keyframes.js';

const k = (t, v, e = 'linear') => ({ t, v, ease: e });

describe('valueAt', () => {
  it('returns the base value when the property has no keys', () => {
    expect(valueAt({}, 'x', 5, 0.3)).toBe(0.3);
    expect(valueAt(undefined, 'x', 5, 0.3)).toBe(0.3);
    expect(valueAt({ x: [] }, 'x', 5, 0.3)).toBe(0.3);
  });

  it('holds the first and last values outside the keyed range', () => {
    const kf = { x: [k(100, 1), k(200, 3)] };
    expect(valueAt(kf, 'x', 0, 0)).toBe(1);
    expect(valueAt(kf, 'x', 999, 0)).toBe(3);
  });

  it('interpolates linearly between keys and finds the right segment among many', () => {
    const kf = { x: Array.from({ length: 50 }, (_, i) => k(i * 100, i * 10)) };
    expect(valueAt(kf, 'x', 1234, 0)).toBeCloseTo(123.4);
    expect(valueAt(kf, 'x', 4850, 0)).toBeCloseTo(485);
  });

  it('applies the easing of the key the segment starts from', () => {
    const at = (name, t) => valueAt({ x: [k(0, 0, name), k(1000, 10)] }, 'x', t, 0);
    expect(at('easeIn', 500)).toBeCloseTo(1.25);
    expect(at('easeOut', 500)).toBeCloseTo(8.75);
    expect(at('easeInOut', 250)).toBeCloseTo(0.625);
    expect(at('easeInOut', 750)).toBeCloseTo(9.375);
    expect(at('hold', 999)).toBe(0);
    expect(at('no-such-ease', 500)).toBeCloseTo(5);
  });

  it('uses easings that start at 0, end at 1 and never leave that range', () => {
    for (const name of Object.keys(EASINGS)) {
      // Hold jumps; the springy ones overshoot on purpose (tested below).
      if (['hold', 'overshoot', 'anticipate', 'elastic'].includes(name)) continue;
      expect(ease(name, 0)).toBeCloseTo(0);
      expect(ease(name, 1)).toBeCloseTo(1);
      for (let p = -0.5; p <= 1.5; p += 0.05) {
        expect(ease(name, p)).toBeGreaterThanOrEqual(0);
        expect(ease(name, p)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('setKey and removeKey', () => {
  it('inserts keys in time order', () => {
    const kf = {};
    setKey(kf, 'x', 300, 3);
    setKey(kf, 'x', 100, 1);
    setKey(kf, 'x', 200, 2);
    expect(keyTimes(kf)).toEqual([100, 200, 300]);
  });

  it('replaces the value of a key within the tolerance and keeps its time and easing', () => {
    const kf = { x: [k(1000, 1, 'easeIn')] };
    setKey(kf, 'x', 1010, 5, 'linear', 20);
    expect(kf.x).toEqual([k(1000, 5, 'easeIn')]);
    setKey(kf, 'x', 1030, 6, 'linear', 20);
    expect(kf.x).toHaveLength(2);
  });

  it('removes a key within the tolerance and drops the property when it was the last', () => {
    const kf = { x: [k(1000, 1), k(2000, 2)] };
    removeKey(kf, 'x', 1015, 20);
    expect(kf.x).toEqual([k(2000, 2)]);
    removeKey(kf, 'x', 2100, 20);
    expect(kf.x).toHaveLength(1);
    removeKey(kf, 'x', 2000);
    expect('x' in kf).toBe(false);
    expect(() => removeKey(kf, 'y', 0)).not.toThrow();
  });

  it('finds keys by time within a tolerance', () => {
    const kf = { x: [k(1000, 1)] };
    expect(keyIndexAt(kf, 'x', 1000)).toBe(0);
    expect(keyIndexAt(kf, 'x', 1005)).toBe(-1);
    expect(keyIndexAt(kf, 'x', 1005, 5)).toBe(0);
    expect(keyIndexAt(kf, 'y', 1000, 5)).toBe(-1);
  });

  it('lists distinct key times across properties', () => {
    expect(keyTimes({ x: [k(0, 0), k(500, 1)], y: [k(500, 2), k(900, 3)] })).toEqual([0, 500, 900]);
  });
});

describe('splitKeyframes', () => {
  it('gives each side a key at the cut with the interpolated value', () => {
    const kf = { x: [k(0, 0), k(1000, 10)] };
    const [left, right] = splitKeyframes(kf, 400);
    expect(left.x).toEqual([k(0, 0), k(400, 4)]);
    expect(right.x).toEqual([k(0, 4), k(600, 10)]);
  });

  it('does not duplicate a key that sits exactly on the cut', () => {
    const kf = { x: [k(0, 0), k(400, 4, 'easeIn'), k(1000, 10)] };
    const [left, right] = splitKeyframes(kf, 400);
    expect(left.x.map((x) => x.t)).toEqual([0, 400]);
    expect(right.x).toEqual([k(0, 4, 'easeIn'), k(600, 10)]);
  });

  it('keeps a constant value on the side that had no keys', () => {
    const [left, right] = splitKeyframes({ x: [k(800, 2), k(900, 3)] }, 300);
    expect(valueAt(left, 'x', 0, 0)).toBe(2);
    expect(valueAt(right, 'x', 500, 0)).toBe(2);
    expect(valueAt(right, 'x', 600, 0)).toBe(3);
  });

  it('does not alias key objects between the halves and the original', () => {
    const kf = { x: [k(0, 0), k(1000, 10)] };
    const [left, right] = splitKeyframes(kf, 500);
    left.x[0].v = 99;
    right.x[1].v = 99;
    expect(kf.x).toEqual([k(0, 0), k(1000, 10)]);
  });
});

describe('shiftKeyframes', () => {
  it('moves keys and keeps those inside the clip', () => {
    const out = shiftKeyframes({ x: [k(1000, 1), k(2000, 2)] }, -500, 3000);
    expect(out.x).toEqual([k(500, 1), k(1500, 2)]);
  });

  it('adds edge keys where the trim cut the motion so the visible part is unchanged', () => {
    const kf = { x: [k(0, 0), k(1000, 10)] };
    const left = shiftKeyframes(kf, -250, 750);
    expect(left.x).toEqual([k(0, 2.5), k(750, 10)]);
    const right = shiftKeyframes(kf, 0, 500);
    expect(right.x).toEqual([k(0, 0), k(500, 5)]);
  });

  it('holds the last value when every key falls before the new start', () => {
    const out = shiftKeyframes({ opacity: [k(0, 1), k(100, 0.2)] }, -500, 1000);
    expect(out.opacity).toEqual([k(0, 0.2)]);
  });
});

describe('scaleKeyframes', () => {
  it('scales key times and rounds them to whole microseconds', () => {
    expect(scaleKeyframes({ x: [k(0, 0), k(1001, 1)] }, 0.5).x).toEqual([k(0, 0), k(501, 1)]);
  });
});

describe('springy and custom easings', () => {
  it('overshoot, anticipate and elastic start at 0, end at 1 and leave the range only a little', () => {
    for (const name of ['overshoot', 'anticipate', 'elastic']) {
      expect(ease(name, 0)).toBeCloseTo(0);
      expect(ease(name, 1)).toBeCloseTo(1);
      let lo = 0;
      let hi = 1;
      for (let p = 0; p <= 1; p += 0.01) {
        lo = Math.min(lo, ease(name, p));
        hi = Math.max(hi, ease(name, p));
      }
      expect(lo).toBeGreaterThan(-0.2);
      expect(hi).toBeLessThan(1.4);
      expect(hi - lo).toBeGreaterThan(1.02);
    }
  });

  it('solves custom cubic curves', () => {
    const lin = cubicEase(0.25, 0.25, 0.75, 0.75);
    for (const p of [0, 0.2, 0.5, 0.9, 1]) expect(lin(p)).toBeCloseTo(p, 4);
    const out = cubicEase(0, 0, 0.2, 1);
    expect(out(0.3)).toBeGreaterThan(0.6);
    expect(ease('cubic(0.42,0,0.58,1)', 0.5)).toBeCloseTo(0.5, 4);
    expect(ease('cubic(0.3,1.6,0.6,1)', 0.5)).toBeGreaterThan(1);
  });

  it('names and parses custom curves, clamping handles', () => {
    expect(cubicName(0.12345, -3, 1.5, 0.5)).toBe('cubic(0.123,-1,1,0.5)');
    expect(parseCubic('cubic(0.1,2.5,0.9,1)')).toEqual([0.1, 2, 0.9, 1]);
    expect(parseCubic('cubic(a,b,c,d)')).toBeNull();
    expect(isEase('bounce')).toBe(true);
    expect(isEase('cubic(0,0,1,1)')).toBe(true);
    expect(isEase('wobble')).toBe(false);
    expect(ease('wobble', 0.3)).toBeCloseTo(0.3);
  });
});
