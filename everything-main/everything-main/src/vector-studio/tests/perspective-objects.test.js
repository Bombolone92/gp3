import { describe, it, expect, beforeAll } from 'vitest';
import { installCanvasStub } from './helpers.js';
import { VDocument } from '../src/model/document.js';
import { createPath, createText, createGroup, defaultLabel } from '../src/model/nodes.js';
import { rectangle, ellipse } from '../src/model/shapes.js';
import { liveArtwork, isLive } from '../src/model/live.js';
import { nodeBounds, visualBounds, transformNodes, transformFromOriginals, collectOriginals } from '../src/model/geometry.js';
import { translate, scale } from '../src/lib/matrix.js';
import { hitTest, marqueeHits } from '../src/render/hit.js';
import { exportSVG } from '../src/features/io/svg-export.js';
import { svgToDocument } from '../src/features/io/svg-import.js';
import '../src/features/perspective/project.js';
import { gridOf, setGrid, frameFor, isPerspective, hasStoredGrid } from '../src/features/perspective/model.js';
import { toDoc, toFlat, localScale } from '../src/features/perspective/grid-math.js';
import { attachToPlane, releaseWithPerspective, movePlaneToMatch, movePlane, setTextContent, perspectiveTexts, childOriginals, splitPerspective } from '../src/features/perspective/ops.js';
import { projectedOutlines, setOutlineLoader, onOutlinesReady } from '../src/features/perspective/project.js';

beforeAll(() => installCanvasStub());

const red = { type: 'solid', color: '#ff0000' };

function setup() {
  const doc = VDocument.create({ width: 612, height: 792 });
  const layer = doc.layers()[0].id;
  const g = gridOf(doc);
  // A rectangle on the right side of the corner, below the horizon.
  const r = createPath(rectangle(g.ox + 40, g.oy - 140, 100, 80), true, { fill: red, stroke: null });
  doc.transact('add', () => doc.insert(r, layer));
  return { doc, layer, g, rid: r.id };
}

const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

describe('objects in perspective', () => {
  it('attach keeps the place and apparent size, and stores the grid', () => {
    const { doc, rid } = setup();
    const before = nodeBounds(doc, doc.get(rid));
    expect(hasStoredGrid(doc)).toBe(false);
    let gid;
    doc.transact('attach', () => {
      [gid] = attachToPlane(doc, [rid], 'right');
    });
    expect(hasStoredGrid(doc)).toBe(true);
    const g = doc.get(gid);
    expect(isPerspective(g)).toBe(true);
    expect(isLive(g)).toBe(true);
    expect(defaultLabel(g)).toBe('<Perspective>');
    expect(g.live).toMatchObject({ plane: 'right', offset: 0 });
    expect(g.children).toEqual([rid]);
    const after = nodeBounds(doc, g);
    const c0 = center(before);
    const c1 = center(after);
    expect(Math.hypot(c1.x - c0.x, c1.y - c0.y)).toBeLessThan(2);
    expect(Math.sqrt(after.w * after.h) / Math.sqrt(before.w * before.h)).toBeGreaterThan(0.8);
    expect(Math.sqrt(after.w * after.h) / Math.sqrt(before.w * before.h)).toBeLessThan(1.25);
    // The projected artwork is a quad: four straight corners on the plane.
    const [quad] = liveArtwork(doc, g).items;
    expect(quad.anchors).toHaveLength(4);
    expect(quad.source).toBe(gid);
    expect(quad.fill).toEqual(red);
    doc.undo();
    expect(doc.get(gid)).toBeUndefined();
    expect(doc.get(rid).parent).toBe(doc.layers()[0].id);
    expect(nodeBounds(doc, doc.get(rid))).toEqual(before);
  });

  it('draws, hit tests and marquee-selects the projected artwork', () => {
    const { doc, rid } = setup();
    let gid;
    doc.transact('attach', () => {
      [gid] = attachToPlane(doc, [rid], 'right');
    });
    const b = nodeBounds(doc, doc.get(gid));
    const c = center(b);
    expect(hitTest(doc, c.x, c.y, 1)?.id).toBe(gid);
    expect(hitTest(doc, b.x + b.w + 30, c.y, 1)).toBe(null);
    const hits = marqueeHits(doc, { x: b.x - 5, y: b.y - 5, w: b.w + 10, h: b.h + 10 });
    expect(hits.map((n) => n.id)).toEqual([gid]);
    expect(visualBounds(doc, doc.get(gid)).w).toBeCloseTo(b.w, 6);
    expect(projectedOutlines(doc, doc.get(gid))).toHaveLength(1);
  });

  it('moves within its plane when moved on the page', () => {
    const { doc, rid } = setup();
    let gid;
    doc.transact('attach', () => {
      [gid] = attachToPlane(doc, [rid], 'right');
    });
    const flat0 = nodeBounds(doc, doc.get(rid));
    const b0 = nodeBounds(doc, doc.get(gid));
    doc.transact('move', () => transformNodes(doc, [gid], translate(60, 10)));
    const b1 = nodeBounds(doc, doc.get(gid));
    const c0 = center(b0);
    const c1 = center(b1);
    // The center follows the move on the page.
    expect(Math.hypot(c1.x - c0.x - 60, c1.y - c0.y - 10)).toBeLessThan(3);
    // The flat artwork keeps its size: it only slid along the plane.
    const flat1 = nodeBounds(doc, doc.get(rid));
    expect(flat1.w).toBeCloseTo(flat0.w, 6);
    expect(flat1.h).toBeCloseTo(flat0.h, 6);
    expect(flat1.x).not.toBeCloseTo(flat0.x, 1);
    // Farther toward the vanishing point it looks smaller.
    expect(b1.h).toBeLessThan(b0.h);
    doc.undo();
    expect(nodeBounds(doc, doc.get(rid))).toEqual(flat0);
  });

  it('drags from originals without drift and scales in its plane', () => {
    const { doc, rid } = setup();
    let gid;
    doc.transact('attach', () => {
      [gid] = attachToPlane(doc, [rid], 'right');
    });
    const flat0 = nodeBounds(doc, doc.get(rid));
    const originals = collectOriginals(doc, [gid]);
    const tx = doc.begin('drag');
    for (let i = 1; i <= 5; i++) transformFromOriginals(doc, originals, translate(i * 10, 0));
    transformFromOriginals(doc, originals, translate(0, 0));
    tx.commit();
    const flat1 = nodeBounds(doc, doc.get(rid));
    expect(flat1.x).toBeCloseTo(flat0.x, 6);
    expect(flat1.y).toBeCloseTo(flat0.y, 6);
    // Scaling about the center keeps the center and scales the flat artwork.
    const b = nodeBounds(doc, doc.get(gid));
    const c = center(b);
    doc.transact('scale', () => transformNodes(doc, [gid], scale(2, 2, c.x, c.y)));
    const flat2 = nodeBounds(doc, doc.get(rid));
    expect(flat2.w / flat0.w).toBeGreaterThan(1.7);
    expect(flat2.w / flat0.w).toBeLessThan(2.3);
  });

  it('moves flat artwork exactly with in-plane originals', () => {
    const { doc, rid } = setup();
    let gid;
    doc.transact('attach', () => {
      [gid] = attachToPlane(doc, [rid], 'floor');
    });
    const flat0 = nodeBounds(doc, doc.get(rid));
    const originals = childOriginals(doc, [gid]);
    doc.transact('move', () => transformFromOriginals(doc, originals, translate(30, -15)));
    const flat1 = nodeBounds(doc, doc.get(rid));
    expect(flat1.x - flat0.x).toBeCloseTo(30, 9);
    expect(flat1.y - flat0.y).toBeCloseTo(-15, 9);
  });

  it('releases to ordinary artwork with the projected look', () => {
    const { doc, rid, layer } = setup();
    let gid;
    doc.transact('attach', () => {
      [gid] = attachToPlane(doc, [rid], 'left');
    });
    const projected = liveArtwork(doc, doc.get(gid)).items[0].anchors;
    let out;
    doc.transact('release', () => {
      out = releaseWithPerspective(doc, [gid]);
    });
    expect(doc.get(gid)).toBeUndefined();
    expect(out).toHaveLength(1);
    const path = doc.get(out[0]);
    expect(path.type).toBe('path');
    expect(path.parent).toBe(layer);
    expect(path.source).toBeUndefined();
    path.anchors.forEach((a, i) => {
      expect(a.x).toBeCloseTo(projected[i].x, 9);
      expect(a.y).toBeCloseTo(projected[i].y, 9);
    });
    doc.undo();
    expect(isPerspective(doc.get(gid))).toBe(true);
  });

  it('re-attaching to another plane keeps the flat shape', () => {
    const { doc, rid } = setup();
    let gid;
    doc.transact('attach', () => {
      [gid] = attachToPlane(doc, [rid], 'right');
    });
    const flat0 = nodeBounds(doc, doc.get(rid));
    const c0 = center(nodeBounds(doc, doc.get(gid)));
    doc.transact('attach', () => attachToPlane(doc, [gid], 'floor'));
    expect(doc.get(gid).live.plane).toBe('floor');
    const flat1 = nodeBounds(doc, doc.get(rid));
    expect(flat1.w / flat1.h).toBeCloseTo(flat0.w / flat0.h, 6);
    const c1 = center(nodeBounds(doc, doc.get(gid)));
    expect(Math.hypot(c1.x - c0.x, c1.y - c0.y)).toBeLessThan(15);
  });

  it('follows grid changes and keeps its own plane position', () => {
    const { doc, rid } = setup();
    let gid;
    doc.transact('attach', () => {
      [gid] = attachToPlane(doc, [rid], 'right');
    });
    const b0 = nodeBounds(doc, doc.get(gid));
    // Moving the grid plane leaves the object where it is.
    doc.transact('plane', () => movePlane(doc, 'right', 60));
    expect(nodeBounds(doc, doc.get(gid))).toEqual(b0);
    // Moving the whole grid moves it along.
    const g = gridOf(doc);
    doc.transact('grid', () => setGrid(doc, { ...g, ox: g.ox + 20, vl: g.vl + 20, vr: g.vr + 20, px: g.px + 20 }));
    const b1 = nodeBounds(doc, doc.get(gid));
    expect(b1.x - b0.x).toBeCloseTo(20, 6);
    doc.undo();
    expect(nodeBounds(doc, doc.get(gid)).x).toBeCloseTo(b0.x, 9);
    // Match the plane to the object, then move the plane with its objects.
    doc.transact('match', () => movePlaneToMatch(doc, gid));
    expect(gridOf(doc).planes.right).toBe(0);
    doc.transact('plane', () => movePlane(doc, 'right', 90, true));
    expect(doc.get(gid).live.offset).toBe(90);
    expect(nodeBounds(doc, doc.get(gid))).not.toEqual(b0);
  });

  it('projects curves, strokes and nested groups', () => {
    const { doc, layer } = setup();
    const g = gridOf(doc);
    const e = createPath(ellipse(g.ox + 40, g.oy - 100, 80, 60), true, { fill: null, stroke: red, strokeWidth: 4 });
    const r = createPath(rectangle(g.ox + 150, g.oy - 100, 40, 40), true, { fill: red, stroke: null });
    const grp = createGroup([e.id, r.id]);
    e.parent = grp.id;
    r.parent = grp.id;
    let pid;
    doc.transact('add', () => {
      doc.insert(grp, layer, Infinity, [e, r]);
      [pid] = attachToPlane(doc, [grp.id], 'right');
    });
    const [vg] = liveArtwork(doc, doc.get(pid)).items;
    expect(vg.type).toBe('group');
    const { vdoc } = liveArtwork(doc, doc.get(pid));
    const ve = vdoc.get(vg.children[0]);
    expect(ve.anchors.length).toBeGreaterThan(4);
    const frame = frameFor(gridOf(doc), 'right', 0);
    const flatE = doc.get(e.id);
    const s = localScale(frame, flatE.anchors[0].x, flatE.anchors[0].y);
    expect(ve.strokeWidth).toBeGreaterThan(0);
    expect(ve.strokeWidth).toBeLessThan(4 * 1.5);
    void s;
  });

  it('exports in perspective', () => {
    const { doc, rid } = setup();
    let gid;
    doc.transact('attach', () => {
      [gid] = attachToPlane(doc, [rid], 'right');
    });
    const svg = exportSVG(doc, { rect: { x: 0, y: 0, w: 612, h: 792 } });
    const back = svgToDocument(svg);
    const leaves = back.leaves();
    expect(leaves).toHaveLength(1);
    const b = nodeBounds(back, leaves[0]);
    const want = nodeBounds(doc, doc.get(gid));
    expect(b.x).toBeCloseTo(want.x, 1);
    expect(b.y).toBeCloseTo(want.y, 1);
    expect(b.w).toBeCloseTo(want.w, 1);
  });

  it('round-trips through the file format', () => {
    const { doc, rid } = setup();
    let gid;
    doc.transact('attach', () => {
      [gid] = attachToPlane(doc, [rid], 'floor');
    });
    const b = nodeBounds(doc, doc.get(gid));
    const copy = VDocument.fromJSON(JSON.parse(JSON.stringify(doc.toJSON())));
    expect(copy.root.perspective.type).toBe('two');
    expect(nodeBounds(copy, copy.get(gid))).toEqual(b);
  });

  it('keeps type editable and draws it in perspective', () => {
    const { doc, layer } = setup();
    const g = gridOf(doc);
    const t = createText('Hello', g.ox + 40, g.oy - 60, { char: { fontFamily: 'Inter', fontSize: 24 } });
    let pid;
    doc.transact('add', () => {
      doc.insert(t, layer);
      [pid] = attachToPlane(doc, [t.id], 'right');
    });
    const [vt] = liveArtwork(doc, doc.get(pid)).items;
    // Without font outlines the type draws through the matching affine map.
    expect(vt.type).toBe('text');
    expect(vt.transform).not.toEqual(doc.get(t.id).transform);
    expect(perspectiveTexts(doc, pid).map((n) => n.id)).toEqual([t.id]);
    doc.transact('edit', () => setTextContent(doc, t.id, 'Hello there'));
    expect(doc.get(t.id).text).toBe('Hello there');
    expect(liveArtwork(doc, doc.get(pid)).items[0].text).toBe('Hello there');
    doc.undo();
    expect(doc.get(t.id).text).toBe('Hello');
  });

  it('places artwork that sits beyond the horizon on the plane', () => {
    const doc = VDocument.create({ width: 612, height: 792 });
    const layer = doc.layers()[0].id;
    const g = gridOf(doc);
    const r = createPath(rectangle(g.ox - 20, g.horizon - 200, 40, 40), true, { fill: red });
    let gid;
    doc.transact('add', () => {
      doc.insert(r, layer);
      [gid] = attachToPlane(doc, [r.id], 'floor');
    });
    const b = nodeBounds(doc, doc.get(gid));
    expect(b.y).toBeGreaterThan(g.horizon);
    const p = toFlat(frameFor(gridOf(doc), 'floor', 0), b.x + b.w / 2, b.y + b.h / 2);
    expect(p).not.toBe(null);
    void toDoc;
  });

  it('ungroups into one perspective object per piece of artwork', () => {
    const { doc, layer } = setup();
    const g = gridOf(doc);
    const a = createPath(rectangle(g.ox + 20, g.oy - 100, 30, 30), true, { fill: red });
    const b = createPath(rectangle(g.ox + 80, g.oy - 100, 30, 30), true, { fill: red });
    const grp = createGroup([a.id, b.id]);
    a.parent = grp.id;
    b.parent = grp.id;
    let pid;
    doc.transact('add', () => {
      doc.insert(grp, layer, Infinity, [a, b]);
      [pid] = attachToPlane(doc, [grp.id], 'right');
    });
    const before = [a.id, b.id].map((id) => nodeBounds(doc, doc.get(id)));
    const look = nodeBounds(doc, doc.get(pid));
    let out;
    doc.transact('ungroup', () => {
      out = splitPerspective(doc, [pid]);
    });
    expect(out).toHaveLength(2);
    expect(doc.get(pid)).toBeUndefined();
    out.forEach((id, i) => {
      const n = doc.get(id);
      expect(isPerspective(n)).toBe(true);
      expect(n.children).toEqual([[a.id, b.id][i]]);
      expect(nodeBounds(doc, doc.get(n.children[0]))).toEqual(before[i]);
    });
    // Together they still look the same.
    const u = out.map((id) => nodeBounds(doc, doc.get(id))).reduce((r, q) => ({ x: Math.min(r.x, q.x), y: Math.min(r.y, q.y), x2: Math.max(r.x2, q.x + q.w), y2: Math.max(r.y2, q.y + q.h) }), { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity });
    expect(u.x).toBeCloseTo(look.x, 6);
    expect(u.x2).toBeCloseTo(look.x + look.w, 6);
    doc.undo();
    expect(isPerspective(doc.get(pid))).toBe(true);
  });

  it('draws type as projected glyph outlines once they load', async () => {
    const { doc, layer } = setup();
    const g = gridOf(doc);
    const t = createText('A', g.ox + 40, g.oy - 60);
    // A fake glyph: one square path in the text's own coordinates.
    const glyph = createPath(rectangle(g.ox + 40, g.oy - 70, 8, 10), true, { fill: red });
    const group = createGroup([glyph.id]);
    glyph.parent = group.id;
    let ready = 0;
    const off = onOutlinesReady(() => ready++);
    setOutlineLoader(async () => ({ group, descendants: [glyph] }));
    try {
      let pid;
      doc.transact('add', () => {
        doc.insert(t, layer);
        [pid] = attachToPlane(doc, [t.id], 'right');
      });
      expect(liveArtwork(doc, doc.get(pid)).items[0].type).toBe('text');
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(ready).toBe(1);
      const [vg] = liveArtwork(doc, doc.get(pid)).items;
      expect(vg.type).toBe('group');
      const { vdoc } = liveArtwork(doc, doc.get(pid));
      expect(vdoc.get(vg.children[0]).anchors).toHaveLength(4);
      expect(vdoc.get(vg.children[0]).source).toBe(pid);
    } finally {
      setOutlineLoader(null);
      off();
    }
  });
});
