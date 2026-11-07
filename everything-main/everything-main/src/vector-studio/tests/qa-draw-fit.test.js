import { describe, it, expect } from 'vitest';
import { fitCurve, simplifyPolyline, pathBounds } from '../src/model/bezier.js';

describe('freehand curve fitting', () => {
  it('does not overshoot noisy input with runaway handles', () => {
    // A jittery wave like a quick pencil scribble (same shape the Pencil tool sees).
    const pts = [];
    for (let i = 0; i <= 80; i++) pts.push({ x: i * 5, y: (i % 2 ? 6 : -6) + Math.sin(i / 8) * 40 });
    const t = 5.25;
    const anchors = fitCurve(simplifyPolyline(pts, t * 0.5), t * t);
    const b = pathBounds(anchors, false);
    expect(b.x).toBeGreaterThan(-10);
    expect(b.x + b.w).toBeLessThan(410);
    expect(b.y).toBeGreaterThan(-60);
    expect(b.y + b.h).toBeLessThan(60);
  });
});
