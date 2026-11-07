import { describe, it, expect, beforeEach } from 'vitest';
import { bootApp } from './helpers.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { nodeBounds } from '../src/model/geometry.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}
function drag(app, tool, from, to, mods = {}) {
  tool.onPointerDown(ev(app, from[0], from[1], mods));
  for (let i = 1; i <= 4; i++) tool.onPointerMove(ev(app, from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4, mods));
  tool.onPointerUp(ev(app, to[0], to[1], mods));
}
function addRect(app, x, y, w, h, extra = {}) {
  const doc = app.editor.doc;
  const n = createPath(rectangle(x, y, w, h), true, { fill: { type: 'solid', color: '#ff0000' }, ...extra });
  doc.transact('Rect', () => doc.insert(n, app.editor.targetLayer().id));
  return doc.get(n.id);
}
const xs = (app) => app.editor.doc.leaves().map((n) => Math.round(nodeBounds(app.editor.doc, n).x));

describe('Transform Again', () => {
  let app;
  beforeEach(() => {
    app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.prefs.set('alignmentGuides', false);
  });

  it('repeats an Alt-drag copy as another copy (step and repeat)', async () => {
    addRect(app, 0, 300, 50, 50);
    app.setTool('selection');
    app.editor.setViewOption('alignmentGuides', false);
    drag(app, app.tool, [25, 325], [125, 325], { alt: true });
    await app.commands.run('object.transformAgain');
    await app.commands.run('object.transformAgain');
    expect(xs(app)).toEqual([0, 100, 200, 300]);
  });
});

describe('Transform Again after a nudge', () => {
  it('repeats an arrow-key move, and an Alt+arrow copy as a copy', async () => {
    const app = bootApp();
    app.newDocument();
    const { nudge } = await import('../src/ops/object-ops.js');
    const r = addRect(app, 0, 0, 50, 50);
    app.editor.select([r.id]);
    nudge(app.editor, 10, 0);
    await app.commands.run('object.transformAgain');
    expect(xs(app)).toEqual([20]);
    nudge(app.editor, 10, 0, { copy: true });
    await app.commands.run('object.transformAgain');
    expect(xs(app)).toEqual([20, 30, 40]);
  });
});

describe('nudge with direct-selected anchors', () => {
  it('moves a path whose anchors were all picked one by one alongside a partly selected path', async () => {
    const app = bootApp();
    app.newDocument();
    const { nudge } = await import('../src/ops/object-ops.js');
    const a = addRect(app, 0, 0, 50, 50);
    const b = addRect(app, 200, 0, 50, 50);
    app.editor.selectAnchors(a.id, [0, 1, 2, 3]);
    app.editor.selectAnchors(b.id, [0], { add: true });
    nudge(app.editor, 10, 0);
    const doc = app.editor.doc;
    expect(doc.get(a.id).anchors.map((p) => p.x)).toEqual(a.anchors.map((p) => p.x + 10));
    expect(doc.get(b.id).anchors[0].x).toBe(b.anchors[0].x + 10);
    expect(doc.get(b.id).anchors[1].x).toBe(b.anchors[1].x);
  });
});

describe('transform tool reference point', () => {
  it('returns to the center of a new selection, and stays for the copies of an Alt-drag', () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const a = addRect(app, 0, 0, 100, 100);
    const b = addRect(app, 300, 300, 100, 100);
    app.editor.select([a.id]);
    app.setTool('rotate');
    const tool = app.tool;
    tool.onPointerDown(ev(app, 200, 50));
    tool.onPointerUp(ev(app, 200, 50));
    expect(tool.currentOrigin()).toMatchObject({ x: 200, y: 50 });
    // Rotate a copy: Alt goes down once the drag is under way (Alt-click would open the dialog).
    tool.onPointerDown(ev(app, 100, 50));
    for (const [x, y] of [[120, 70], [150, 100], [200, 150]]) tool.onPointerMove(ev(app, x, y, { alt: true }));
    tool.onPointerUp(ev(app, 200, 150, { alt: true }));
    expect(app.editor.doc.leaves()).toHaveLength(3);
    expect(tool.currentOrigin()).toMatchObject({ x: 200, y: 50 });
    app.editor.select([b.id]);
    expect(tool.currentOrigin()).toMatchObject({ x: 350, y: 350 });
  });
});

describe('Move dialog', () => {
  it('starts from the distance of the last move', async () => {
    const app = bootApp();
    app.newDocument();
    const { nudge } = await import('../src/ops/object-ops.js');
    const r = addRect(app, 0, 0, 50, 50);
    app.editor.select([r.id]);
    nudge(app.editor, 30, -12);
    const p = app.dialogs.transform('move');
    await new Promise((res) => setTimeout(res, 0));
    const inputs = [...document.querySelectorAll('dialog[open] input')];
    expect(inputs[0].value).toMatch(/^30/);
    expect(inputs[1].value).toMatch(/^-12/);
    document.querySelector('dialog[open]').close();
    await p;
  });
});

describe('transform tool dialog', () => {
  it('keeps the Alt-click reference point for the copies a dialog Copy selects', async () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const { applyTransform } = await import('../src/commands/core.js');
    const { rotate } = await import('../src/lib/matrix.js');
    const r = addRect(app, 0, 0, 50, 50);
    app.editor.select([r.id]);
    app.dialogs.transform = async (kind, args) => applyTransform(app.editor, 'Rotate', rotate(-45, args.origin.x, args.origin.y), { copy: true });
    app.setTool('rotate');
    const tool = app.tool;
    tool.onPointerDown(ev(app, 300, 300, { alt: true }));
    tool.onPointerUp(ev(app, 300, 300, { alt: true }));
    await new Promise((res) => setTimeout(res, 0));
    expect(app.editor.doc.leaves()).toHaveLength(2);
    expect(app.editor.selection.has(r.id)).toBe(false);
    expect(tool.currentOrigin()).toMatchObject({ x: 300, y: 300 });
  });
});
