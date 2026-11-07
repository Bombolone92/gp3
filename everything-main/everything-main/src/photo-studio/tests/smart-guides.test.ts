import { describe, expect, it } from 'vitest';
import { smartGuides } from '../src/model/smart-guides';
import { lineTargets, snapTargets } from '../src/model/transform';
import { layer, newDocument } from '../src/model/document';

const canvas = { x: 0, y: 0, width: 1000, height: 600 };
const rect = (x: number, y: number, width = 100, height = 100) => ({ x, y, width, height });

describe('alignment guides', () => {
  it('snaps edges and centers to other layers and reports the line', () => {
    const r = smartGuides({ moving: rect(203, 300), rects: [rect(200, 50)], canvas, threshold: 6 });
    expect(r.dx).toBe(-3);
    const line = r.lines.find((l) => l.axis === 'x' && l.at === 200)!;
    expect(line).toBeTruthy();
    // The line spans both rectangles across the other axis.
    expect([line.from, line.to]).toEqual([50, 400]);
    // Left, center and right all align; each is reported once.
    expect(r.lines.filter((l) => l.axis === 'x').map((l) => l.at).sort((a, b) => a - b)).toEqual([200, 250, 300]);
  });
  it('snaps to the canvas center only when canvas snapping is on', () => {
    const moving = rect(447, 10);
    expect(smartGuides({ moving, rects: [], canvas, threshold: 6, snapCanvas: true }).dx).toBe(3);
    expect(smartGuides({ moving, rects: [], canvas, threshold: 6 }).dx).toBe(0);
  });
  it('reports exact matches without snapping at zero threshold', () => {
    const r = smartGuides({ moving: rect(201, 300), rects: [rect(200, 50)], canvas, threshold: 0 });
    expect(r.dx).toBe(0);
    expect(r.lines.filter((l) => l.axis === 'x')).toEqual([]);
  });
  it('snaps guide and grid lines and draws them across the canvas', () => {
    const r = smartGuides({ moving: rect(10, 98), rects: [], canvas, threshold: 4, lines: { x: [], y: [100] } });
    expect(r.dy).toBe(2);
    expect(r.lines).toEqual([{ axis: 'y', at: 100, from: 0, to: 1000 }]);
  });
});

describe('equal spacing', () => {
  it('matches an existing gap between neighbours and labels both gaps', () => {
    // A [0,100], B [150,250] (gap 50); the moving box near 297 snaps to 300.
    const r = smartGuides({ moving: rect(297, 0), rects: [rect(0, 0), rect(150, 0)], canvas, threshold: 6 });
    expect(r.dx).toBe(3);
    const gaps = r.spacing.filter((s) => s.axis === 'x');
    expect(gaps.map((g) => [g.from, g.to, g.gap])).toEqual([
      [250, 300, 50],
      [100, 150, 50],
    ]);
    expect(gaps[0].at).toBe(50);
  });
  it('centers between two neighbours', () => {
    const r = smartGuides({ moving: rect(198, 20, 100, 50), rects: [rect(0, 0), rect(400, 0)], canvas, threshold: 6 });
    expect(r.dx).toBe(2);
    expect(r.spacing.map((s) => s.gap)).toEqual([100, 100]);
  });
  it('ignores layers outside the moving row', () => {
    const r = smartGuides({ moving: rect(297, 0), rects: [rect(0, 300), rect(150, 300)], canvas, threshold: 6 });
    expect(r.spacing).toEqual([]);
  });
  it('prefers alignment over spacing at equal distance', () => {
    const r = smartGuides({ moving: rect(297, 0), rects: [rect(0, 0), rect(150, 0), rect(300, 400)], canvas, threshold: 6 });
    expect(r.dx).toBe(3);
    expect(r.lines.some((l) => l.axis === 'x' && l.at === 300)).toBe(true);
  });
});

describe('snap targets by kind', () => {
  const doc = newDocument(800, 600);
  const other = layer('image', 'Other', 100, 100);
  other.transform.x = 200;
  doc.layers = [other];
  doc.guides = [{ orientation: 'vertical', position: 333 }];
  it('includes document, layers and guides by default', () => {
    expect(snapTargets(doc, []).x).toEqual([0, 400, 800, 200, 250, 300, 333]);
  });
  it('drops kinds that are turned off and adds grid lines', () => {
    expect(snapTargets(doc, [], { document: false, guides: false }).x).toEqual([200, 250, 300]);
    expect(snapTargets(doc, [], { layers: false, document: false, guides: false, grid: 200 }).x).toEqual([200, 400, 600]);
    expect(lineTargets(doc, { document: false, grid: 200, gridDivisions: 2 }).y).toEqual([100, 200, 300, 400, 500]);
  });
});
