import { describe, it, expect } from 'vitest';
import { schBounds, schHitDistance, rotateSch, mirrorSch, translateSch, connectionPoints, portShape } from '../src/model/sch.js';
import { pcbBounds, pcbHitDistance, rotatePcb, flipComp, compFieldPlacement, translatePcb } from '../src/model/pcb.js';
import { placeFootprint, placeSymbol, transformGraphic } from '../src/model/place.js';
import { makeTransform } from '../src/core/geom.js';
import { findComponent, cloneDef } from '../src/model/library/builtin.js';
import { mil, mm } from '../src/core/units.js';

const res = cloneDef(findComponent('res-0603'));
const lib = { [res.id]: res };
const part = { id: 'p', t: 'part', comp: res.id, x: mil(1000), y: mil(500), rot: 0, mirror: false, designator: 'R1', value: '10k', uid: 'u', fields: { designator: { dx: mil(50), dy: mil(150) }, value: { dx: mil(50), dy: -mil(150) } } };
const label = { id: 'l', t: 'label', x: mil(300), y: mil(200), rot: 0, text: 'NET' };
const port = { id: 'o', t: 'port', x: 0, y: 0, rot: 0, name: 'IO', io: 'bidir' };
const powerPort = { id: 'v', t: 'power', x: mil(100), y: 0, rot: 0, net: 'VCC', style: 'bar' };
const wire = { id: 'w', t: 'wire', pts: [0, 0, mil(500), 0, mil(500), mil(300)] };

const repeat = (o, n, f) => { let r = o; for (let i = 0; i < n; i++) r = f(r); return r; };

describe('schematic geometry', () => {
  it('bounds a part around its pins and fields', () => {
    const b = schBounds(part, lib);
    expect(b.minX).toBeLessThanOrEqual(part.x - mil(200));
    expect(b.maxX).toBeGreaterThanOrEqual(part.x + mil(200));
    expect(b.maxY).toBeGreaterThan(part.y + mil(150));
  });

  it('hits parts inside their body and wires near their segments', () => {
    expect(schHitDistance(part, part.x, part.y, lib)).toBe(0);
    expect(schHitDistance(wire, mil(250), mil(10), lib)).toBe(mil(10));
    expect(schHitDistance(wire, mil(510), mil(150), lib)).toBe(mil(10));
    expect(schHitDistance(part, part.x + mil(2000), part.y, lib)).toBeGreaterThan(mil(1000));
  });

  it('returns to the start after four quarter turns and two mirrors', () => {
    for (const o of [part, label, port, powerPort, wire, { id: 'r', t: 'grect', x1: 0, y1: 0, x2: mil(100), y2: mil(200), w: 0 }]) {
      expect(repeat(o, 4, (x) => rotateSch(x, mil(100), mil(100), 90))).toEqual(o);
      expect(repeat(o, 2, (x) => mirrorSch(x, mil(100), mil(100), 'x'))).toEqual(o);
      expect(repeat(o, 2, (x) => mirrorSch(x, mil(100), mil(100), 'y'))).toEqual(o);
    }
  });

  it('rotates a part about a point and moves its pins with it', () => {
    const r = rotateSch(part, part.x, part.y, 90);
    expect(r.rot).toBe(90);
    const pins = placeSymbol(res, r).pins;
    expect(pins.map((p) => [p.x, p.y])).toEqual([[part.x, part.y - mil(200)], [part.x, part.y + mil(200)]]);
    expect(r.fields.designator).toEqual({ dx: -mil(150), dy: mil(50) });
  });

  it('mirrors a part by flipping it and negating the rotation', () => {
    const m = mirrorSch({ ...part, rot: 90 }, part.x, part.y, 'x');
    expect(m.mirror).toBe(true);
    expect(m.rot).toBe(270);
    // Mirroring about y adds a half turn.
    expect(mirrorSch({ ...part, rot: 90 }, part.x, part.y, 'y').rot).toBe(90);
  });

  it('translates every kind of object', () => {
    expect(translateSch(wire, 10, 20).pts).toEqual([10, 20, mil(500) + 10, 20, mil(500) + 10, mil(300) + 20]);
    expect(translateSch(label, 10, 20)).toMatchObject({ x: label.x + 10, y: label.y + 20 });
  });

  it('reports connection points of parts, ports and power ports', () => {
    expect(connectionPoints(part, lib)).toEqual([[part.x - mil(200), part.y], [part.x + mil(200), part.y]]);
    const { w } = portShape(port);
    expect(connectionPoints(port, lib)).toEqual([[0, 0], [w, 0]]);
    expect(connectionPoints({ ...port, rot: 90 }, lib)[1]).toEqual([0, w]);
    expect(connectionPoints(powerPort, lib)).toEqual([[mil(100), 0]]);
    expect(connectionPoints(wire, lib)).toHaveLength(3);
  });
});

describe('placement', () => {
  it('places symbol pins with the body end toward the body', () => {
    const pins = placeSymbol(res, { ...part, x: 0, y: 0 }).pins;
    const p1 = pins.find((p) => p.num === '1');
    expect([p1.x, p1.y, p1.bx, p1.by]).toEqual([-mil(200), 0, -mil(200) + res.symbol.pins[0].length, 0]);
  });

  it('flips footprints on the bottom side', () => {
    const top = placeFootprint(res, { x: mm(10), y: mm(5), rot: 0, side: 'top', padNets: { 2: 'N' } });
    const bottom = placeFootprint(res, { x: mm(10), y: mm(5), rot: 0, side: 'bottom', padNets: { 2: 'N' } });
    const t2 = top.pads.find((p) => p.num === '2'), b2 = bottom.pads.find((p) => p.num === '2');
    expect(t2.x).toBe(mm(10.8));
    expect(b2.x).toBe(mm(9.2));
    expect(t2.side).toBe('top');
    expect(b2.side).toBe('bottom');
    expect(b2.layers.copper).toEqual(['bottom']);
    expect(b2.net).toBe('N');
    const layersOf = (pl) => new Set(pl.graphics.map((g) => g.layer));
    expect(layersOf(top).has('topOverlay')).toBe(true);
    expect(layersOf(bottom).has('bottomOverlay')).toBe(true);
    expect(layersOf(bottom).has('topOverlay')).toBe(false);
  });

  it('adds the component rotation to pad rotation', () => {
    const pl = placeFootprint(res, { x: 0, y: 0, rot: 90, side: 'top', padNets: {} });
    const p2 = pl.pads.find((p) => p.num === '2');
    expect(p2.rot).toBe(90);
    expect([p2.x, p2.y]).toEqual([0, mm(0.8)]);
  });

  it('keeps arc sweeps positive when mirrored', () => {
    const arc = { t: 'arc', cx: 0, cy: 0, r: 100, a0: 0, sweep: 90, w: 1 };
    const m = transformGraphic(arc, makeTransform(0, 0, 0, true));
    expect(m.sweep).toBe(90);
    expect(m.a0).toBe(90);
    const r = transformGraphic(arc, makeTransform(0, 0, 90, false));
    expect(r.a0).toBe(90);
  });
});

describe('board geometry', () => {
  const comp = { id: 'c', t: 'comp', comp: res.id, x: mm(10), y: mm(10), rot: 0, side: 'top', designator: 'R1', padNets: {} };
  const track = { id: 't', t: 'track', layer: 'bottom', x1: 0, y1: 0, x2: mm(10), y2: 0, w: mm(0.4) };

  it('bounds tracks by their width and components by their footprint', () => {
    expect(pcbBounds(track, lib)).toEqual({ minX: -mm(0.2), minY: -mm(0.2), maxX: mm(10.2), maxY: mm(0.2) });
    const b = pcbBounds(comp, lib);
    expect(b.minX).toBeLessThan(mm(9.2));
    expect(b.maxX).toBeGreaterThan(mm(10.8));
  });

  it('only hits objects on visible layers', () => {
    expect(pcbHitDistance(track, mm(5), mm(0.1), lib)).toBe(0);
    expect(pcbHitDistance(track, mm(5), mm(0.5), lib)).toBe(mm(0.3));
    expect(pcbHitDistance(track, mm(5), 0, lib, { layers: new Set(['top']) })).toBe(Infinity);
    expect(pcbHitDistance(comp, mm(10.8), mm(10), lib, { layers: new Set(['top', 'topOverlay']) })).toBe(0);
  });

  it('returns to the start after four quarter turns and two flips', () => {
    expect(repeat(track, 4, (o) => rotatePcb(o, mm(3), mm(1), 90))).toEqual(track);
    expect(repeat(comp, 4, (o) => rotatePcb(o, mm(3), mm(1), 90))).toEqual(comp);
    const withField = { ...comp, rot: 30, fields: { designator: { dx: mm(1), dy: mm(2) } } };
    expect(flipComp(flipComp(withField))).toEqual(withField);
    expect(flipComp(withField)).toMatchObject({ side: 'bottom', rot: 330, fields: { designator: { dx: -mm(1), dy: mm(2) } } });
  });

  it('translates polygons and point objects', () => {
    expect(translatePcb({ t: 'pour', pts: [0, 0, 10, 0, 10, 10] }, 5, 7).pts).toEqual([5, 7, 15, 7, 15, 17]);
    expect(translatePcb({ t: 'via', x: 1, y: 2 }, 5, 7)).toMatchObject({ x: 6, y: 9 });
  });

  it('places bottom-side designators on the bottom overlay, mirrored', () => {
    const top = compFieldPlacement(comp, 'designator', res);
    const bottom = compFieldPlacement({ ...comp, side: 'bottom' }, 'designator', res);
    expect(top).toMatchObject({ layer: 'topOverlay', mirror: false, hidden: false });
    expect(bottom).toMatchObject({ layer: 'bottomOverlay', mirror: true });
    expect(top.y).toBeGreaterThan(comp.y);
    expect(compFieldPlacement(comp, 'value', res).hidden).toBe(true);
  });
});
