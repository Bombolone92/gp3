import { describe, it, expect } from 'vitest';
import { VDocument } from '../src/model/document.js';
import { createPath } from '../src/model/nodes.js';
import { shapeAnchors } from '../src/model/shapes.js';
import { transformAnchors } from '../src/model/bezier.js';
import { transformNodes } from '../src/model/geometry.js';
import { rotate, scale, multiply } from '../src/lib/matrix.js';

function setup(shape) {
  const doc = VDocument.create();
  const n = createPath(shapeAnchors(shape), true, { shape });
  doc.transact('add', () => doc.insert(n, doc.layers()[0].id));
  return { doc, id: n.id };
}
/** Anchors regenerated from the live params match the transformed geometry (as point sets). */
function consistent(doc, id) {
  const n = doc.get(id);
  expect(n.shape).toBeTruthy();
  const regen = shapeAnchors(n.shape).map((a) => [a.x, a.y]);
  const key = (p) => `${Math.round(p[0] * 1000) / 1000},${Math.round(p[1] * 1000) / 1000}`.replace(/-0(?=,|$)/g, '0');
  expect(new Set(regen.map(key))).toEqual(new Set(n.anchors.map((a) => key([a.x, a.y]))));
}

describe('live shapes under transforms', () => {
  it('stay live under a uniform scale of a rotated rectangle', () => {
    const { doc, id } = setup({ kind: 'rect', cx: 100, cy: 100, w: 80, h: 40, radii: [0, 0, 0, 0], angle: 30 });
    doc.transact('s', () => transformNodes(doc, [id], scale(2, 2, 100, 100)));
    expect(doc.get(id).shape).toMatchObject({ w: 160, h: 80, angle: 30 });
    consistent(doc, id);
  });

  it('track the mirrored angle of a flipped polygon and star', () => {
    for (const shape of [
      { kind: 'polygon', cx: 0, cy: 0, r: 50, sides: 5, angle: 0 },
      { kind: 'star', cx: 0, cy: 0, r1: 50, r2: 20, points: 5, angle: 10 },
      { kind: 'polygon', cx: 0, cy: 0, r: 50, sides: 3, angle: 25 },
    ]) {
      for (const m of [scale(1, -1, 0, 0), scale(-1, 1, 0, 0), multiply(rotate(40), scale(-1, 1))]) {
        const { doc, id } = setup(shape);
        doc.transact('f', () => transformNodes(doc, [id], m));
        consistent(doc, id);
      }
    }
  });

  it('flip a rectangle without reading as rotated and mirror its corner radii', () => {
    const { doc, id } = setup({ kind: 'rect', cx: 0, cy: 0, w: 100, h: 50, radii: [0, 0, 0, 0], angle: 0 });
    doc.transact('f', () => transformNodes(doc, [id], scale(-1, 1)));
    expect(doc.get(id).shape.angle).toBe(0);
    const shape = { kind: 'rect', cx: 0, cy: 0, w: 100, h: 50, radii: [10, 0, 0, 0], angle: 20 };
    const r = setup(shape);
    r.doc.transact('f', () => transformNodes(r.doc, [r.id], scale(1, -1)));
    const key = (a) => `${Math.round(a.x * 1000) / 1000},${Math.round(a.y * 1000) / 1000}`.replace(/-0(?=,|$)/g, '0');
    const expected = transformAnchors(shapeAnchors(shape), scale(1, -1));
    expect(new Set(r.doc.get(r.id).anchors.map(key))).toEqual(new Set(expected.map(key)));
  });
});
