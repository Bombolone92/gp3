import { describe, it, expect } from 'vitest';
import { rectFromCrop, cropFromRect, cropIsEmpty, clampRect, moveRect, resizeRect, aspectRect, CROP_RATIOS } from '../src/lib/imagecrop.js';

const frame = { w: 200, h: 100 };

describe('crop and rectangle conversion', () => {
  it('converts insets to a rectangle and back', () => {
    expect(rectFromCrop({ left: 25, top: 10, right: 25, bottom: 10 }, frame)).toEqual({ x: 50, y: 10, w: 100, h: 80 });
    expect(cropFromRect({ x: 50, y: 10, w: 100, h: 80 }, frame)).toEqual({ left: 25, top: 10, right: 25, bottom: 10 });
    expect(rectFromCrop({}, frame)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    // Round trip.
    const r = rectFromCrop({ left: 12.5, top: 5, right: 7.5, bottom: 20 }, frame);
    expect(cropFromRect(r, frame)).toEqual({ left: 12.5, top: 5, right: 7.5, bottom: 20 });
  });

  it('reports whether a crop trims anything', () => {
    expect(cropIsEmpty(null)).toBe(true);
    expect(cropIsEmpty({ left: 0, top: 0, right: 0, bottom: 0 })).toBe(true);
    expect(cropIsEmpty({ left: 5 })).toBe(false);
  });
});

describe('clamp and move', () => {
  it('keeps a rectangle inside the frame', () => {
    expect(clampRect({ x: -10, y: -5, w: 50, h: 30 }, frame)).toEqual({ x: 0, y: 0, w: 50, h: 30 });
    expect(clampRect({ x: 190, y: 90, w: 40, h: 40 }, frame)).toEqual({ x: 160, y: 60, w: 40, h: 40 });
    expect(clampRect({ x: 0, y: 0, w: 500, h: 500 }, frame)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it('moves a rectangle and stops at the edges', () => {
    expect(moveRect({ x: 50, y: 20, w: 40, h: 30 }, 10, -5, frame)).toEqual({ x: 60, y: 15, w: 40, h: 30 });
    expect(moveRect({ x: 50, y: 20, w: 40, h: 30 }, -100, 0, frame)).toEqual({ x: 0, y: 20, w: 40, h: 30 });
    expect(moveRect({ x: 150, y: 20, w: 40, h: 30 }, 100, 0, frame)).toEqual({ x: 160, y: 20, w: 40, h: 30 });
  });

  it('moves a narrow aspect-ratio crop without changing its size', () => {
    expect(moveRect({ x: 50, y: 45, w: 100, h: 5 }, 10, 10, frame)).toEqual({ x: 60, y: 55, w: 100, h: 5 });
  });
});

describe('resizeRect', () => {
  const rect = { x: 50, y: 20, w: 100, h: 60 };

  it.each([
    [{ x: 0, y: 0, w: 10, h: 5 }, { w: 10, h: 5 }],
    [{ x: 195, y: 95, w: 5, h: 5 }, frame],
    [{ x: 80, y: 40, w: 5, h: 5 }, frame],
  ])('keeps small crops inside the frame when resizing (%j)', (initial, bounds) => {
    for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
      for (const [dx, dy] of [[1, 1], [-1, -1], [1000, 1000], [-1000, -1000]]) {
        const resized = resizeRect(initial, handle, dx, dy, bounds);
        expect(resized.x).toBeGreaterThanOrEqual(0);
        expect(resized.y).toBeGreaterThanOrEqual(0);
        expect(resized.w).toBeGreaterThan(0);
        expect(resized.h).toBeGreaterThan(0);
        expect(resized.x + resized.w).toBeLessThanOrEqual(bounds.w);
        expect(resized.y + resized.h).toBeLessThanOrEqual(bounds.h);
      }
    }
  });

  it('keeps a square centered on an edge drag and anchors the opposite corner on a corner drag', () => {
    const square = { x: 100, y: 60, w: 80, h: 80 };
    const bounds = { w: 300, h: 200 };
    expect(resizeRect(square, 'e', 20, 0, bounds, 16, 1)).toEqual({ x: 100, y: 50, w: 100, h: 100 });
    expect(resizeRect(square, 'nw', 20, 10, bounds, 16, 1)).toEqual({ x: 120, y: 80, w: 60, h: 60 });
  });

  it.each([1, 16 / 9, 3 / 4])('preserves ratio %s at every handle, including frame and minimum-size limits', (ratio) => {
    const bounds = { w: 400, h: 300 };
    const initial = { x: 100, y: 100, w: 100, h: 100 / ratio };
    for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) {
      for (const [dx, dy] of [[20, -10], [1000, 1000], [-1000, -1000]]) {
        const resized = resizeRect(initial, handle, dx, dy, bounds, 16, ratio);
        expect(resized.w / resized.h).toBeCloseTo(ratio);
        expect(resized.x).toBeGreaterThanOrEqual(0);
        expect(resized.y).toBeGreaterThanOrEqual(0);
        expect(resized.x + resized.w).toBeLessThanOrEqual(bounds.w + 1e-8);
        expect(resized.y + resized.h).toBeLessThanOrEqual(bounds.h + 1e-8);
        expect(Math.min(resized.w, resized.h)).toBeGreaterThanOrEqual(16 - 1e-8);
      }
    }
  });

  it('drags an edge without crossing the opposite one', () => {
    expect(resizeRect(rect, 'e', 20, 0, frame)).toEqual({ x: 50, y: 20, w: 120, h: 60 });
    expect(resizeRect(rect, 'w', 20, 0, frame)).toEqual({ x: 70, y: 20, w: 80, h: 60 });
    expect(resizeRect(rect, 'n', 0, 10, frame)).toEqual({ x: 50, y: 30, w: 100, h: 50 });
    expect(resizeRect(rect, 's', 0, -10, frame)).toEqual({ x: 50, y: 20, w: 100, h: 50 });
  });

  it('drags a corner (two edges), clamps to the frame, and keeps a minimum size', () => {
    expect(resizeRect(rect, 'se', 40, 20, frame)).toEqual({ x: 50, y: 20, w: 140, h: 80 });
    expect(resizeRect(rect, 'se', 999, 999, frame)).toEqual({ x: 50, y: 20, w: 150, h: 80 });
    expect(resizeRect({ x: 50, y: 20, w: 100, h: 60 }, 'w', 999, 0, frame, 16)).toEqual({ x: 134, y: 20, w: 16, h: 60 });
    expect(resizeRect(rect, 'nope', 10, 10, frame)).toEqual(rect);
  });
});

describe('aspectRect', () => {
  it('centers a rectangle of the given ratio inside the frame', () => {
    expect(aspectRect(frame, null)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(aspectRect(frame, 1)).toEqual({ x: 50, y: 0, w: 100, h: 100 });
    expect(aspectRect(frame, 4)).toEqual({ x: 0, y: 25, w: 200, h: 50 });
    expect(CROP_RATIOS.find((r) => r.id === '16:9').ratio).toBeCloseTo(16 / 9);
  });
});
