import { describe, it, expect } from 'vitest';
import { snapAxis, rulerStep, SAFE_ZONES } from '../src/ui/player-guides.js';
import { fitCrop, rectFromCrop, cropFromRect } from '../src/ui/crop-dialog.js';
import { normalizeProject } from '../src/model/project.js';
import { fixture } from './helpers.js';

describe('player snapping', () => {
  it('lines up the closest edge or center within tolerance', () => {
    expect(snapAxis([100, 150, 200], [0, 960, 1920], 10)).toBeNull();
    expect(snapAxis([5, 55, 105], [0, 960], 10)).toEqual({ delta: -5, at: 0 });
    // The center wins when it is closer than an edge.
    expect(snapAxis([940, 958, 976], [960, 980], 10)).toEqual({ delta: 2, at: 960 });
  });

  it('picks readable ruler steps', () => {
    expect(rulerStep(1)).toBe(100);
    expect(rulerStep(0.25)).toBe(250);
    expect(rulerStep(4)).toBe(20);
  });

  it('keeps safe zone regions inside the frame', () => {
    for (const z of SAFE_ZONES) {
      for (const r of z.regions) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(1.0001);
        expect(r.y + r.h).toBeLessThanOrEqual(1.0001);
      }
    }
  });
});

describe('guides in the project', () => {
  it('keeps valid guides and drops the rest', () => {
    const p = fixture();
    p.guides = { v: [0.25, 2, 'x'], h: [0.5] };
    const n = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(n.guides).toEqual({ v: [0.25], h: [0.5] });
    p.guides = { v: [], h: [] };
    expect(normalizeProject(JSON.parse(JSON.stringify(p))).guides).toBeUndefined();
  });
});

describe('crop math', () => {
  it('fits an aspect ratio inside the source around a center', () => {
    const r = fitCrop(9 / 16, 1920, 1080);
    expect(r.h).toBeCloseTo(1);
    expect(r.w * 1920 / (r.h * 1080)).toBeCloseTo(9 / 16);
    expect(r.x + r.w / 2).toBeCloseTo(0.5);
    // Pushed back inside when the old center is near an edge.
    const edge = fitCrop(1, 1920, 1080, { x: 0.9, y: 0, w: 0.1, h: 1 });
    expect(edge.x + edge.w).toBeCloseTo(1);
  });

  it('converts between crop insets and rectangles', () => {
    const crop = { l: 0.1, t: 0.2, r: 0.3, b: 0.05 };
    expect(cropFromRect(rectFromCrop(crop))).toEqual(crop);
  });
});
