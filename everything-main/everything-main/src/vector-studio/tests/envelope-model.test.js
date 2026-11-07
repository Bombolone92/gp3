import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import opentype from 'opentype.js';
import { installCanvasStub } from './helpers.js';
import { VDocument } from '../src/model/document.js';
import { createPath, createGroup, createText, createImage } from '../src/model/nodes.js';
import { rectangle, ellipse } from '../src/model/shapes.js';
import { liveArtwork, liveDef, expandLive } from '../src/model/live.js';
import { warpSubpaths, warpMapping } from '../src/model/warp.js';
import { nodeBounds, transformNodes } from '../src/model/geometry.js';
import { pathBounds } from '../src/model/bezier.js';
import { translate, rotate, scale, multiply, apply } from '../src/lib/matrix.js';
import { registerMeasureFont } from '../src/model/text-layout.js';
import { registerOutlineFont } from '../src/features/type/fonts.js';
import '../src/features/effects/registry.js';
import { createMesh } from '../src/features/mesh/mesh-model.js';
import { addPattern, updatePattern } from '../src/features/patterns/model.js';
import '../src/features/mesh/mesh-live.js';
import {
  evalMesh,
  rectMesh,
  meshFromSurface,
  resampleMesh,
  warpMesh,
  topCorners,
  topMesh,
  envelopeMapping,
  transformLive,
  toleranceFor,
  normalizeOptions,
  isEnvelope,
} from '../src/features/envelope/envelope-model.js';
import { sourceRect, contentRect } from '../src/features/envelope/envelope-live.js';
import { makeEnvelope, releaseEnvelope, resetWithMesh, resetWithWarp, setEnvelopeOptions, setEditingContents } from '../src/features/envelope/envelope-ops.js';
import { triangleMatrix, warpTriangles, warpedImageHooks, bakeWarpedImage } from '../src/features/envelope/warped-image.js';

const solid = (color) => ({ type: 'solid', color });

beforeAll(() => {
  installCanvasStub();
  const buf = readFileSync(resolve(process.cwd(), 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff'));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  registerMeasureFont('Inter', 400, 'normal', font);
  registerOutlineFont('Inter', 400, 'normal', font);
});

function docWith(...nodes) {
  const doc = VDocument.create();
  const layer = doc.root.children[0];
  doc.transact('add', () => nodes.forEach((n) => doc.insert(n, layer)));
  return { doc, layer };
}

function envelope(doc, ids, opts) {
  let id = null;
  doc.transact('Envelope', () => {
    id = makeEnvelope(doc, ids, opts);
  });
  return doc.get(id);
}

const near = (a, b, d = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y) <= d;

describe('mesh surfaces', () => {
  it('a rectangle mesh maps the source rectangle onto itself', () => {
    const r = { x: 10, y: 20, w: 200, h: 100 };
    const m = rectMesh(r, 3, 4);
    expect(m.points.length).toBe(4 * 5);
    for (const [u, v] of [[0, 0], [1, 1], [0.3, 0.7], [0.55, 0.12], [1, 0.5]]) {
      const p = evalMesh(m, u, v);
      expect(p.x).toBeCloseTo(r.x + u * r.w, 6);
      expect(p.y).toBeCloseTo(r.y + v * r.h, 6);
    }
  });

  it('meshes sample affine surfaces exactly', () => {
    const A = multiply(rotate(30), scale(2, 0.5));
    const m = meshFromSurface((u, v) => apply(A, u * 100, v * 50), 2, 2);
    for (const [u, v] of [[0.25, 0.25], [0.8, 0.4], [0.5, 1]]) {
      const want = apply(A, u * 100, v * 50);
      expect(near(evalMesh(m, u, v), want, 1e-4)).toBe(true);
    }
  });

  it('resampling keeps the surface', () => {
    const m = warpMesh({ style: 'arc', bend: 0.4 }, { x: 0, y: 0, w: 200, h: 100 }, 2, 4);
    const r = resampleMesh(m, 4, 8);
    expect(r.rows).toBe(4);
    expect(r.cols).toBe(8);
    for (const [u, v] of [[0.5, 0.5], [0.25, 0.75], [0.1, 0.1]]) expect(near(evalMesh(m, u, v), evalMesh(r, u, v), 0.5)).toBe(true);
    expect(resampleMesh(m, 2, 4)).toBe(m);
  });

  it('a warp mesh passes through the warp at its points and stays close in between', () => {
    const r = { x: 0, y: 0, w: 300, h: 100 };
    const f = warpMapping('arc', { bend: 0.5 }, r);
    const m = warpMesh({ style: 'arc', bend: 0.5 }, r, 2, 6);
    for (const [u, v] of [[0, 0], [0.5, 0.5], [1, 1]]) expect(near(evalMesh(m, u, v), f(r.x + u * r.w, r.y + v * r.h), 1e-6)).toBe(true);
    expect(near(evalMesh(m, 0.41, 0.33), f(123, 33), 1.5)).toBe(true);
  });
});

describe('top object mapping', () => {
  it('a rectangle splits at its own corners', () => {
    const { anchors, corners } = topCorners(rectangle(0, 0, 100, 50));
    expect(anchors.length).toBe(4);
    expect(corners.map((k) => [anchors[k].x, anchors[k].y])).toEqual([[0, 0], [100, 0], [100, 50], [0, 50]]);
  });

  it('a circle splits on its diagonals, where it meets its box corners most closely', () => {
    const { anchors, corners } = topCorners(ellipse(0, 0, 100, 100));
    expect(anchors.length).toBe(8);
    const c = corners.map((k) => anchors[k]);
    const r = 50 / Math.SQRT2;
    expect(near(c[0], { x: 50 - r, y: 50 - r }, 0.5)).toBe(true);
    expect(near(c[1], { x: 50 + r, y: 50 - r }, 0.5)).toBe(true);
    expect(near(c[2], { x: 50 + r, y: 50 + r }, 0.5)).toBe(true);
    expect(near(c[3], { x: 50 - r, y: 50 + r }, 0.5)).toBe(true);
  });

  it('the contents bounds map onto the outline: corners to corners, sides along the outline', () => {
    const content = createPath(rectangle(0, 0, 40, 20), true, { fill: solid('#ff0000') });
    const top = createPath(ellipse(100, 100, 100, 100), true, { fill: solid('#000000') });
    const { doc } = docWith(content, top);
    const env = envelope(doc, [content.id, top.id], { mode: 'top' });
    expect(env.live.top).toBe(true);
    const f = envelopeMapping(env.live, sourceRect(doc, env));
    const r = 50 / Math.SQRT2;
    expect(near(f(0, 0), { x: 150 - r, y: 150 - r }, 0.5)).toBe(true);
    expect(near(f(40, 20), { x: 150 + r, y: 150 + r }, 0.5)).toBe(true);
    // The middle of the top side lands on the top of the circle.
    expect(near(f(20, 0), { x: 150, y: 100 }, 0.5)).toBe(true);
    // A star-like outline with sharp corners keeps exact edges.
    const m = topMesh(rectangle(0, 0, 80, 40));
    expect(m.rows).toBe(1);
    expect(m.cols).toBe(1);
    expect(m.points[0].c).toBeUndefined();
  });

  it('a rectangle top object leaves same-size contents where they are', () => {
    const content = createPath(ellipse(10, 10, 80, 40), true, { fill: solid('#ff0000') });
    const top = createPath(rectangle(10, 10, 80, 40), true, { fill: solid('#000000') });
    const { doc } = docWith(content, top);
    const env = envelope(doc, [content.id, top.id], { mode: 'top' });
    const [out] = liveArtwork(doc, env).items;
    content.anchors.forEach((a, i) => expect(near(out.anchors[i], a, 1e-6)).toBe(true));
  });
});

describe('warp envelopes', () => {
  for (const params of [
    { style: 'arc', bend: 0.5 },
    { style: 'flag', bend: -0.3, vertical: true },
    { style: 'bulge', bend: 0.7, distortH: 0.2, distortV: -0.4 },
  ]) {
    it(`equal the Warp effect geometry (${params.style})`, () => {
      const p = createPath(ellipse(10, 20, 200, 80), true, { fill: solid('#ff0000') });
      const { doc } = docWith(p);
      const env = envelope(doc, [p.id], { mode: 'warp', warp: params });
      const [out] = liveArtwork(doc, env).items;
      const want = warpSubpaths([{ anchors: p.anchors, closed: true }], params.style, params, pathBounds(p.anchors, true))[0].anchors;
      expect(out.anchors.length).toBe(want.length);
      out.anchors.forEach((a, i) => {
        for (const k of ['x', 'y', 'ix', 'iy', 'ox', 'oy']) expect(a[k]).toBeCloseTo(want[i][k], 6);
      });
    });
  }

  it('bend several objects across their common bounds', () => {
    const a = createPath(rectangle(0, 0, 100, 50), true, { fill: solid('#ff0000') });
    const b = createPath(rectangle(100, 0, 100, 50), true, { fill: solid('#00ff00') });
    const { doc } = docWith(a, b);
    const env = envelope(doc, [a.id, b.id], { mode: 'warp', warp: { style: 'arc', bend: 0.5 } });
    expect(sourceRect(doc, env)).toEqual({ x: 0, y: 0, w: 200, h: 50 });
    const [oa, ob] = liveArtwork(doc, env).items;
    // The shared edge stays shared.
    expect(near(oa.anchors.find((p) => Math.abs(p.x - 100) < 1e-6) || oa.anchors[1], ob.anchors[0], 1e-6)).toBe(true);
  });

  it('reset with mesh keeps the shape and reset with warp brings the warp back', () => {
    const p = createPath(rectangle(0, 0, 200, 100), true, { fill: solid('#ff0000') });
    const { doc } = docWith(p);
    const env = envelope(doc, [p.id], { mode: 'warp', warp: { style: 'arc', bend: 0.5 } });
    const before = nodeBounds(doc, env);
    doc.transact('mesh', () => resetWithMesh(doc, env.id, 3, 6, { maintain: true }));
    const m = doc.get(env.id);
    expect(m.live.mode).toBe('mesh');
    expect(m.live.warp).toBeUndefined();
    const after = nodeBounds(doc, m);
    expect(after.w).toBeCloseTo(before.w, 0);
    expect(after.h).toBeCloseTo(before.h, 0);
    doc.transact('flat', () => resetWithMesh(doc, env.id, 2, 2, { maintain: false }));
    expect(nodeBounds(doc, doc.get(env.id))).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    doc.transact('warp', () => resetWithWarp(doc, env.id, { style: 'wave', bend: 0.2 }));
    expect(doc.get(env.id).live).toMatchObject({ mode: 'warp', warp: { style: 'wave', bend: 0.2 } });
    expect(doc.get(env.id).live.mesh).toBeUndefined();
  });
});

describe('contents and options', () => {
  it('Distort Appearance bends effects and scales strokes; without it effects apply afterwards', () => {
    const p = createPath(rectangle(0, 0, 200, 100), true, { fill: solid('#ff0000'), stroke: solid('#000000'), strokeWidth: 4, effects: [{ type: 'roundCorners', radius: 10 }] });
    const { doc } = docWith(p);
    const env = envelope(doc, [p.id], { mode: 'mesh', rows: 1, cols: 1 });
    // Stretch the envelope shape to twice the size: strokes widen with it.
    doc.transact('stretch', () => {
      const L = doc.get(env.id).live;
      doc.update(env.id, { live: { ...L, mesh: rectMesh({ x: 0, y: 0, w: 400, h: 200 }, 1, 1) } });
    });
    let [out] = liveArtwork(doc, doc.get(env.id)).items;
    expect(out.effects).toEqual([]);
    expect(out.anchors.length).toBe(8);
    expect(out.strokeWidth).toBeCloseTo(8, 6);
    doc.transact('opt', () => setEnvelopeOptions(doc, env.id, { distortAppearance: false }));
    [out] = liveArtwork(doc, doc.get(env.id)).items;
    expect(out.effects).toEqual([{ type: 'roundCorners', radius: 10 }]);
    expect(out.anchors.length).toBe(4);
    expect(out.strokeWidth).toBe(4);
  });

  it('linear gradients follow their mapped end points, or bend as bands of color', () => {
    const fill = { type: 'linear', angle: 0, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] };
    const p = createPath(rectangle(0, 0, 200, 100), true, { fill, stroke: solid('#000000'), strokeWidth: 1 });
    const { doc } = docWith(p);
    const env = envelope(doc, [p.id], { mode: 'warp', warp: { style: 'arc', bend: 0.5 } });
    let [out] = liveArtwork(doc, env).items;
    const f = envelopeMapping(env.live, sourceRect(doc, env));
    expect(near({ x: out.fill.x1, y: out.fill.y1 }, f(0, 50), 1e-6)).toBe(true);
    expect(near({ x: out.fill.x2, y: out.fill.y2 }, f(200, 50), 1e-6)).toBe(true);
    doc.transact('opt', () => setEnvelopeOptions(doc, env.id, { distortGradients: true }));
    const art = liveArtwork(doc, doc.get(env.id));
    [out] = art.items;
    expect(out.type).toBe('group');
    const clip = art.vdoc.get(out.children[0]);
    expect(clip.clip).toBe(true);
    const bands = clip.children.slice(0, -1).map((id) => art.vdoc.get(id));
    expect(bands.length).toBeGreaterThan(8);
    const red = (hex) => parseInt(hex.slice(1, 3), 16);
    expect(red(bands[0].fill.color)).toBeGreaterThan(0xf0);
    expect(red(bands[bands.length - 1].fill.color)).toBeLessThan(0x10);
    expect(red(bands[Math.floor(bands.length / 2)].fill.color)).toBeGreaterThan(0x60);
    // The stroke draws on top of the bands.
    expect(art.vdoc.get(out.children[1]).stroke.color).toBe('#000000');
  });

  it('pattern fills stay put, or bend with the shape when patterns distort', () => {
    const tile = { id: 'dot', type: 'path', name: '', anchors: rectangle(2, 2, 6, 6), closed: true, fill: solid('#ff0000'), stroke: null, strokeWidth: 0, hidden: false, locked: false };
    const p = createPath(rectangle(0, 0, 40, 20), true, { fill: { type: 'pattern', id: 'pat1' } });
    const { doc } = docWith(p);
    doc.transact('pattern', () => addPattern(doc, { id: 'pat1', name: 'Dots', width: 10, height: 10, art: { roots: ['dot'], nodes: [tile] } }));
    const env = envelope(doc, [p.id], { mode: 'warp', warp: { style: 'arc', bend: 0.5 } });
    let [out] = liveArtwork(doc, env).items;
    expect(out.fill).toEqual({ type: 'pattern', id: 'pat1' });
    doc.transact('opt', () => setEnvelopeOptions(doc, env.id, { distortPatterns: true }));
    const art = liveArtwork(doc, doc.get(env.id));
    [out] = art.items;
    const clip = art.vdoc.get(out.children[0]);
    expect(clip.clip).toBe(true);
    const pieces = clip.children.slice(0, -1).map((id) => art.vdoc.get(id));
    // 4 x 2 tiles cover the rectangle (plus the ones touching its edges).
    expect(pieces.length).toBeGreaterThanOrEqual(8);
    expect(pieces.every((q) => q.type === 'path' && q.fill.color === '#ff0000')).toBe(true);
    // Editing the pattern regenerates the envelope.
    doc.transact('recolor', () => updatePattern(doc, 'pat1', { art: { roots: ['dot'], nodes: [{ ...tile, fill: solid('#00ff00') }] } }));
    const again = liveArtwork(doc, doc.get(env.id));
    const clip2 = again.vdoc.get(again.items[0].children[0]);
    expect(again.vdoc.get(clip2.children[0]).fill.color).toBe('#00ff00');
  });

  it('clipping groups stay clipping groups with a mapped mask', () => {
    const a = createPath(ellipse(0, 0, 200, 100), true, { fill: solid('#ff0000') });
    const mask = createPath(rectangle(0, 0, 100, 100), true, { fill: null });
    const g = createGroup([a.id, mask.id], { clip: true });
    const { doc, layer } = docWith();
    doc.transact('clip', () => {
      doc.insert(g, layer, Infinity, [{ ...a, parent: g.id }, { ...mask, parent: g.id }]);
    });
    const env = envelope(doc, [g.id], { mode: 'warp', warp: { style: 'bulge', bend: 0.5 } });
    // The source rectangle is the clipped area.
    expect(sourceRect(doc, env)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    const art = liveArtwork(doc, env);
    const [vg] = art.items;
    expect(vg.clip).toBe(true);
    expect(art.vdoc.get(vg.children[1]).type).toBe('path');
  });

  it('type distorts as its outlines', () => {
    const t = createText('Bend', 0, 50, { fontSize: 40, fontFamily: 'Inter' });
    const { doc } = docWith(t);
    const env = envelope(doc, [t.id], { mode: 'warp', warp: { style: 'arc', bend: 0.5 } });
    const art = liveArtwork(doc, env);
    const [g] = art.items;
    expect(g.type).toBe('group');
    const shape = art.vdoc.get(g.children[0]);
    expect(shape.type).toBe('compound');
    expect(shape.children.length).toBeGreaterThan(3);
  });

  it('gradient meshes and nested envelopes inside an envelope are mapped too', () => {
    const pts = [];
    for (let i = 0; i <= 1; i++) for (let j = 0; j <= 1; j++) {
      const x = j * 100;
      const y = i * 100;
      pts.push({ x, y, c: '#ff0000', a: 1, lx: x, ly: y, rx: x, ry: y, ux: x, uy: y, dx: x, dy: y });
    }
    const mesh = createMesh(1, 1, pts);
    const p = createPath(rectangle(100, 0, 100, 100), true, { fill: solid('#00ff00') });
    const { doc } = docWith(mesh, p);
    const inner = envelope(doc, [p.id], { mode: 'warp', warp: { style: 'flag', bend: 0.3 } });
    const env = envelope(doc, [mesh.id, inner.id], { mode: 'mesh', rows: 1, cols: 1 });
    doc.transact('move', () => transformNodes(doc, [env.id], translate(10, 20)));
    const art = liveArtwork(doc, doc.get(env.id));
    expect(art.items[0].type).toBe('mesh');
    expect(art.items[0].points[3].x).toBeCloseTo(110, 6);
    expect(art.items[0].points[3].y).toBeCloseTo(120, 6);
    expect(art.items[1].type).toBe('group');
  });

  it('options normalize to their ranges', () => {
    expect(normalizeOptions({ fidelity: 300, preserve: 'x' })).toMatchObject({ fidelity: 100, preserve: 'clip', distortAppearance: true, antialias: true });
    expect(toleranceFor(50, 200)).toBeCloseTo(Math.max(0.02, Math.min(0.25, 200 * 0.0005)));
    expect(toleranceFor(100, 200)).toBeLessThan(toleranceFor(0, 200));
  });
});

describe('transforms', () => {
  it('transformLive turns the frame and moves mesh points', () => {
    const live = { kind: 'envelope', mode: 'mesh', mesh: rectMesh({ x: 0, y: 0, w: 10, h: 10 }, 1, 1) };
    const out = transformLive(live, multiply(translate(5, 0), rotate(90)));
    expect(out.frame[0]).toBeCloseTo(0, 9);
    expect(out.frame[1]).toBeCloseTo(1, 9);
    expect(out.mesh.points[1].x).toBeCloseTo(5, 9);
    expect(out.mesh.points[1].y).toBeCloseTo(10, 9);
    // Moving alone keeps the frame unset.
    expect(transformLive({ kind: 'envelope', mode: 'warp' }, translate(3, 4)).frame).toBeUndefined();
  });

  it('a rotated warp envelope stays a warp in its own frame', () => {
    const p = createPath(rectangle(0, 0, 200, 100), true, { fill: solid('#ff0000') });
    const { doc } = docWith(p);
    const env = envelope(doc, [p.id], { mode: 'warp', warp: { style: 'arc', bend: 0.5 } });
    const before = liveArtwork(doc, env).items[0].anchors;
    const m = rotate(37, 100, 50);
    doc.transact('rot', () => transformNodes(doc, [env.id], m));
    const turned = doc.get(env.id);
    expect(turned.live.mode).toBe('warp');
    expect(sourceRect(doc, turned).w).toBeCloseTo(200, 6);
    liveArtwork(doc, turned).items[0].anchors.forEach((a, i) => expect(near(a, apply(m, before[i].x, before[i].y), 1e-4)).toBe(true));
    // Editing the contents keeps working in the turned frame.
    doc.transact('edit', () => setEditingContents(doc, env.id, true));
    expect(liveDef(doc.get(env.id)).key).toBe('envelopeContents');
    doc.transact('rot back', () => transformNodes(doc, [env.id], rotate(-37, 100, 50)));
    expect(doc.get(env.id).live.frame).toBeUndefined();
  });
});

describe('edit contents, release and expand', () => {
  it('editing contents names each content object as the source and redraws live', () => {
    const a = createPath(rectangle(0, 0, 100, 50), true, { fill: solid('#ff0000') });
    const b = createPath(rectangle(100, 0, 100, 50), true, { fill: solid('#00ff00') });
    const { doc } = docWith(a, b);
    let env = envelope(doc, [a.id, b.id], { mode: 'mesh', rows: 2, cols: 2 });
    expect(liveArtwork(doc, env).items.every((n) => n.source === env.id)).toBe(true);
    doc.transact('edit', () => setEditingContents(doc, env.id, true));
    env = doc.get(env.id);
    expect(liveArtwork(doc, env).items.map((n) => n.source)).toEqual([a.id, b.id]);
    doc.transact('grow', () => doc.update(b.id, { anchors: rectangle(100, 0, 300, 50) }));
    expect(contentRect(doc, doc.get(env.id))).toEqual({ x: 0, y: 0, w: 400, h: 50 });
    // The contents are refitted into the unchanged envelope.
    expect(nodeBounds(doc, doc.get(env.id))).toEqual({ x: 0, y: 0, w: 200, h: 50 });
    doc.undo();
    doc.undo();
    expect(doc.get(env.id).live.editing).toBeUndefined();
  });

  it('release returns contents in order plus the shape; a top-object envelope gives a path', () => {
    const a = createPath(rectangle(0, 0, 100, 50), true, { fill: solid('#ff0000') });
    const top = createPath(ellipse(0, 0, 100, 100), true, { fill: solid('#000000') });
    const { doc, layer } = docWith(a, top);
    const env = envelope(doc, [a.id, top.id], { mode: 'top' });
    let out;
    doc.transact('release', () => {
      out = releaseEnvelope(doc, env.id);
    });
    expect(out[0]).toBe(a.id);
    const shape = doc.get(out[1]);
    expect(shape.type).toBe('path');
    expect(pathBounds(shape.anchors, true).w).toBeCloseTo(100, 4);
    expect(doc.get(layer).children).toEqual(out);
    expect(isEnvelope(doc.get(env.id))).toBe(false);
  });

  it('expand keeps the look and drops the live object', () => {
    const a = createPath(rectangle(0, 0, 100, 50), true, { fill: solid('#ff0000') });
    const { doc } = docWith(a);
    const env = envelope(doc, [a.id], { mode: 'warp', warp: { style: 'rise', bend: 0.5 } });
    const want = liveArtwork(doc, env).items[0].anchors;
    let g;
    doc.transact('expand', () => {
      g = expandLive(doc, env.id);
    });
    expect(g.type).toBe('group');
    expect(doc.has(env.id)).toBe(false);
    const p = doc.get(g.children[0]);
    expect(p.anchors).toEqual(want);
    expect(p.source).toBeUndefined();
  });
});

describe('warped images', () => {
  it('triangle matrices map source triangles onto their targets', () => {
    const m = triangleMatrix([0, 0], [10, 0], [0, 10], [5, 5], [25, 5], [5, 15]);
    expect(apply(m, 10, 10)).toEqual({ x: 25, y: 15 });
    expect(triangleMatrix([0, 0], [1, 1], [2, 2], [0, 0], [1, 0], [0, 1])).toBe(null);
  });

  it('an image becomes a grid of mapped points with its outline, baked into a raster on expand', () => {
    const img = createImage('a1', 100, 50, [1, 0, 0, 1, 10, 10]);
    const { doc } = docWith(img);
    doc.assets.set('a1', { mime: 'image/png', data: 'data:image/png;base64,AAAA' });
    const env = envelope(doc, [img.id], { mode: 'warp', warp: { style: 'arc', bend: 0.5 } });
    const [w] = liveArtwork(doc, env).items;
    expect(w.type).toBe('warpedImage');
    expect(warpTriangles(w).length).toBe(2 * w.nu * w.nv);
    const f = envelopeMapping(env.live, sourceRect(doc, env));
    expect(near({ x: w.grid[0], y: w.grid[1] }, f(10, 10), 1e-6)).toBe(true);
    expect(nodeBounds(doc, env).w).toBeGreaterThan(90);
    // No decoded image: the original image is kept, clipped to the warped outline.
    const fallback = bakeWarpedImage(doc, w);
    expect(fallback.root.clip).toBe(true);
    expect(fallback.nodes[0].asset).toBe('a1');
    warpedImageHooks.decode = () => ({ naturalWidth: 100, naturalHeight: 50 });
    try {
      const baked = bakeWarpedImage(doc, { ...w, preserve: 'transparency' });
      expect(baked.root.type).toBe('image');
      expect(doc.assets.get(baked.root.asset).data.startsWith('data:image/png;base64,')).toBe(true);
    } finally {
      warpedImageHooks.decode = null;
    }
  });
});
