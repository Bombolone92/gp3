import { describe, it, expect, beforeEach } from 'vitest';
import { bootApp, bootAppWithFeatures } from './helpers.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle, shapeAnchors } from '../src/model/shapes.js';
import { nodeBounds, nodeFrameAngle, transformFrameAngle, selectionFrame, frameToDoc } from '../src/model/geometry.js';
import { rotate, scale } from '../src/lib/matrix.js';
import { applyTransform } from '../src/commands/core.js';
import { boxHandles } from '../src/render/overlay.js';
import { selectionRotation } from '../src/ui/panels/transform-section.js';
import { VDocument } from '../src/model/document.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}
function drag(app, tool, from, to, mods = {}) {
  tool.onPointerDown(ev(app, from[0], from[1], mods));
  for (let i = 1; i <= 4; i++) tool.onPointerMove(ev(app, from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4, mods));
  tool.onPointerUp(ev(app, to[0], to[1], mods));
}
function addRect(app, x, y, w, h, live = true) {
  const doc = app.editor.doc;
  const shape = live ? { kind: 'rect', cx: x + w / 2, cy: y + h / 2, w, h } : undefined;
  const n = createPath(live ? shapeAnchors(shape) : rectangle(x, y, w, h), true, { fill: { type: 'solid', color: '#ff0000' } });
  if (shape) n.shape = shape;
  doc.transact('Rect', () => doc.insert(n, app.editor.targetLayer().id));
  return doc.get(n.id);
}
const r2 = (v) => Math.round(v * 100) / 100;
const frameOf = (app) => {
  const f = app.editor.selectionFrame();
  return { x: r2(f.x), y: r2(f.y), w: r2(f.w), h: r2(f.h), angle: r2(f.angle) };
};

let app;
function boot() {
  app = bootApp();
  app.newDocument();
  app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
  app.editor.setViewOption('alignmentGuides', false);
  app.setTool('selection');
}

describe('frame angle math', () => {
  it('turns with rotations and mirrors with reflections', () => {
    expect(transformFrameAngle(0, rotate(30, 5, 7))).toBeCloseTo(30);
    expect(transformFrameAngle(30, rotate(-50))).toBeCloseTo(-20);
    expect(transformFrameAngle(30, scale(-1, 1, 100, 0))).toBeCloseTo(-30);
    expect(transformFrameAngle(30, scale(1, -1))).toBeCloseTo(-30);
    expect(transformFrameAngle(0, scale(-1, 1))).toBe(0);
    // A scale along the frame's own axes keeps it.
    const m = [rotate(30), scale(3, 0.5), rotate(-30)].reduce((a, b) => [
      a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], 0, 0,
    ]);
    expect(transformFrameAngle(30, m)).toBeCloseTo(30);
  });
});

describe('Rotated bounding box', () => {
  beforeEach(boot);

  it('stays aligned to an object rotated with the Rotate command and reports its size in that frame', () => {
    const r = addRect(app, 100, 100, 100, 50);
    app.editor.select([r.id]);
    applyTransform(app.editor, 'Rotate', rotate(-30, 150, 125));
    const n = app.editor.doc.get(r.id);
    expect(n.frameAngle).toBeCloseTo(-30);
    expect(nodeFrameAngle(n)).toBeCloseTo(-30);
    expect(frameOf(app)).toMatchObject({ w: 100, h: 50, angle: -30 });
    expect(r2(selectionRotation(app.editor))).toBe(30);
    // The drawn handles sit on the rotated rectangle's corners.
    const h = boxHandles(app.editor, app.editor.selectionFrame());
    const a = n.anchors[0];
    const corners = ['nw', 'ne', 'se', 'sw'].map((k) => [r2(h[k].dx), r2(h[k].dy)]);
    expect(corners).toContainEqual([r2(a.x), r2(a.y)]);
    // Undo restores the unrotated frame.
    app.editor.doc.undo();
    expect(frameOf(app)).toMatchObject({ x: 100, y: 100, w: 100, h: 50, angle: 0 });
  });

  it('drags a side handle along the rotated axis without skewing, and the live rectangle stays live', () => {
    const r = addRect(app, 100, 100, 100, 50);
    app.editor.select([r.id]);
    applyTransform(app.editor, 'Rotate', rotate(30, 150, 125));
    const f = app.editor.selectionFrame();
    const h = boxHandles(app.editor, f);
    // Pull the east handle 50 units further along the frame's x axis.
    const to = frameToDoc(f, h.e.fx + 50, h.e.fy);
    drag(app, app.tool, [h.e.dx, h.e.dy], [to.x, to.y]);
    const n = app.editor.doc.get(r.id);
    expect(n.shape).toBeTruthy();
    expect(n.shape.kind).toBe('rect');
    expect(r2(n.shape.w)).toBe(150);
    expect(r2(n.shape.h)).toBe(50);
    expect(r2(n.shape.angle)).toBe(30);
    expect(frameOf(app)).toMatchObject({ w: 150, h: 50, angle: 30 });
    // The west edge stayed put.
    const west = frameToDoc(f, f.x, f.y + f.h / 2);
    const nf = app.editor.selectionFrame();
    const west2 = frameToDoc(nf, nf.x, nf.y + nf.h / 2);
    expect(r2(west2.x)).toBe(r2(west.x));
    expect(r2(west2.y)).toBe(r2(west.y));
  });

  it('scales from the center with Alt and proportionally with Shift on a rotated corner', () => {
    const r = addRect(app, 100, 100, 100, 50);
    app.editor.select([r.id]);
    applyTransform(app.editor, 'Rotate', rotate(45, 150, 125));
    const f = app.editor.selectionFrame();
    const h = boxHandles(app.editor, f);
    const to = frameToDoc(f, h.se.fx + 100, h.se.fy + 10);
    drag(app, app.tool, [h.se.dx, h.se.dy], [to.x, to.y], { shift: true, alt: true });
    const n = app.editor.doc.get(r.id);
    expect(r2(n.shape.w)).toBe(300);
    expect(r2(n.shape.h)).toBe(150);
    expect(r2(n.shape.cx)).toBe(150);
    expect(r2(n.shape.cy)).toBe(125);
  });

  it('rotating with the rotate zone outside a rotated corner accumulates the angle', () => {
    const r = addRect(app, 100, 100, 100, 100);
    app.editor.select([r.id]);
    applyTransform(app.editor, 'Rotate', rotate(30, 150, 150));
    const f = app.editor.selectionFrame();
    const h = boxHandles(app.editor, f);
    // 10 px outside the rotated north-east corner, along the diagonal.
    const c = frameToDoc(f, f.x + f.w / 2, f.y + f.h / 2);
    const len = Math.hypot(h.ne.dx - c.x, h.ne.dy - c.y);
    const p = { x: c.x + ((h.ne.dx - c.x) * (len + 10)) / len, y: c.y + ((h.ne.dy - c.y) * (len + 10)) / len };
    expect(app.tool.boxPartAt(...Object.values(app.editor.view.toScreen(p.x, p.y)))).toBe('rotate-ne');
    // Turn it a further 15 degrees about the center.
    const a = (15 * Math.PI) / 180;
    const q = { x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a), y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a) };
    app.tool.onPointerDown(ev(app, p.x, p.y));
    app.tool.onPointerMove(ev(app, q.x, q.y));
    app.tool.onPointerUp(ev(app, q.x, q.y));
    expect(frameOf(app)).toMatchObject({ w: 100, h: 100, angle: 45 });
  });

  it('uses rotated resize cursors', () => {
    const r = addRect(app, 100, 100, 100, 100);
    app.editor.select([r.id]);
    expect(app.tool.resizeCursor('e')).toBe('ew-resize');
    expect(app.tool.resizeCursor('se')).toBe('nwse-resize');
    applyTransform(app.editor, 'Rotate', rotate(45, 150, 150));
    expect(app.tool.resizeCursor('e')).toBe('nwse-resize');
    expect(app.tool.resizeCursor('se')).toBe('ns-resize');
    expect(app.tool.resizeCursor('n')).toBe('nesw-resize');
  });

  it('a drag that returns to a plain move keeps the original frame', () => {
    const r = addRect(app, 100, 100, 100, 100);
    app.editor.select([r.id]);
    app.tool.onPointerDown(ev(app, 210, 90));
    app.tool.onPointerMove(ev(app, 220, 150));
    expect(app.editor.doc.get(r.id).frameAngle).not.toBeUndefined();
    app.tool.onPointerMove(ev(app, 210, 90));
    app.tool.onPointerUp(ev(app, 210, 90));
    expect(nodeFrameAngle(app.editor.doc.get(r.id))).toBe(0);
  });

  it('shares a common angle across a multi-selection, else draws an unrotated box', () => {
    const a = addRect(app, 100, 100, 100, 50);
    const b = addRect(app, 300, 100, 100, 50);
    app.editor.select([a.id, b.id]);
    applyTransform(app.editor, 'Rotate', rotate(20, 250, 125));
    expect(frameOf(app).angle).toBe(20);
    app.editor.select([a.id]);
    applyTransform(app.editor, 'Rotate', rotate(10, 150, 125));
    app.editor.select([a.id, b.id]);
    const f = app.editor.selectionFrame();
    expect(f.angle).toBe(0);
    const ab = nodeBounds(app.editor.doc, app.editor.doc.get(a.id));
    expect(r2(f.x)).toBe(r2(ab.x));
    expect(selectionRotation(app.editor)).toBe(0);
  });

  it('rotates groups with their own frame and keeps each child frame', () => {
    const a = addRect(app, 100, 100, 100, 50);
    const b = addRect(app, 100, 200, 100, 50);
    app.editor.select([a.id, b.id]);
    app.commands.run('object.group');
    const g = app.editor.topSelection()[0];
    applyTransform(app.editor, 'Rotate', rotate(-25, 150, 175));
    const doc = app.editor.doc;
    expect(doc.get(g).frameAngle).toBeCloseTo(-25);
    expect(nodeFrameAngle(doc.get(a.id))).toBeCloseTo(-25);
    expect(frameOf(app)).toMatchObject({ w: 100, h: 150, angle: -25 });
  });

  it('flipping a rotated object mirrors its frame angle', () => {
    const r = addRect(app, 100, 100, 100, 50);
    app.editor.select([r.id]);
    applyTransform(app.editor, 'Rotate', rotate(30, 150, 125));
    app.commands.run('object.flipH');
    expect(frameOf(app)).toMatchObject({ w: 100, h: 50, angle: -30 });
  });
});

describe('Rotated bounding box with features', () => {
  beforeEach(async () => {
    app = await bootAppWithFeatures();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.setTool('selection');
  });

  it('Reset Bounding Box makes the frame axis-aligned again and is disabled once reset', () => {
    const r = addRect(app, 100, 100, 100, 50);
    app.editor.select([r.id]);
    expect(app.commands.isEnabled('object.resetBoundingBox')).toBe(false);
    applyTransform(app.editor, 'Rotate', rotate(30, 150, 125));
    expect(app.commands.isEnabled('object.resetBoundingBox')).toBe(true);
    app.commands.run('object.resetBoundingBox');
    const f = app.editor.selectionFrame();
    const b = nodeBounds(app.editor.doc, app.editor.doc.get(r.id));
    expect(f.angle).toBe(0);
    expect([f.x, f.y, f.w, f.h].map(r2)).toEqual([b.x, b.y, b.w, b.h].map(r2));
    expect(selectionRotation(app.editor)).toBe(0);
    expect(app.commands.isEnabled('object.resetBoundingBox')).toBe(false);
    // The live shape keeps its own angle.
    expect(r2(app.editor.doc.get(r.id).shape.angle)).toBe(30);
  });

  it('the Transform panel shows and edits W/H and rotation in the object frame', () => {
    const r = addRect(app, 100, 100, 100, 50);
    app.editor.select([r.id]);
    applyTransform(app.editor, 'Rotate', rotate(-40, 150, 125));
    app.openPanel('transform');
    const panel = document.querySelector('.transform-section');
    const field = (label) => panel.querySelector(`input[aria-label="${label}"]`);
    const w = field('W');
    const h = field('H');
    const rot = field('Rotate');
    expect(w && h && rot).toBeTruthy();
    expect(parseFloat(w.value)).toBeCloseTo(100, 1);
    expect(parseFloat(h.value)).toBeCloseTo(50, 1);
    expect(parseFloat(rot.value)).toBeCloseTo(40, 1);
    w.value = '200';
    w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const n = app.editor.doc.get(r.id);
    expect(r2(n.shape.w)).toBe(200);
    expect(r2(n.shape.h)).toBe(50);
    expect(r2(n.shape.angle)).toBe(320);
    expect(r2(app.editor.selectionFrame().angle)).toBe(-40);
  });

  it('keeps the frame angle through copy/paste and the native file format', () => {
    const r = addRect(app, 100, 100, 100, 50);
    app.editor.select([r.id]);
    applyTransform(app.editor, 'Rotate', rotate(15, 150, 125));
    app.commands.run('edit.copy');
    app.commands.run('edit.pasteFront');
    const pasted = app.editor.selectedNodes()[0];
    expect(pasted.id).not.toBe(r.id);
    expect(pasted.frameAngle).toBeCloseTo(15);
    const copy = VDocument.fromJSON(JSON.parse(JSON.stringify(app.editor.doc.toJSON())));
    expect(copy.get(r.id).frameAngle).toBeCloseTo(15);
    expect(selectionFrame(copy, [r.id]).angle).toBeCloseTo(15);
  });
});

describe('Free Transform with a rotated bounding box', () => {
  beforeEach(async () => {
    app = await bootAppWithFeatures();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
  });

  it('scales along the turned axes and distorts the turned box corners', () => {
    const r = addRect(app, 100, 100, 100, 50);
    app.editor.select([r.id]);
    applyTransform(app.editor, 'Rotate', rotate(30, 150, 125));
    app.setTool('free-transform');
    const t = app.tool;
    const f = app.editor.selectionFrame(false);
    const hp = t.handlePoints([
      { x: f.x, y: f.y }, { x: f.x + f.w, y: f.y }, { x: f.x + f.w, y: f.y + f.h }, { x: f.x, y: f.y + f.h },
    ], f);
    expect(t.partAt(hp.e.x, hp.e.y)).toBe('e');
    const to = frameToDoc(f, hp.e.fx + 40, hp.e.fy);
    drag(app, t, [hp.e.dx, hp.e.dy], [to.x, to.y]);
    let n = app.editor.doc.get(r.id);
    expect(r2(n.shape.w)).toBe(140);
    expect(r2(n.shape.h)).toBe(50);
    expect(frameOf(app)).toMatchObject({ w: 140, h: 50, angle: 30 });
    // Free Distort moves only the dragged (turned) corner.
    const f2 = app.editor.selectionFrame(false);
    const se = frameToDoc(f2, f2.x + f2.w, f2.y + f2.h);
    const target = frameToDoc(f2, f2.x + f2.w + 10, f2.y + f2.h + 10);
    const before = app.editor.doc.get(r.id).anchors.map((a) => [r2(a.x), r2(a.y)]);
    drag(app, t, [se.x, se.y], [target.x, target.y], { mod: true });
    n = app.editor.doc.get(r.id);
    const after = n.anchors.map((a) => [r2(a.x), r2(a.y)]);
    const moved = after.filter((p, i) => p[0] !== before[i][0] || p[1] !== before[i][1]);
    expect(moved).toEqual([[r2(target.x), r2(target.y)]]);
  });
});

describe('Rotated bounding box in SVG', () => {
  it('exports and re-imports rotated objects (the frame is editor state only)', async () => {
    boot();
    const { exportSVG } = await import('../src/features/io/svg-export.js');
    const { svgToDocument } = await import('../src/features/io/svg-import.js');
    const r = addRect(app, 100, 100, 100, 50);
    app.editor.select([r.id]);
    applyTransform(app.editor, 'Rotate', rotate(30, 150, 125));
    const svg = exportSVG(app.editor.doc, { rect: { x: 0, y: 0, w: 612, h: 792 } });
    expect(svg).not.toMatch(/frameAngle/);
    const back = svgToDocument(svg, { name: 'x' });
    const leaf = back.leaves()[0];
    const a = nodeBounds(back, leaf);
    const b = nodeBounds(app.editor.doc, app.editor.doc.get(r.id));
    expect([a.x, a.y, a.w, a.h].map(r2)).toEqual([b.x, b.y, b.w, b.h].map(r2));
  });
});
