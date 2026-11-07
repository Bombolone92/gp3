import { describe, it, expect, beforeEach } from 'vitest';
import { bootApp } from './helpers.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}
function marquee(app, from, to, mods = {}) {
  const t = app.tool;
  t.onPointerDown(ev(app, from[0], from[1], mods));
  t.onPointerMove(ev(app, to[0], to[1], mods));
  t.onPointerUp(ev(app, to[0], to[1], mods));
}

let app;
let doc;
const rect = (x, y) => {
  const n = createPath(rectangle(x, y, 50, 50), true, { fill: { type: 'solid', color: '#888888' } });
  doc.transact('r', () => doc.insert(n, app.editor.targetLayer().id));
  return n.id;
};
beforeEach(() => {
  app = bootApp();
  app.newDocument();
  app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
  doc = app.editor.doc;
});

describe('Shift-marquee', () => {
  it('toggles objects in and out of the selection with the Selection tool', () => {
    app.setTool('selection');
    const a = rect(100, 100);
    const b = rect(200, 100);
    const c = rect(300, 100);
    app.editor.select([a, b]);
    // Around b and c: b leaves, c joins, a stays.
    marquee(app, [190, 90], [360, 160], { shift: true });
    expect([...app.editor.selection].sort()).toEqual([a, c].sort());
  });

  it('toggles anchors with Direct Selection', () => {
    app.setTool('direct-selection');
    const a = rect(100, 100); // anchors 0 (100,100) 1 (150,100) 2 (150,150) 3 (100,150)
    app.editor.selectAnchors(a, [0, 1]);
    // Around the top-right and bottom-right anchors: 1 leaves, 2 joins.
    marquee(app, [140, 90], [160, 160], { shift: true });
    expect([...app.editor.anchors.get(a)].sort()).toEqual([0, 2]);
    // Around everything: the selected anchors leave, the others join.
    marquee(app, [90, 90], [160, 160], { shift: true });
    expect([...app.editor.anchors.get(a)].sort()).toEqual([1, 3]);
    // Around the right side: 1 leaves, 2 joins; then again to complete the path.
    marquee(app, [140, 90], [160, 160], { shift: true });
    expect([...app.editor.anchors.get(a)].sort()).toEqual([2, 3]);
    marquee(app, [90, 90], [110, 160], { shift: true });
    expect([...app.editor.anchors.get(a)].sort()).toEqual([0, 2]);
    marquee(app, [90, 140], [160, 160], { shift: true });
    expect([...app.editor.anchors.get(a)].sort()).toEqual([0, 3]);
    marquee(app, [140, 90], [160, 160], { shift: true });
    expect(app.editor.selection.has(a)).toBe(true);
    expect(app.editor.anchors.has(a)).toBe(false); // wholly selected
    marquee(app, [90, 90], [160, 160], { shift: true });
    expect(app.editor.selection.has(a)).toBe(false);
  });

  it('a plain marquee still replaces the selection', () => {
    app.setTool('selection');
    const a = rect(100, 100);
    const b = rect(200, 100);
    app.editor.select([a]);
    marquee(app, [190, 90], [260, 160]);
    expect([...app.editor.selection]).toEqual([b]);
  });
});
