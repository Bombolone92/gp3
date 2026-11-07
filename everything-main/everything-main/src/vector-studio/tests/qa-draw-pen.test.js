import { describe, it, expect, beforeEach } from 'vitest';
import { bootApp } from './helpers.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}
function click(app, tool, x, y, mods = {}) {
  tool.onPointerDown(ev(app, x, y, mods));
  tool.onPointerUp(ev(app, x, y, mods));
}
function drag(app, tool, from, to, mods = {}) {
  tool.onPointerDown(ev(app, from[0], from[1], mods));
  for (let i = 1; i <= 4; i++) tool.onPointerMove(ev(app, from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4, mods));
  tool.onPointerUp(ev(app, to[0], to[1], mods));
}
const pts = (n) => n.anchors.map((a) => [Math.round(a.x), Math.round(a.y)]);

describe('Pen tool', () => {
  let app;
  let pen;
  beforeEach(() => {
    app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.setTool('pen');
    pen = app.tool;
  });

  it('undo while drawing removes the last anchor and keeps drawing the same path', async () => {
    const doc = app.editor.doc;
    click(app, pen, 100, 100);
    click(app, pen, 200, 100);
    click(app, pen, 200, 200);
    await app.commands.run('edit.undo');
    click(app, pen, 300, 300);
    expect(doc.leaves().map(pts)).toEqual([[[100, 100], [200, 100], [300, 300]]]);
  });

  it('undoing the first anchor leaves no stray point behind', async () => {
    const doc = app.editor.doc;
    click(app, pen, 100, 100);
    await app.commands.run('edit.undo');
    expect(doc.leaves()).toHaveLength(0);
    expect(doc.canRedo).toBe(true);
    expect(doc.redoLabel).toBe('Pen');
  });

  it('deselecting ends the path so the next click starts a new one', () => {
    click(app, pen, 100, 100);
    click(app, pen, 200, 100);
    app.editor.clearSelection();
    click(app, pen, 300, 300);
    click(app, pen, 400, 300);
    expect(app.editor.doc.leaves().map(pts)).toEqual([[[100, 100], [200, 100]], [[300, 300], [400, 300]]]);
  });
});

describe('Pen tool on existing paths', () => {
  let app;
  let pen;
  beforeEach(() => {
    app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.setTool('pen');
    pen = app.tool;
  });

  it('clicking the end of the selected open path continues it instead of deleting the anchor', () => {
    click(app, pen, 100, 100);
    click(app, pen, 200, 100);
    pen.onKeyDown({ key: 'Enter' });
    expect(app.editor.selection.size).toBe(1);
    click(app, pen, 200, 100);
    click(app, pen, 300, 150);
    expect(app.editor.doc.leaves().map(pts)).toEqual([[[100, 100], [200, 100], [300, 150]]]);
  });

  it('still deletes an interior anchor of the selected path', () => {
    click(app, pen, 100, 100);
    click(app, pen, 200, 100);
    click(app, pen, 300, 100);
    pen.onKeyDown({ key: 'Enter' });
    click(app, pen, 200, 100);
    expect(app.editor.doc.leaves().map(pts)).toEqual([[[100, 100], [300, 100]]]);
  });
});

describe('Pen tool handles', () => {
  it('dragging from the last corner anchor pulls out its handle without adding an anchor', () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.setTool('pen');
    const pen = app.tool;
    click(app, pen, 100, 100);
    click(app, pen, 200, 100);
    drag(app, pen, [200, 100], [250, 150]);
    click(app, pen, 300, 100);
    const [path] = app.editor.doc.leaves();
    expect(pts(path)).toEqual([[100, 100], [200, 100], [300, 100]]);
    // A cusp: the new outgoing handle only, the incoming side stays a corner.
    expect(path.anchors[1]).toMatchObject({ ox: 250, oy: 150, ix: 200, iy: 100 });
  });
});

describe('Pen tool connecting paths', () => {
  it('clicking another open path endpoint while drawing joins the two into one path', async () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.setTool('pen');
    const pen = app.tool;
    click(app, pen, 100, 300);
    click(app, pen, 200, 300);
    pen.onKeyDown({ key: 'Enter' });
    app.editor.clearSelection();
    click(app, pen, 100, 100);
    click(app, pen, 200, 100);
    click(app, pen, 200, 300); // the other path's end
    const doc = app.editor.doc;
    expect(doc.leaves().map(pts)).toEqual([[[100, 100], [200, 100], [200, 300], [100, 300]]]);
    expect(pen.pathId).toBe(null);
    // One undo step brings both paths back.
    await app.commands.run('edit.undo');
    expect(doc.leaves().map(pts)).toEqual([[[100, 300], [200, 300]], [[100, 100], [200, 100]]]);
  });
});

describe('Curvature tool', () => {
  let app;
  let tool;
  beforeEach(() => {
    app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.setTool('curvature');
    tool = app.tool;
  });

  it('keeps drawing the same path after undo, with corners still in step', async () => {
    click(app, tool, 0, 0);
    click(app, tool, 100, 50, { alt: true });
    click(app, tool, 200, 0);
    await app.commands.run('edit.undo');
    click(app, tool, 300, 0);
    const [p] = app.editor.doc.leaves();
    expect(pts(p)).toEqual([[0, 0], [100, 50], [300, 0]]);
    // The Alt-click point is still a corner.
    expect(p.anchors[1]).toMatchObject({ ix: 100, iy: 50, ox: 100, oy: 50 });
  });

  it('moves a point by dragging it, as one undo step', () => {
    click(app, tool, 0, 0);
    click(app, tool, 100, 50);
    click(app, tool, 200, 0);
    const doc = app.editor.doc;
    const steps = doc.undoStack.length;
    drag(app, tool, [100, 50], [100, 120]);
    expect(pts(doc.leaves()[0])).toEqual([[0, 0], [100, 120], [200, 0]]);
    expect(doc.undoStack.length).toBe(steps + 1);
  });
});

describe('Pen tool with Alt', () => {
  it('converts an anchor of the selected path instead of deleting it, and keeps drawing', () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.setTool('pen');
    const pen = app.tool;
    click(app, pen, 0, 0);
    drag(app, pen, [100, 0], [150, 50]); // a smooth point
    click(app, pen, 200, 0);
    click(app, pen, 100, 0, { alt: true }); // Alt-click the smooth point: corner
    click(app, pen, 300, 0);
    const [p] = app.editor.doc.leaves();
    expect(pts(p)).toEqual([[0, 0], [100, 0], [200, 0], [300, 0]]);
    expect(p.anchors[1]).toMatchObject({ ix: 100, iy: 0, ox: 100, oy: 0 });
  });
});
