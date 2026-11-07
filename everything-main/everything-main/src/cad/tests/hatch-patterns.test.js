import { describe, it, expect } from 'vitest';
import { PATTERNS, getPattern, patternNames } from '../src/core/hatch/patterns.js';
import { patternSegments } from '../src/core/hatch/fill.js';

describe('hatch patterns', () => {
  it('has about twenty patterns with unique names', () => {
    const names = patternNames();
    expect(names.length).toBeGreaterThanOrEqual(18);
    expect(new Set(names.map((n) => n.toUpperCase())).size).toBe(names.length);
    expect(names).toContain('SOLID');
  });

  it('every family is well formed with positive perpendicular spacing', () => {
    for (const p of PATTERNS) {
      expect(typeof p.description).toBe('string');
      expect(p.description).not.toMatch(/\u2014/);
      if (p.name === 'SOLID') {
        expect(p.families.length).toBe(0);
        continue;
      }
      expect(p.families.length).toBeGreaterThan(0);
      for (const f of p.families) {
        for (const k of ['angle', 'x', 'y', 'dx', 'dy']) expect(Number.isFinite(f[k])).toBe(true);
        expect(f.dy).toBeGreaterThan(0);
        expect(f.angle).toBeGreaterThanOrEqual(0);
        expect(f.angle).toBeLessThan(360);
        expect(Array.isArray(f.dashes)).toBe(true);
        if (f.dashes.length) expect(f.dashes.some((d) => d !== 0)).toBe(true);
      }
    }
  });

  it('looks patterns up by name, case-insensitively', () => {
    expect(getPattern('brick').name).toBe('BRICK');
    expect(getPattern('nope')).toBeNull();
  });

  it('every pattern produces geometry inside a 40 x 40 square', () => {
    const sq = [[0, 0, 40, 0, 40, 40, 0, 40]];
    for (const p of PATTERNS) {
      if (p.name === 'SOLID') continue;
      const r = patternSegments(sq, p, 1, 0);
      expect(r.truncated).toBe(false);
      expect(r.segs.length + r.dots.length).toBeGreaterThan(0);
      for (const v of r.segs) {
        expect(v).toBeGreaterThanOrEqual(-1e-9);
        expect(v).toBeLessThanOrEqual(40 + 1e-9);
      }
    }
  });

  it('tiling patterns have no loose ends: every dash end touches another segment', () => {
    const W = 60;
    const onSeg = (x, y, s, i) => {
      const ax = s[i],
        ay = s[i + 1],
        ex = s[i + 2] - ax,
        ey = s[i + 3] - ay;
      const l2 = ex * ex + ey * ey;
      let t = ((x - ax) * ex + (y - ay) * ey) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(ax + t * ex - x, ay + t * ey - y) < 1e-6;
    };
    for (const name of ['HERRINGBONE', 'BRICK', 'PLANKS', 'BASKET', 'HONEYCOMB', 'BATTING', 'PEBBLES']) {
      const s = patternSegments([[0, 0, W, 0, W, W, 0, W]], name, 1, 0.3).segs;
      let checked = 0;
      for (let i = 0; i < s.length; i += 4) {
        for (const [x, y] of [
          [s[i], s[i + 1]],
          [s[i + 2], s[i + 3]],
        ]) {
          if (x < 1 || x > W - 1 || y < 1 || y > W - 1) continue;
          let touch = false;
          for (let j = 0; j < s.length && !touch; j += 4) if (j !== i && onSeg(x, y, s, j)) touch = true;
          expect(touch, `${name} loose end at ${x}, ${y}`).toBe(true);
          checked++;
        }
      }
      expect(checked, name).toBeGreaterThan(10);
    }
  });
});

