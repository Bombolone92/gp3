import { describe, it, expect, beforeEach } from 'vitest';
import { bootApp } from './helpers.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}
function click(app, tool, x, y, mods = {}) {
  tool.onPointerDown(ev(app, x, y, mods));
  tool.onPointerUp(ev(app, x, y, mods));
}
function addRect(app, x, y, w, h, extra = {}) {
  const doc = app.editor.doc;
  const n = createPath(rectangle(x, y, w, h), true, { fill: { type: 'solid', color: '#ff0000' }, ...extra });
  doc.transact('Rect', () => doc.insert(n, app.editor.targetLayer().id));
  return doc.get(n.id);
}

describe('Direct Selection', () => {
  let app;
  beforeEach(() => {
    app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.setTool('direct-selection');
  });

  it('Shift-click on an anchor of a wholly selected path deselects only that anchor', () => {
    const r = addRect(app, 100, 100, 100, 100);
    app.editor.select([r.id]);
    click(app, app.tool, 200, 100, { shift: true });
    expect([...app.editor.selectedAnchors(r.id)].sort()).toEqual([0, 2, 3]);
  });
});

describe('Direct Selection segments', () => {
  let app;
  beforeEach(() => {
    app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.setTool('direct-selection');
  });
  const pts = (n) => n.anchors.map((a) => [a.x, a.y]);

  it('Delete after clicking a segment removes just that segment of a closed path', async () => {
    const r = addRect(app, 100, 100, 100, 100);
    click(app, app.tool, 150, 100); // top edge
    await app.commands.run('edit.clear');
    const doc = app.editor.doc;
    expect(doc.leaves()).toHaveLength(1);
    const p = doc.get(r.id);
    expect(p.closed).toBe(false);
    expect(pts(p)).toEqual([[200, 100], [200, 200], [100, 200], [100, 100]]);
    doc.undo();
    expect(doc.get(r.id).closed).toBe(true);
  });

  it('splits an open path at a deleted middle segment', async () => {
    const doc = app.editor.doc;
    const n = createPath([[0, 0], [100, 0], [200, 0], [300, 0]].map(([x, y]) => ({ x, y, ix: x, iy: y, ox: x, oy: y })), false, { fill: null });
    doc.transact('Path', () => doc.insert(n, app.editor.targetLayer().id));
    click(app, app.tool, 150, 0);
    await app.commands.run('edit.clear');
    expect(doc.leaves().map(pts)).toEqual([[[0, 0], [100, 0]], [[200, 0], [300, 0]]]);
  });

  it('a marquee around two anchors still deletes the anchors', async () => {
    const r = addRect(app, 100, 100, 100, 100);
    const doc = app.editor.doc;
    click(app, app.tool, 150, 100);
    app.editor.selectAnchors(r.id, [0, 1]);
    await app.commands.run('edit.clear');
    expect(doc.leaves().map(pts)).toEqual([[[200, 200], [100, 200]]]);
  });
});

describe('Direct Selection with Alt', () => {
  it('Alt-click selects the whole path, then its group; Alt-drag copies', async () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const a = addRect(app, 100, 100, 100, 100);
    const b = addRect(app, 300, 100, 100, 100);
    app.editor.select([a.id, b.id]);
    await app.commands.run('object.group');
    const gid = [...app.editor.selection][0];
    app.editor.clearSelection();
    app.setTool('direct-selection');
    const tool = app.tool;
    click(app, tool, 150, 150, { alt: true });
    expect([...app.editor.selection]).toEqual([a.id]);
    expect(app.editor.anchors.size).toBe(0);
    click(app, tool, 150, 150, { alt: true });
    expect(app.editor.selection.has(gid)).toBe(true);
    app.editor.select([a.id]);
    tool.onPointerDown(ev(app, 150, 150, { alt: true }));
    tool.onPointerMove(ev(app, 160, 150, { alt: true }));
    tool.onPointerMove(ev(app, 200, 150, { alt: true }));
    tool.onPointerUp(ev(app, 200, 150, { alt: true }));
    expect(app.editor.doc.leaves()).toHaveLength(3);
    expect(app.editor.doc.get(a.id).anchors[0]).toMatchObject({ x: 100, y: 100 });
  });
});

describe('Direct Selection click on a selected anchor', () => {
  it('narrows a whole-path selection to the clicked anchor, but a drag still moves everything', () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const r = addRect(app, 100, 100, 100, 100);
    app.setTool('direct-selection');
    const tool = app.tool;
    app.editor.select([r.id]);
    tool.onPointerDown(ev(app, 200, 100));
    tool.onPointerMove(ev(app, 210, 100));
    tool.onPointerMove(ev(app, 220, 100));
    tool.onPointerUp(ev(app, 220, 100));
    expect(app.editor.doc.get(r.id).anchors[0].x).toBe(120);
    expect(app.editor.selectedAnchors(r.id).size).toBe(4);
    click(app, tool, 220, 100);
    expect([...app.editor.selectedAnchors(r.id)]).toEqual([1]);
  });
});

describe('Direct Selection Shift-drag', () => {
  it('adds an anchor and drags the selection constrained; Shift-click on a selected anchor deselects it', () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.editor.setViewOption('alignmentGuides', false);
    const r = addRect(app, 100, 100, 100, 100);
    app.setTool('direct-selection');
    const t = app.tool;
    app.editor.selectAnchors(r.id, [0]);
    t.onPointerDown(ev(app, 200, 100, { shift: true }));
    t.onPointerMove(ev(app, 210, 100, { shift: true }));
    t.onPointerMove(ev(app, 230, 103, { shift: true }));
    t.onPointerUp(ev(app, 230, 103, { shift: true }));
    const a = app.editor.doc.get(r.id).anchors;
    expect([a[0].x, a[0].y, a[1].x, a[1].y]).toEqual([130, 100, 230, 100]);
    click(app, t, 230, 100, { shift: true });
    expect([...app.editor.selectedAnchors(r.id)]).toEqual([0]);
  });
});

describe('Direct Selection marquee across segments', () => {
  const pts = (n) => n.anchors.map((a) => [a.x, a.y]);
  function marquee(app, from, to) {
    const t = app.tool;
    t.onPointerDown(ev(app, from[0], from[1]));
    t.onPointerMove(ev(app, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2));
    t.onPointerMove(ev(app, to[0], to[1]));
    t.onPointerUp(ev(app, to[0], to[1]));
  }
  it('Delete removes only the crossed segments, never the whole path', async () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const r = addRect(app, 100, 100, 100, 100, { fill: null });
    app.setTool('direct-selection');
    const doc = app.editor.doc;
    marquee(app, [140, 90], [160, 110]); // across the top edge only
    await app.commands.run('edit.clear');
    expect(doc.leaves().map(pts)).toEqual([[[200, 100], [200, 200], [100, 200], [100, 100]]]);
    doc.undo();
    expect(doc.get(r.id).closed).toBe(true);
    marquee(app, [90, 140], [210, 160]); // across both sides
    await app.commands.run('edit.clear');
    expect(doc.leaves().map(pts)).toEqual([[[200, 200], [100, 200]], [[100, 100], [200, 100]]]);
  });
});
