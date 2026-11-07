import { describe, it, expect, beforeAll } from 'vitest';
import { installCanvasStub } from './helpers.js';
import { VDocument } from '../src/model/document.js';
import { createPath, defaultLabel } from '../src/model/nodes.js';
import { rectangle } from '../src/model/shapes.js';
import { liveArtwork, expandLive, isLive } from '../src/model/live.js';
import { nodeBounds, transformNodes } from '../src/model/geometry.js';
import { hitTest } from '../src/render/hit.js';
import { exportSVG } from '../src/features/io/svg-export.js';
import { svgToDocument } from '../src/features/io/svg-import.js';
import { rotate, translate, scale } from '../src/lib/matrix.js';
import {
  makeRepeat,
  releaseRepeat,
  repeatMatrices,
  radialGeometry,
  gridLayout,
  setRepeatParams,
  setRepeatMode,
  reflectMatrix,
} from '../src/features/repeat/repeat-model.js';

beforeAll(() => installCanvasStub());

const red = { type: 'solid', color: '#ff0000' };

function setup(mode, opts) {
  const doc = VDocument.create({ width: 600, height: 600 });
  const layer = doc.layers()[0].id;
  const r = createPath(rectangle(80, 20, 40, 60), true, { fill: red, stroke: null });
  let gid;
  doc.transact('add', () => doc.insert(r, layer));
  doc.transact('repeat', () => {
    gid = makeRepeat(doc, [r.id], mode, opts);
  });
  return { doc, gid, rid: r.id, layer };
}

const centers = (doc, g) => liveArtwork(doc, g).items.map((n) => {
  const b = nodeBounds(liveArtwork(doc, g).vdoc, n);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
});

describe('radial repeat', () => {
  it('places instances around the center with the source on top', () => {
    const { doc, gid, rid } = setup('radial', { count: 6, radius: 100 });
    const g = doc.get(gid);
    expect(isLive(g)).toBe(true);
    expect(defaultLabel(g)).toBe('<Radial Repeat>');
    expect(g.children).toEqual([rid]);
    expect(g.live.cx).toBeCloseTo(100);
    expect(g.live.cy).toBeCloseTo(150);
    const geo = radialGeometry(doc, g);
    expect(geo.radius).toBeCloseTo(100);
    expect(geo.angle).toBeCloseTo(-90);
    const cs = centers(doc, g);
    expect(cs).toHaveLength(6);
    // The first instance is the source itself.
    expect(liveArtwork(doc, g).items[0]).toBe(doc.get(rid));
    for (const c of cs) expect(Math.hypot(c.x - 100, c.y - 150)).toBeCloseTo(100);
    // Clockwise on screen: the second instance is to the right of the top.
    expect(cs[1].x).toBeGreaterThan(100);
    expect(cs[3].y).toBeCloseTo(250);
  });

  it('spreads instances over a partial span and reverses overlap', () => {
    const { doc, gid } = setup('radial', { count: 3, radius: 100, span: 90 });
    const cs = centers(doc, doc.get(gid));
    expect(cs[2].x).toBeCloseTo(200);
    expect(cs[2].y).toBeCloseTo(150);
    doc.transact('rev', () => setRepeatParams(doc, gid, { reverse: true }));
    const items = liveArtwork(doc, doc.get(gid)).items;
    expect(items[items.length - 1].id).toBe(doc.get(gid).children[0]);
  });

  it('changes radius and start angle by moving the source', () => {
    const { doc, gid, rid } = setup('radial', { count: 4, radius: 100 });
    doc.transact('radius', () => setRepeatParams(doc, gid, { radius: 50 }));
    expect(radialGeometry(doc, doc.get(gid)).radius).toBeCloseTo(50);
    expect(nodeBounds(doc, doc.get(rid)).y).toBeCloseTo(70);
    doc.transact('angle', () => setRepeatParams(doc, gid, { angle: 0 }));
    const geo = radialGeometry(doc, doc.get(gid));
    expect(geo.angle).toBeCloseTo(0);
    expect(geo.radius).toBeCloseTo(50);
    doc.undo();
    doc.undo();
    expect(radialGeometry(doc, doc.get(gid)).radius).toBeCloseTo(100);
  });

  it('keeps the center with the object under transforms', () => {
    const { doc, gid } = setup('radial', { count: 4, radius: 100 });
    doc.transact('move', () => transformNodes(doc, [gid], translate(10, 20)));
    expect(doc.get(gid).live.cx).toBeCloseTo(110);
    expect(doc.get(gid).live.cy).toBeCloseTo(170);
    doc.transact('rot', () => transformNodes(doc, [gid], rotate(90, 110, 170)));
    const cs = centers(doc, doc.get(gid));
    for (const c of cs) expect(Math.hypot(c.x - 110, c.y - 170)).toBeCloseTo(100);
    // A reflection reverses the turning direction so the pattern is mirrored, not scrambled.
    const before = centers(doc, doc.get(gid));
    doc.transact('flip', () => transformNodes(doc, [gid], scale(-1, 1, 110, 170)));
    const after = centers(doc, doc.get(gid));
    before.forEach((c, i) => {
      expect(after[i].x).toBeCloseTo(220 - c.x);
      expect(after[i].y).toBeCloseTo(c.y);
    });
  });
});

describe('grid repeat', () => {
  it('tiles the source with spacing and measures the whole grid', () => {
    const { doc, gid } = setup('grid', { cols: 3, rows: 2, hSpacing: 10, vSpacing: 5 });
    const g = doc.get(gid);
    expect(repeatMatrices(doc, g)).toHaveLength(6);
    const b = nodeBounds(doc, g);
    expect(b.x).toBeCloseTo(80);
    expect(b.w).toBeCloseTo(3 * 40 + 2 * 10);
    expect(b.h).toBeCloseTo(2 * 60 + 5);
    const lay = gridLayout(doc, g);
    expect(lay.box.w).toBeCloseTo(140);
  });

  it('offsets brick rows and flips alternate rows', () => {
    const { doc, gid } = setup('grid', { cols: 2, rows: 2, hSpacing: 0, vSpacing: 0, gridType: 'brickRow' });
    const cs = centers(doc, doc.get(gid));
    expect(cs[2].x).toBeCloseTo(100 + 20);
    expect(nodeBounds(doc, doc.get(gid)).w).toBeCloseTo(100);
    doc.transact('flip', () => setRepeatParams(doc, gid, { gridType: 'grid', flipRowV: true }));
    const m = repeatMatrices(doc, doc.get(gid));
    expect(m[2][3]).toBeCloseTo(-1);
    expect(m[0]).toBe(null);
  });

  it('follows rotation of the whole grid', () => {
    const { doc, gid } = setup('grid', { cols: 3, rows: 1, hSpacing: 10, vSpacing: 0 });
    doc.transact('rot', () => transformNodes(doc, [gid], rotate(90, 100, 50)));
    const g = doc.get(gid);
    expect(g.live.frame[0]).toBeCloseTo(0);
    expect(g.live.frame[1]).toBeCloseTo(1);
    const b = nodeBounds(doc, g);
    // Rotated a quarter turn: the row runs down the page.
    expect(b.h).toBeCloseTo(140);
    expect(b.w).toBeCloseTo(60);
  });
});

describe('mirror repeat', () => {
  it('reflects the source across its axis', () => {
    const { doc, gid } = setup('mirror');
    const g = doc.get(gid);
    expect(g.live.x1).toBeCloseTo(120);
    const cs = centers(doc, g);
    expect(cs[1].x).toBeCloseTo(140);
    const m = reflectMatrix(0, 0, 1, 1);
    expect(m[0]).toBeCloseTo(0);
    expect(m[1]).toBeCloseTo(1);
  });

  it('switches mode keeping the source', () => {
    const { doc, gid, rid } = setup('mirror');
    doc.transact('mode', () => setRepeatMode(doc, gid, 'grid', { cols: 2, rows: 1, hSpacing: 0 }));
    expect(doc.get(gid).live.mode).toBe('grid');
    expect(nodeBounds(doc, doc.get(rid)).x).toBeCloseTo(80);
    expect(nodeBounds(doc, doc.get(gid)).w).toBeCloseTo(80);
  });
});

describe('repeat as artwork', () => {
  it('hit tests copies to the source and selects the repeat', () => {
    const { doc, rid } = setup('grid', { cols: 2, rows: 1, hSpacing: 10 });
    expect(hitTest(doc, 145, 50, 1)?.id).toBe(rid);
    expect(hitTest(doc, 125, 50, 1)).toBe(null);
  });

  it('exports and expands every instance, and releases to the source', () => {
    const { doc, gid, rid, layer } = setup('radial', { count: 5, radius: 80 });
    const svg = exportSVG(doc, { rect: { x: -200, y: -200, w: 800, h: 800 } });
    expect(svgToDocument(svg).leaves()).toHaveLength(5);
    let ex;
    doc.transact('expand', () => {
      ex = expandLive(doc, gid);
    });
    expect(ex.children).toHaveLength(5);
    doc.undo();
    let out;
    doc.transact('release', () => {
      out = releaseRepeat(doc, gid);
    });
    expect(out).toEqual([rid]);
    expect(doc.get(rid).parent).toBe(layer);
    expect(doc.get(gid)).toBeUndefined();
    doc.undo();
    expect(doc.get(rid).parent).toBe(gid);
  });

  it('nests: a repeat of a repeat', () => {
    const { doc, gid } = setup('radial', { count: 4, radius: 50 });
    let outer;
    doc.transact('grid', () => {
      outer = makeRepeat(doc, [gid], 'grid', { cols: 2, rows: 1, hSpacing: 0 });
    });
    const inner = nodeBounds(doc, doc.get(gid));
    const b = nodeBounds(doc, doc.get(outer));
    expect(b.w).toBeCloseTo(inner.w * 2);
    const svg = exportSVG(doc, { rect: { x: -200, y: -200, w: 800, h: 800 } });
    expect(svgToDocument(svg).leaves()).toHaveLength(8);
  });
});
