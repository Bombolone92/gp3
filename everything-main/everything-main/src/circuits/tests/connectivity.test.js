import { describe, it, expect } from 'vitest';
import { analyseBoard, connectedObjects, padPolygon, itemDistance } from '../src/model/connectivity.js';
import { findComponent, cloneDef } from '../src/model/library/builtin.js';
import { bboxOfFlat } from '../src/core/geom.js';
import { mm } from '../src/core/units.js';

// res-0603 pads sit at x = -0.8 mm (pad 1) and +0.8 mm (pad 2), 0.8 x 0.95 mm.
const res = cloneDef(findComponent('res-0603'));
const lib = { [res.id]: res };
const board = { board: { copper: 2, outline: [0, 0, mm(20), 0, mm(20), mm(10), 0, mm(10)] } };

const r1 = { id: 'r1', t: 'comp', comp: res.id, x: mm(2), y: mm(5), rot: 0, side: 'top', designator: 'R1', padNets: { 1: 'A', 2: 'N' } };
const r2 = { id: 'r2', t: 'comp', comp: res.id, x: mm(12), y: mm(5), rot: 0, side: 'top', designator: 'R2', padNets: { 1: 'N', 2: 'B' } };
const P1 = [mm(2.8), mm(5)];   // R1 pad 2 (net N)
const P2 = [mm(11.2), mm(5)];  // R2 pad 1 (net N)
const track = (id, layer, [x1, y1], [x2, y2], net = 'N') => ({ id, t: 'track', layer, x1, y1, x2, y2, w: mm(0.25), net });

const analyse = (objects, opts) => analyseBoard(board, objects, lib, opts);

describe('analyseBoard', () => {
  it('draws one ratsnest line between unconnected pads of a net', () => {
    const a = analyse([r1, r2]);
    expect(a.ratsnest).toHaveLength(1);
    const [l] = a.ratsnest;
    expect(l.net).toBe('N');
    expect([[l.x1, l.y1], [l.x2, l.y2]]).toEqual(expect.arrayContaining([P1, P2]));
    expect(a.unrouted.get('N')).toBe(1);
    // Single-pad nets need no connection.
    expect(a.unrouted.has('A')).toBe(false);
    expect(a.shorts).toEqual([]);
  });

  it('removes the ratsnest line once a track joins the pads', () => {
    const a = analyse([r1, r2, track('t', 'top', P1, P2)]);
    expect(a.ratsnest).toEqual([]);
    expect(a.unrouted.size).toBe(0);
  });

  it('connects through vias across layers', () => {
    const via = { id: 'v1', t: 'via', x: mm(5), y: mm(8), d: mm(0.6), drill: mm(0.3), from: 'top', to: 'bottom', net: 'N' };
    const via2 = { ...via, id: 'v2', x: mm(9) };
    const objs = [r1, r2, track('a', 'top', P1, [mm(5), mm(8)]), track('b', 'bottom', [mm(5), mm(8)], [mm(9), mm(8)]), track('c', 'top', [mm(9), mm(8)], P2), via, via2];
    expect(analyse(objs).ratsnest).toEqual([]);
    // Without the second via the bottom track does not reach the top track.
    expect(analyse(objs.filter((o) => o.id !== 'v2')).unrouted.get('N')).toBe(1);
  });

  it('reports a short when copper of one net touches a pad of another', () => {
    const a = analyse([r1, r2, track('t', 'top', [mm(0.8), mm(5)], [mm(0.8), mm(9)])]);
    expect(a.shorts).toHaveLength(1);
    expect(new Set([a.shorts[0].netA, a.shorts[0].netB])).toEqual(new Set(['N', 'A']));
  });

  it('ignores copper on layers the board does not have', () => {
    const a = analyse([r1, r2, track('t', 'in1', P1, P2)]);
    expect(a.unrouted.get('N')).toBe(1);
  });

  it('lets pour fills connect pads', () => {
    const pour = { id: 'pour', t: 'pour', layer: 'top', net: 'N', pts: [] };
    const strip = [mm(2.7), mm(4.9), mm(11.3), mm(4.9), mm(11.3), mm(5.1), mm(2.7), mm(5.1)];
    const a = analyse([r1, r2, pour], { pourFills: new Map([['pour', [[strip]]]]) });
    expect(a.ratsnest).toEqual([]);
    expect(a.shorts).toEqual([]);
  });

  it('finds every object joined to an object', () => {
    const t = track('t', 'top', P1, P2);
    const a = analyse([r1, r2, t]);
    expect(connectedObjects(a, 't')).toEqual(new Set(['t', 'r1', 'r2']));
  });
});

describe('padPolygon', () => {
  const base = { x: mm(1), y: mm(2), w: mm(2), h: mm(1), rot: 0 };
  const close = (a, b) => expect(Math.abs(a - b)).toBeLessThan(mm(0.01));

  for (const shape of ['round', 'rect', 'roundrect', 'oval']) {
    it(`outlines a ${shape} pad`, () => {
      const pts = padPolygon({ ...base, shape });
      expect(pts.length % 2).toBe(0);
      expect(pts.length).toBeGreaterThanOrEqual(8);
      const b = bboxOfFlat(pts);
      const h = shape === 'round' ? base.w : base.h;
      close(b.maxX - b.minX, base.w);
      close(b.maxY - b.minY, h);
      close((b.minX + b.maxX) / 2, base.x);
      close((b.minY + b.maxY) / 2, base.y);
    });
  }

  it('rotates rectangular pads', () => {
    const b = bboxOfFlat(padPolygon({ ...base, shape: 'rect', rot: 90 }));
    expect(Math.round(b.maxX - b.minX)).toBe(base.h);
    expect(Math.round(b.maxY - b.minY)).toBe(base.w);
  });
});

describe('itemDistance', () => {
  it('measures edge to edge between segments and discs', () => {
    const seg = { kind: 'seg', x1: 0, y1: 0, x2: mm(10), y2: 0, r: mm(0.1), layers: ['top'] };
    const disc = { kind: 'disc', x: mm(5), y: mm(1), r: mm(0.4), layers: ['top'] };
    expect(itemDistance(seg, disc)).toBeCloseTo(mm(0.5), -1);
    expect(itemDistance(disc, seg)).toBeCloseTo(mm(0.5), -1);
    const inside = { kind: 'poly', pts: [mm(4), -mm(1), mm(6), -mm(1), mm(6), mm(1), mm(4), mm(1)], layers: ['top'] };
    expect(itemDistance(seg, inside)).toBeLessThanOrEqual(0);
  });
});
