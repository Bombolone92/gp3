import { describe, it, expect, beforeAll } from 'vitest';
import { installCanvasStub } from './helpers.js';
import { VDocument } from '../src/model/document.js';
import { createPath, createCompound, defaultLabel } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { anchor } from '../src/model/bezier.js';
import { liveArtwork, isLive, liveDef, registerLive, virtualId } from '../src/model/live.js';
import { nodeBounds, visualBounds, transformNodes } from '../src/model/geometry.js';
import { hitTest } from '../src/render/hit.js';
import { drawNode } from '../src/render/draw.js';
import { exportSVG } from '../src/features/io/svg-export.js';
import { svgToDocument } from '../src/features/io/svg-import.js';
import { expandNodeAppearance, hasExpandableAppearance } from '../src/ops/expand-appearance.js';
import { expandLive } from '../src/model/live.js';
import '../src/features/brushes/live-kinds.js';
import { DEFAULT_BRUSHES, BRUSH_LIBRARIES } from '../src/features/brushes/libraries.js';
import { brushById, docBrushes, resolveBrush } from '../src/features/brushes/brush-model.js';

beforeAll(() => installCanvasStub());

const black = { type: 'solid', color: '#000000' };
const red = { type: 'solid', color: '#ff0000' };

function docWith(...nodes) {
  const doc = VDocument.create({ width: 400, height: 300 });
  const layer = doc.layers()[0].id;
  doc.transact('add', () => {
    for (const n of nodes) {
      if (n.type === 'compound') doc.insert(n.node, layer, Infinity, n.kids);
      else doc.insert(n, layer);
    }
  });
  doc.repairParents();
  return { doc, layer };
}

const lens = [{ t: 0, l: 0, r: 0 }, { t: 0.5, l: 1, r: 1 }, { t: 1, l: 0, r: 0 }];

describe('live paths (core)', () => {
  it('a test kind on a path draws its generated artwork, keeps its own bounds and hits on the artwork and the path', () => {
    registerLive('testPathShadow', {
      bounds: 'source',
      test: (n) => n.type === 'path' && Boolean(n.testShadow),
      generate(doc, node) {
        const extra = new Map();
        const id = virtualId(node.id);
        extra.set(id, { ...node, testShadow: undefined, id, source: node.id, anchors: node.anchors.map((a) => ({ ...a, y: a.y + 100, iy: a.iy + 100, oy: a.oy + 100 })) });
        return { items: [id], extra };
      },
    });
    const p = createPath(rectangle(10, 10, 20, 20), true, { fill: red, stroke: null, testShadow: true });
    const { doc } = docWith(p);
    const n = doc.get(p.id);
    expect(isLive(n)).toBe(true);
    // Still labeled as a path.
    expect(defaultLabel(n)).toBe('<Path>');
    expect(nodeBounds(doc, n).y).toBeCloseTo(10);
    expect(visualBounds(doc, n).y).toBeCloseTo(110);
    expect(hitTest(doc, 20, 120, 1)?.id).toBe(p.id);
    // The path stays clickable on its own outline.
    expect(hitTest(doc, 10, 20, 1)?.id).toBe(p.id);
    expect(hitTest(doc, 20, 20, 1)).toBe(null);
    // Rendering goes through the artwork; outline mode draws the path.
    const ops = [];
    const ctx = new Proxy({ getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }, { get: (t, k) => (k in t ? t[k] : (...a) => ops.push([k, ...a])), set: () => true });
    drawNode(ctx, doc, n, { hairline: 1 });
    const filled = ops.filter((o) => o[0] === 'fill');
    expect(filled).toHaveLength(1);
    expect(filled[0][1].ops[0]).toEqual(['M', n.anchors[0].x, n.anchors[0].y + 100]);
    ops.length = 0;
    drawNode(ctx, doc, n, { hairline: 1, outline: true });
    expect(ops.filter((o) => o[0] === 'stroke')[0][1].ops[0]).toEqual(['M', n.anchors[0].x, n.anchors[0].y]);
    // Expanding replaces the path with its artwork.
    let g;
    doc.transact('expand', () => {
      g = expandLive(doc, p.id);
    });
    expect(doc.get(p.id)).toBeUndefined();
    expect(nodeBounds(doc, g).y).toBeCloseTo(110);
  });
});

describe('variable width strokes', () => {
  it('render as a filled outline with the fill kept, select by the path and export the outline', () => {
    const p = createPath([anchor(50, 100), anchor(250, 100)], false, { fill: null, stroke: black, strokeWidth: 20, widthProfile: lens });
    const { doc } = docWith(p);
    const n = doc.get(p.id);
    expect(liveDef(n)?.key).toBe('variableWidth');
    const { items } = liveArtwork(doc, n);
    expect(items).toHaveLength(1);
    expect(items[0].fill).toEqual(black);
    expect(items[0].stroke).toBe(null);
    // Selection box on the path; preview bounds on the outline.
    expect(nodeBounds(doc, n).h).toBeCloseTo(0);
    expect(visualBounds(doc, n).h).toBeCloseTo(20, 0);
    expect(hitTest(doc, 150, 108, 1)?.id).toBe(p.id);
    expect(hitTest(doc, 60, 108, 1)).toBe(null);
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 400, h: 300 } });
    expect(svg).not.toContain('stroke-width="20"');
    const back = svgToDocument(svg);
    const leaf = back.leaves()[0];
    expect(leaf.fill?.color).toBe('#000000');
    expect(nodeBounds(back, leaf).h).toBeCloseTo(20, 0);
  });

  it('expand appearance to the outline path (and the fill beside it)', () => {
    const p = createPath(rectangle(50, 50, 100, 100), true, { fill: red, stroke: black, strokeWidth: 10, widthProfile: lens, name: 'Frame', opacity: 0.5 });
    const { doc, layer } = docWith(p);
    expect(hasExpandableAppearance(doc, doc.get(p.id))).toBe(true);
    let out;
    doc.transact('expand', () => {
      out = expandNodeAppearance(doc, p.id);
    });
    const g = doc.get(out);
    expect(g.type).toBe('group');
    expect(g.name).toBe('Frame');
    expect(g.opacity).toBe(0.5);
    const [fill, outline] = g.children.map((c) => doc.get(c));
    expect(fill.fill).toEqual(red);
    expect(fill.stroke).toBe(null);
    expect(fill.widthProfile).toBeUndefined();
    expect(outline.type).toBe('compound');
    expect(outline.fill).toEqual(black);
    expect(isLive(outline)).toBe(false);
    doc.undo();
    expect(doc.get(p.id).widthProfile).toEqual(lens);
    expect(doc.get(layer).children).toEqual([p.id]);
    // Stroke only: the outline replaces the path directly.
    const q = createPath([anchor(0, 0), anchor(100, 0)], false, { fill: null, stroke: black, strokeWidth: 10, widthProfile: lens, opacity: 0.4 });
    const d2 = docWith(q).doc;
    let o2;
    d2.transact('expand', () => {
      o2 = expandNodeAppearance(d2, q.id);
    });
    const r = d2.get(o2);
    expect(r.type).toBe('path');
    expect(r.fill).toEqual(black);
    expect(r.opacity).toBeCloseTo(0.4);
  });

  it('a uniform profile is a plain stroke', () => {
    const p = createPath([anchor(0, 0), anchor(100, 0)], false, { stroke: black, strokeWidth: 4, widthProfile: [{ t: 0, l: 1, r: 1 }, { t: 1, l: 1, r: 1 }] });
    const { doc } = docWith(p);
    expect(isLive(doc.get(p.id))).toBe(false);
  });
});

describe('brush strokes', () => {
  it('resolve brushes from the document, the defaults and the libraries', () => {
    const { doc } = docWith();
    expect(docBrushes(doc)).toBe(DEFAULT_BRUSHES);
    expect(brushById(doc, 'def.basic').type).toBe('calligraphic');
    const lib = BRUSH_LIBRARIES[0].brushes[0];
    expect(brushById(doc, lib.id)).toBe(lib);
    const p = createPath([anchor(0, 0), anchor(100, 0)], false, { brush: { id: 'def.basic', size: { mode: 'fixed', value: 9, variation: 0 } } });
    expect(resolveBrush(doc, p).size.value).toBe(9);
    expect(resolveBrush(doc, p).name).toBe('Basic');
  });

  it('every built-in brush draws something on a curve and on a closed shape', () => {
    const curve = [anchor(20, 150, 20, 150, 80, 50), anchor(200, 150, 140, 250, 260, 50), anchor(380, 150)];
    const all = [...DEFAULT_BRUSHES, ...BRUSH_LIBRARIES.flatMap((l) => l.brushes)];
    for (const b of all) {
      const p = createPath(curve, false, { fill: null, stroke: black, strokeWidth: 1, brush: { id: b.id } });
      const r = createPath(rectangle(50, 50, 120, 80), true, { fill: null, stroke: black, strokeWidth: 1, brush: { id: b.id } });
      const { doc } = docWith(p, r);
      for (const n of [doc.get(p.id), doc.get(r.id)]) {
        const { items } = liveArtwork(doc, n);
        expect(items.length, `${b.name} draws`).toBeGreaterThan(0);
        const vb = visualBounds(doc, n);
        expect(Number.isFinite(vb.w) && vb.w > 10, `${b.name} has finite bounds`).toBe(true);
        for (const it of items) for (const a of it.anchors || []) expect(Number.isFinite(a.x) && Number.isFinite(a.ox)).toBe(true);
      }
    }
  });

  it('draw the fill under the brush, select by clicking the artwork, follow the path when moved', () => {
    const p = createPath(rectangle(50, 50, 100, 100), true, { fill: red, stroke: black, strokeWidth: 1, brush: { id: 'lib.cal.round-6' } });
    const { doc } = docWith(p);
    const n = doc.get(p.id);
    const { items } = liveArtwork(doc, n);
    expect(items[0].fill).toEqual(red);
    expect(items[0].stroke).toBe(null);
    expect(items[1].fill).toEqual(black);
    expect(nodeBounds(doc, n)).toEqual({ x: 50, y: 50, w: 100, h: 100 });
    expect(visualBounds(doc, n).x).toBeCloseTo(47, 0);
    expect(hitTest(doc, 47.5, 100, 0.5)?.id).toBe(p.id);
    doc.transact('move', () => transformNodes(doc, [p.id], [1, 0, 0, 1, 10, 0]));
    expect(visualBounds(doc, doc.get(p.id)).x).toBeCloseTo(57, 0);
  });

  it('regenerate when the brush definition changes, and keep showing a stroke for unknown brushes', () => {
    const p = createPath([anchor(0, 50), anchor(200, 50)], false, { fill: null, stroke: black, strokeWidth: 1, brush: { id: 'mine' } });
    const { doc } = docWith(p);
    const plain = liveArtwork(doc, doc.get(p.id)).items;
    expect(plain).toHaveLength(1);
    expect(plain[0].stroke).toEqual(black);
    doc.transact('brushes', () => doc.updateRoot({ brushes: [{ ...DEFAULT_BRUSHES[0], id: 'mine', size: { mode: 'fixed', value: 10, variation: 0 } }] }));
    expect(visualBounds(doc, doc.get(p.id)).h).toBeCloseTo(10, 0);
    doc.transact('brushes', () => doc.updateRoot({ brushes: [{ ...DEFAULT_BRUSHES[0], id: 'mine', size: { mode: 'fixed', value: 20, variation: 0 } }] }));
    expect(visualBounds(doc, doc.get(p.id)).h).toBeCloseTo(20, 0);
  });

  it('a compound path brushes every subpath; the stroke weight scales the brush', () => {
    const a = createPath(rectangle(0, 0, 100, 100), true);
    const b = createPath(rectangle(25, 25, 50, 50), true);
    const c = createCompound([a.id, b.id], { fill: null, stroke: black, strokeWidth: 2, brush: { id: 'lib.cal.round-3' } });
    const { doc } = docWith({ type: 'compound', node: c, kids: [{ ...a, parent: c.id }, { ...b, parent: c.id }] });
    const n = doc.get(c.id);
    expect(isLive(n)).toBe(true);
    const { items } = liveArtwork(doc, n);
    // One outline shape with a ring pair per subpath.
    expect(items).toHaveLength(1);
    expect(items[0].children).toHaveLength(4);
    expect(visualBounds(doc, n).x).toBeCloseTo(-3, 0);
  });

  it('export as plain artwork and expand to editable objects', () => {
    const p = createPath([anchor(20, 100), anchor(380, 100)], false, { fill: null, stroke: black, strokeWidth: 1, brush: { id: 'lib.scatter.dots' } });
    const { doc } = docWith(p);
    const count = liveArtwork(doc, doc.get(p.id)).items.length;
    expect(count).toBeGreaterThan(5);
    const back = svgToDocument(exportSVG(doc, { rect: { x: 0, y: 0, w: 400, h: 300 } }));
    expect(back.leaves()).toHaveLength(count);
    let out;
    doc.transact('expand', () => {
      out = expandNodeAppearance(doc, p.id);
    });
    const g = doc.get(out);
    expect(g.type).toBe('group');
    expect(g.children).toHaveLength(count);
    for (const c of g.children) {
      const k = doc.get(c);
      expect(isLive(k)).toBe(false);
      expect(k.source).toBeUndefined();
      expect(c).not.toContain('~');
    }
  });
});
