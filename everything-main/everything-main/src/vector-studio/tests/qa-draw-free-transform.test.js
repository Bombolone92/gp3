import { describe, it, expect } from 'vitest';
import { bootApp } from './helpers.js';
import { install } from '../src/features/artboards/index.js';
import { createPath } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';

function ev(app, x, y, extra = {}) {
  const s = app.editor.view.toScreen(x, y);
  return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
}

describe('Free Transform', () => {
  it('switches a corner drag to Free Distort when Cmd goes down mid-drag', () => {
    const app = bootApp();
    install(app);
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const doc = app.editor.doc;
    const n = createPath(rectangle(100, 100, 100, 100), true);
    doc.transact('r', () => doc.insert(n, app.editor.targetLayer().id));
    app.editor.select([n.id]);
    app.setTool('free-transform');
    const t = app.tool;
    t.onPointerDown(ev(app, 200, 200));
    t.onPointerMove(ev(app, 210, 205));
    t.onPointerMove(ev(app, 230, 220, { mod: true }));
    t.onPointerUp(ev(app, 230, 220, { mod: true }));
    const pts = doc.get(n.id).anchors.map((a) => [Math.round(a.x), Math.round(a.y)]);
    // Only the dragged corner moved; the others stay put (no scale).
    expect(pts).toEqual([[100, 100], [200, 100], [230, 220], [100, 200]]);
    expect(doc.undoLabel).toBe('Free Distort');
    expect(doc.tx).toBe(null);
  });
});
