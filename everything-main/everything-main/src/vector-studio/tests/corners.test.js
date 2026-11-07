import { describe, it, expect } from 'vitest';
import { applyCorners, cornerLimits, cornerGeometry } from '../src/model/corners.js';
import { geomEffectsOf, effectiveSubpaths } from '../src/model/geom-effects.js';
import { rectangle } from '../src/model/shapes.js';
import { createPath } from '../src/model/nodes.js';
import { pathBounds, flattenPath } from '../src/model/bezier.js';
import { VDocument } from '../src/model/document.js';
import { bootAppWithFeatures } from './helpers.js';
import { cornerTargets } from '../src/features/corners/index.js';
import { widgetAt } from '../src/tools/widgets.js';

const withCorners = (anchors, corner, which = null) => anchors.map((a, i) => (which && !which.includes(i) ? a : { ...a, corner }));

describe('live corners geometry', () => {
  it('rounds square corners with tangent arcs', () => {
    const a = withCorners(rectangle(0, 0, 100, 60), { r: 10, type: 'round' });
    const out = applyCorners(a, true);
    expect(out).toHaveLength(8);
    // The first corner (0,0) becomes two anchors 10 from the corner along each edge.
    const pts = out.map((p) => [Math.round(p.x * 1e6) / 1e6, Math.round(p.y * 1e6) / 1e6]);
    expect(pts).toContainEqual([10, 0]);
    expect(pts).toContainEqual([0, 10]);
    const b = pathBounds(out, true);
    expect(b.w).toBeCloseTo(100);
    // The arc passes at r(1 - 1/sqrt2) from the corner along the diagonal.
    const poly = flattenPath(out, true, 0.01);
    const nearest = Math.min(...poly.map((p) => Math.hypot(p.x, p.y)));
    expect(nearest).toBeCloseTo(10 * Math.SQRT2 - 10, 1);
  });

  it('chamfers and inverts corners', () => {
    const ch = applyCorners(withCorners(rectangle(0, 0, 100, 100), { r: 10, type: 'chamfer' }, [0]), true);
    expect(ch).toHaveLength(5);
    expect(ch[0].ox).toBeCloseTo(ch[0].x);
    const inv = applyCorners(withCorners(rectangle(0, 0, 100, 100), { r: 10, type: 'inverted' }, [0]), true);
    const poly = flattenPath(inv, true, 0.01).filter((p) => p.x < 9.999 && p.y < 9.999);
    // The inverted arc stays 10 away from the corner point.
    for (const p of poly) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 0);
  });

  it('limits corners to half of each neighboring segment', () => {
    const a = withCorners(rectangle(0, 0, 100, 20), { r: 50, type: 'round' });
    const lim = cornerLimits(a, true);
    expect(lim[0].limited).toBe(true);
    expect(lim[0].d).toBeCloseTo(10);
    expect(cornerGeometry(a, true, 0).theta).toBeCloseTo(Math.PI / 2);
  });

  it('is a live geometry effect: paths keep their anchors, render rounded', () => {
    const doc = VDocument.create();
    const n = createPath(withCorners(rectangle(0, 0, 100, 60), { r: 8, type: 'round' }), true);
    doc.transact('add', () => doc.insert(n, doc.layers()[0].id));
    const node = doc.get(n.id);
    expect(geomEffectsOf(node)).toHaveLength(1);
    expect(node.anchors).toHaveLength(4);
    expect(effectiveSubpaths(doc, node)[0].anchors).toHaveLength(8);
  });
});

describe('corner widgets', () => {
  const ev = (app, x, y, extra = {}) => {
    const s = app.editor.view.toScreen(x, y);
    return { x, y, sx: s.x, sy: s.y, shift: false, alt: false, mod: false, button: 0, pointerType: 'mouse', pressure: 0.5, native: {}, ...extra };
  };

  async function setup(live = false) {
    const app = await bootAppWithFeatures();
    app.newDocument();
    app.editor.view.set({ zoom: 1, panX: 0, panY: 0, rotation: 0, width: 1000, height: 800 });
    const doc = app.editor.doc;
    const n = live
      ? createPath(rectangle(100, 100, 200, 120), true, {}, { shape: { kind: 'rect', cx: 200, cy: 160, w: 200, h: 120, radii: [0, 0, 0, 0], angle: 0 } })
      : createPath(rectangle(100, 100, 200, 120), true);
    doc.transact('add', () => doc.insert(n, app.editor.targetLayer().id));
    app.editor.select([n.id]);
    app.setTool('selection');
    return { app, doc, id: n.id };
  }

  it('drags a widget to round every corner of the selected path in one step', async () => {
    const { app, doc, id } = await setup();
    const targets = cornerTargets(app);
    expect(targets).toHaveLength(4);
    const c = targets[0];
    const wx = c.x + c.bisector.x * 14;
    const wy = c.y + c.bisector.y * 14;
    const handle = widgetAt(app.editor, ev(app, wx, wy));
    expect(handle?.id).toMatch(/^corner:/);
    const before = doc.undoStack.length;
    const drag = handle.begin(ev(app, wx, wy));
    drag.move(ev(app, wx + c.bisector.x * 20, wy + c.bisector.y * 20));
    drag.end(ev(app, wx + c.bisector.x * 20, wy + c.bisector.y * 20));
    const n = doc.get(id);
    expect(n.anchors.every((a) => a.corner?.r > 0)).toBe(true);
    expect(n.anchors[0].corner.r).toBeCloseTo(20 / (Math.SQRT2 - 1), 3);
    expect(doc.undoStack.length).toBe(before + 1);
  });

  it('Option-click switches the corner type; live rectangles change their radii', async () => {
    const { app, doc, id } = await setup();
    let c = cornerTargets(app)[0];
    let h = widgetAt(app.editor, ev(app, c.x + c.bisector.x * 14, c.y + c.bisector.y * 14));
    let d = h.begin(ev(app, c.x, c.y, { alt: true }));
    d.end(ev(app, c.x, c.y, { alt: true }));
    expect(doc.get(id).anchors[0].corner.type).toBe('inverted');

    const live = await setup(true);
    c = cornerTargets(live.app)[0];
    expect(c.rect).toBe(true);
    h = widgetAt(live.app.editor, ev(live.app, c.x + c.bisector.x * 14, c.y + c.bisector.y * 14));
    d = h.begin(ev(live.app, c.x + c.bisector.x * 14, c.y + c.bisector.y * 14));
    d.move(ev(live.app, c.x + c.bisector.x * 30, c.y + c.bisector.y * 30));
    d.end(ev(live.app, c.x + c.bisector.x * 30, c.y + c.bisector.y * 30));
    const shape = live.doc.get(live.id).shape;
    expect(shape.radii.every((r) => r > 0)).toBe(true);
  });

  it('hides widgets when the view option is off', async () => {
    const { app } = await setup();
    app.editor.viewOptions = { ...app.editor.viewOptions, cornerWidget: false };
    expect(cornerTargets(app)).toEqual([]);
  });
});
