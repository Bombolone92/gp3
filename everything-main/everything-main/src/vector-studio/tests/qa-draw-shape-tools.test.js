import { describe, it, expect, beforeEach } from 'vitest';
import { bootApp } from './helpers.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}
async function clickTool(app, x, y, values, mods = {}) {
  app.dialogs.form = async () => values;
  app.tool.onPointerDown(ev(app, x, y, mods));
  await app.tool.onPointerUp(ev(app, x, y, mods));
  await new Promise((r) => setTimeout(r, 0));
}

describe('shape tool click dialogs', () => {
  let app;
  beforeEach(() => {
    app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
  });

  it('a clicked Line Segment has no fill, like a dragged one', async () => {
    app.setTool('line');
    await clickTool(app, 100, 100, { len: 50, angle: 0 });
    const [line] = app.editor.doc.leaves();
    expect(line.anchors).toHaveLength(2);
    expect(line.fill).toBe(null);
  });
});

describe('shape tool Alt-click', () => {
  it('centers a rectangle and an ellipse on an Alt-click', async () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const { nodeBounds } = await import('../src/model/geometry.js');
    for (const id of ['rectangle', 'ellipse']) {
      app.setTool(id);
      await clickTool(app, 200, 200, { w: 100, h: 60 }, { alt: true });
      const n = app.editor.selectedNodes()[0];
      expect(nodeBounds(app.editor.doc, n)).toMatchObject({ x: 150, y: 170, w: 100, h: 60 });
      expect(n.shape).toMatchObject({ cx: 200, cy: 200 });
    }
  });
});

describe('Space while drawing', () => {
  function ev2(app, x, y) {
    const s = app.editor.view.toScreen(x, y);
    return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {} };
  }
  it('moves the rectangle being drawn, and the Pen anchor being placed', async () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.editor.setViewOption('snapToPoint', false);
    app.editor.setViewOption('alignmentGuides', false);
    const { nodeBounds } = await import('../src/model/geometry.js');
    app.setTool('rectangle');
    const t = app.tool;
    t.onPointerDown(ev2(app, 100, 100));
    t.onPointerMove(ev2(app, 150, 150));
    t.onPointerMove(ev2(app, 200, 150));
    app.input.spaceDown = true;
    t.onPointerMove(ev2(app, 250, 200));
    t.onPointerMove(ev2(app, 300, 250));
    app.input.spaceDown = false;
    t.onPointerMove(ev2(app, 320, 270));
    t.onPointerUp(ev2(app, 320, 270));
    expect(nodeBounds(app.editor.doc, app.editor.selectedNodes()[0])).toMatchObject({ x: 200, y: 200, w: 120, h: 70 });

    app.setTool('pen');
    const pen = app.tool;
    pen.onPointerDown(ev2(app, 100, 400));
    pen.onPointerUp(ev2(app, 100, 400));
    pen.onPointerDown(ev2(app, 200, 400));
    pen.onPointerMove(ev2(app, 220, 420));
    app.input.spaceDown = true;
    pen.onPointerMove(ev2(app, 260, 460));
    app.input.spaceDown = false;
    pen.onPointerMove(ev2(app, 300, 460));
    pen.onPointerUp(ev2(app, 300, 460));
    const p = app.editor.doc.get(pen.pathId);
    expect(p.anchors[1]).toMatchObject({ x: 240, y: 440, ox: 300, oy: 460 });
  });
});

describe('click dialogs for the other shape tools', () => {
  it('Arc, Spiral and both grids open a dialog on click and draw from the values', async () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const { nodeBounds } = await import('../src/model/geometry.js');
    const doc = app.editor.doc;
    app.setTool('arc');
    await clickTool(app, 100, 100, { lx: 80, ly: 40, concave: false });
    let n = app.editor.selectedNodes()[0];
    expect(n.anchors.map((a) => [a.x, a.y])).toEqual([[100, 100], [180, 140]]);
    expect(n.fill).toBe(null);
    app.setTool('spiral');
    await clickTool(app, 300, 300, { r: 50, decay: 80, segments: 6 });
    n = app.editor.selectedNodes()[0];
    expect(n.anchors).toHaveLength(7);
    expect(n.anchors[0]).toMatchObject({ x: 300, y: 250 });
    app.setTool('rect-grid');
    await clickTool(app, 0, 650, { w: 120, h: 60, rows: 2, cols: 3 });
    n = app.editor.selectedNodes()[0];
    expect(n.type).toBe('group');
    expect(n.children).toHaveLength(1 + 2 + 3);
    expect(nodeBounds(doc, n)).toMatchObject({ x: 0, y: 650, w: 120, h: 60 });
    app.setTool('polar-grid');
    await clickTool(app, 700, 500, { w: 100, h: 100, rings: 2, dividers: 4 });
    n = app.editor.selectedNodes()[0];
    expect(n.type).toBe('group');
    expect(nodeBounds(doc, n)).toMatchObject({ x: 700, y: 500, w: 100, h: 100 });
  });
});

describe('Rounded Rectangle arrow keys', () => {
  it('Left squares the corners and Right makes them fully round while dragging', () => {
    const app = bootApp();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    app.setTool('rounded-rectangle');
    const t = app.tool;
    const e = (x, y) => {
      const s = app.editor.view.toScreen(x, y);
      return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {} };
    };
    t.onPointerDown(e(100, 100));
    t.onPointerMove(e(150, 130));
    t.onPointerMove(e(200, 140));
    expect(t.onKeyDown({ key: 'ArrowRight' })).toBe(true);
    expect(app.editor.selectedNodes()[0].shape.radii).toEqual([20, 20, 20, 20]);
    t.onKeyDown({ key: 'ArrowLeft' });
    t.onPointerUp(e(200, 140));
    const n = app.editor.selectedNodes()[0];
    expect(n.shape.radii).toEqual([0, 0, 0, 0]);
    expect(n.anchors).toHaveLength(4);
  });
});
