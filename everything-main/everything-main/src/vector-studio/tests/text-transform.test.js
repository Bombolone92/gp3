import { describe, it, expect } from 'vitest';
import { VDocument } from '../src/model/document.js';
import { createText } from '../src/model/nodes.js';
import { transformNodes } from '../src/model/geometry.js';
import { scale, rotate, translate } from '../src/lib/matrix.js';

function docWith(node) {
  const doc = VDocument.create();
  const layer = doc.layers()[0];
  doc.transact('add', () => doc.insert(node, layer.id));
  return doc;
}

describe('transforming type', () => {
  it('resizes the frame of area type instead of scaling its glyphs', () => {
    const n = createText('area', 10, 20, { kind: 'area', width: 100, height: 50 });
    const doc = docWith(n);
    doc.transact('scale', () => transformNodes(doc, [n.id], scale(2, 1.5, 10, 20)));
    const m = doc.get(n.id);
    expect(m.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(m.width).toBeCloseTo(200);
    expect(m.height).toBeCloseTo(75);
    expect(m.x).toBeCloseTo(10);
    expect(m.char.fontSize).toBe(12);
  });

  it('keeps the matrix for rotation and for point type', () => {
    const a = createText('area', 0, 0, { kind: 'area', width: 100, height: 50 });
    const doc = docWith(a);
    doc.transact('rot', () => transformNodes(doc, [a.id], rotate(30)));
    expect(doc.get(a.id).transform[1]).not.toBe(0);
    const p = createText('point', 0, 0);
    const doc2 = docWith(p);
    doc2.transact('scale', () => transformNodes(doc2, [p.id], scale(2)));
    expect(doc2.get(p.id).transform[0]).toBe(2);
  });

  it('moves the path of type on a path', () => {
    const anchors = [
      { x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 },
      { x: 100, y: 0, ix: 100, iy: 0, ox: 100, oy: 0 },
    ];
    const n = createText('path', 0, 0, { kind: 'path', pathAnchors: anchors });
    const doc = docWith(n);
    doc.transact('move', () => transformNodes(doc, [n.id], translate(5, 7)));
    const m = doc.get(n.id);
    expect(m.pathAnchors[1]).toMatchObject({ x: 105, y: 7 });
    expect(m.transform).toEqual([1, 0, 0, 1, 0, 0]);
  });
});
