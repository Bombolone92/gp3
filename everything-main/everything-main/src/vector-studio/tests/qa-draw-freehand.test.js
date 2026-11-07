import { describe, it, expect } from 'vitest';
import { bootApp } from './helpers.js';
import { createPath } from '../src/model/nodes.js';
import { anchor } from '../src/model/bezier.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}
function drag(app, tool, from, to, steps = 8) {
  tool.onPointerDown(ev(app, from[0], from[1]));
  for (let i = 1; i <= steps; i++) tool.onPointerMove(ev(app, from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps));
  tool.onPointerUp(ev(app, to[0], to[1]));
}

describe('Smooth tool', () => {
  it('smooths only the stretch it is dragged along, in one undo step', () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const doc = app.editor.doc;
    // A wiggly run along y = 0, then a sharp corner and a straight run up.
    const pts = [];
    for (let x = 0; x <= 200; x += 10) pts.push(anchor(x, (x / 10) % 2 ? 3 : -3));
    for (let y = -10; y >= -200; y -= 10) pts.push(anchor(200, y));
    const n = createPath(pts, false, { fill: null });
    doc.transact('p', () => doc.insert(n, app.editor.targetLayer().id));
    app.editor.select([n.id]);
    app.setTool('smooth');
    const steps = doc.undoStack.length;
    drag(app, app.tool, [20, 0], [60, 0]);
    const p = doc.get(n.id);
    expect(p.anchors.length).toBeLessThan(pts.length);
    // Everything from x = 90 on (the far wiggles, the corner and the vertical run) is untouched.
    expect(p.anchors.slice(-30)).toEqual(pts.slice(-30));
    expect(p.anchors[0]).toEqual(pts[0]);
    expect(doc.undoStack.length).toBe(steps + 1);
    doc.undo();
    expect(doc.get(n.id).anchors).toEqual(pts);
  });
});

describe('Path Eraser', () => {
  const pts = (n) => n.anchors.map((a) => [Math.round(a.x), Math.round(a.y)]);
  it('erases through the middle of a segment, splitting an open path', async () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const doc = app.editor.doc;
    const n = createPath([anchor(0, 0), anchor(200, 0)], false, { fill: null });
    doc.transact('p', () => doc.insert(n, app.editor.targetLayer().id));
    app.editor.select([n.id]);
    app.setTool('path-eraser');
    drag(app, app.tool, [100, -20], [100, 20]);
    const [a, b] = doc.leaves().map(pts);
    expect(doc.leaves()).toHaveLength(2);
    expect(a[0]).toEqual([0, 0]);
    expect(b[1]).toEqual([200, 0]);
    // The gap is about the eraser's width around x = 100.
    expect(Math.abs(a[1][0] - 94)).toBeLessThanOrEqual(2);
    expect(Math.abs(b[0][0] - 106)).toBeLessThanOrEqual(2);
  });

  it('opens a closed path where it erases', () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const doc = app.editor.doc;
    const n = createPath([anchor(0, 0), anchor(100, 0), anchor(100, 100), anchor(0, 100)], true);
    doc.transact('p', () => doc.insert(n, app.editor.targetLayer().id));
    app.editor.select([n.id]);
    app.setTool('path-eraser');
    drag(app, app.tool, [50, -10], [50, 10]);
    const [p] = doc.leaves();
    expect(p.closed).toBe(false);
    const q = pts(p);
    expect(q.slice(1, 5)).toEqual([[100, 0], [100, 100], [0, 100], [0, 0]]);
    expect(Math.abs(q[0][0] - 56)).toBeLessThanOrEqual(2);
    expect(Math.abs(q[5][0] - 44)).toBeLessThanOrEqual(2);
  });
});
