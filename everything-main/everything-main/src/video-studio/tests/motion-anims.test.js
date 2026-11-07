import { describe, it, expect } from 'vitest';
import { MOTION_IN, MOTION_OUT, MOTION_LOOP, WHOLE_LOOPS } from '../src/engine/motion-anims.js';
import { applyAnimations } from '../src/engine/scene.js';
import { ANIMATIONS, ANIMATION_CATEGORIES } from '../src/model/catalog.js';

const rest = () => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, blur: 0, reveal: 1 });
const close = (s) => {
  expect(s.x).toBeCloseTo(0, 3);
  expect(s.y).toBeCloseTo(0, 3);
  expect(s.scale).toBeCloseTo(1, 3);
  expect(s.rotation).toBeCloseTo(0, 2);
  expect(s.opacity).toBeCloseTo(1, 3);
  expect(s.blur).toBeCloseTo(0, 3);
};

describe('motion animations', () => {
  it('in animations come to rest at the end, out animations start at rest', () => {
    for (const fn of Object.values(MOTION_IN)) {
      const s = rest();
      fn(1, s);
      close(s);
    }
    for (const fn of Object.values(MOTION_OUT)) {
      const s = rest();
      fn(0, s);
      close(s);
    }
  });

  it('produce finite values all the way through', () => {
    for (const table of [MOTION_IN, MOTION_OUT, MOTION_LOOP]) {
      for (const [id, fn] of Object.entries(table)) {
        for (let i = 0; i <= 20; i++) {
          const s = rest();
          fn(i / 20, s);
          for (const v of Object.values(s)) expect(Number.isFinite(v), `${id} at ${i / 20}`).toBe(true);
          expect(s.opacity).toBeGreaterThanOrEqual(0);
          expect(s.scale).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('every catalog entry is implemented and categorized', () => {
    const known = new Set(ANIMATION_CATEGORIES.map((c) => c.id));
    for (const kind of ['in', 'out', 'loop']) {
      for (const a of ANIMATIONS[kind]) {
        if (a.textOnly) continue;
        expect(known.has(a.cat), `${a.id} category`).toBe(true);
        // Moving away from rest proves the scene knows the id.
        const clip = { duration: 2e6, animIn: null, animOut: null, animLoop: null };
        clip[{ in: 'animIn', out: 'animOut', loop: 'animLoop' }[kind]] = { id: a.id, duration: 1e6 };
        const local = kind === 'in' ? 0.2e6 : kind === 'out' ? 1.8e6 : 0.3e6;
        const s = applyAnimations(clip, local, rest());
        const moved = s.x !== 0 || s.y !== 0 || s.scale !== 1 || s.rotation !== 0 || s.opacity !== 1 || s.blur !== 0;
        expect(moved, a.id).toBe(true);
      }
    }
  });

  it('whole-clip camera moves span the clip, not the loop length', () => {
    expect(WHOLE_LOOPS.has('push-in')).toBe(true);
    const clip = { duration: 10e6, animIn: null, animOut: null, animLoop: { id: 'push-in', duration: 2e6 } };
    const a = applyAnimations(clip, 0, rest()).scale;
    const b = applyAnimations(clip, 5e6, rest()).scale;
    const c = applyAnimations(clip, 10e6, rest()).scale;
    expect(a).toBeCloseTo(1);
    expect(b).toBeGreaterThan(1.05);
    expect(c).toBeCloseTo(1.15);
  });
});
