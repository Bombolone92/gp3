import { describe, it, expect, beforeEach } from 'vitest';
import { bootApp } from './helpers.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}
function drag(app, from, to, mods = {}) {
  const t = app.tool;
  t.onPointerDown(ev(app, from[0], from[1], mods));
  t.onPointerMove(ev(app, (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, mods));
  t.onPointerMove(ev(app, to[0], to[1], mods));
  t.onPointerUp(ev(app, to[0], to[1], mods));
}
const pts = (n) => n.anchors.map((a) => [a.x, a.y]);

let app;
let doc;
function addRect(x, y, w, h) {
  const n = createPath(rectangle(x, y, w, h), true, { fill: null, stroke: { type: 'solid', color: '#000000' } });
  doc.transact('r', () => doc.insert(n, app.editor.targetLayer().id));
  return doc.get(n.id);
}

beforeEach(() => {
  app = bootApp();
  app.newDocument();
  app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
  app.editor.setViewOption('alignmentGuides', false);
  doc = app.editor.doc;
  app.setTool('direct-selection');
});

describe('Dragging marquee-selected segments', () => {
  it('moves every segment the marquee selected and keeps them selected', async () => {
    const r = addRect(100, 100, 100, 100);
    drag(app, [90, 140], [210, 160]); // the left and right sides
    drag(app, [100, 150], [80, 150]);
    expect(pts(doc.get(r.id))).toEqual([[80, 100], [180, 100], [180, 200], [80, 200]]);
    expect(doc.undoLabel).toBe('Move');
    // Still a segment selection: Delete removes the moved sides only.
    await app.commands.run('edit.clear');
    expect(doc.leaves().map(pts)).toEqual([[[180, 200], [80, 200]], [[80, 100], [180, 100]]]);
  });

  it('a click on a marquee-selected segment selects just that segment', () => {
    const r = addRect(100, 100, 100, 100);
    drag(app, [90, 140], [210, 160]);
    app.tool.onPointerDown(ev(app, 100, 150));
    app.tool.onPointerUp(ev(app, 100, 150));
    expect([...app.editor.anchors.get(r.id)].sort()).toEqual([0, 3]);
  });
});
