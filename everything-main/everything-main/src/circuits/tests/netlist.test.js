import { describe, it, expect } from 'vitest';
import { buildNetlist, exportShape } from '../src/model/netlist.js';
import { findComponent, cloneDef } from '../src/model/library/builtin.js';
import { mil } from '../src/core/units.js';

// res-0603: pin 1 ends at (-200 mil, 0) facing right, pin 2 at (+200 mil, 0).
const res = cloneDef(findComponent('res-0603'));
const chip = {
  id: 'chip', name: 'Chip', prefix: 'U', footprint: null,
  symbol: {
    graphics: [],
    pins: [
      { num: '1', name: 'A', x: -mil(300), y: 0, length: mil(100), rot: 0, type: 'input' },
      { num: '2', name: 'GND', x: 0, y: -mil(300), length: mil(100), rot: 90, type: 'power', hidden: true },
    ],
  },
};
const lib = { [res.id]: res, chip };

let n = 0;
const part = (designator, x, y, rot = 0, comp = res.id) => ({ id: `p${++n}`, t: 'part', comp, designator, x: mil(x), y: mil(y), rot, uid: `u${n}` });
const wire = (...pts) => ({ id: `w${++n}`, t: 'wire', pts: pts.map(mil) });
const label = (text, x, y) => ({ id: `l${++n}`, t: 'label', text, x: mil(x), y: mil(y), rot: 0 });
const power = (net, x, y, style = 'bar') => ({ id: `pw${++n}`, t: 'power', net, style, x: mil(x), y: mil(y), rot: 0 });
const junction = (x, y) => ({ id: `j${++n}`, t: 'junction', x: mil(x), y: mil(y) });
const sheet = (id, objects) => ({ id, objects });

const netOf = (nl, partId, pin) => nl.byPin.get(`${partId}:${pin}`);

describe('buildNetlist', () => {
  it('joins pins connected by a wire and names the net after its first pin', () => {
    const r1 = part('R1', 0, 0), r2 = part('R2', 1000, 0);
    const nl = buildNetlist([sheet('s', [r1, r2, wire(200, 0, 800, 0)])], lib);
    expect(netOf(nl, r1.id, '2')).toBe('NetR1_2');
    expect(netOf(nl, r2.id, '1')).toBe('NetR1_2');
    // Unconnected pins still get their own single-pin nets.
    expect(netOf(nl, r1.id, '1')).toBe('NetR1_1');
    expect(netOf(nl, r1.id, '1')).not.toBe(netOf(nl, r2.id, '2'));
  });

  it('connects a wire ending on the middle of another wire and adds a junction', () => {
    const r1 = part('R1', 0, 0);
    const r2 = part('R2', 500, 700, 90); // pin 1 ends at (500, 500)
    const nl = buildNetlist([sheet('s', [r1, r2, wire(200, 0, 1000, 0), wire(500, 500, 500, 0)])], lib);
    expect(netOf(nl, r1.id, '2')).toBe(netOf(nl, r2.id, '1'));
    expect(nl.sheets.get('s').junctions).toContainEqual([mil(500), 0]);
  });

  it('does not connect crossing wires unless a junction is placed', () => {
    const r1 = part('R1', 0, 0);
    const r2 = part('R2', 500, 700, 90);
    const objs = [r1, r2, wire(200, 0, 1000, 0), wire(500, 500, 500, -500)];
    const apart = buildNetlist([sheet('s', objs)], lib);
    expect(netOf(apart, r1.id, '2')).not.toBe(netOf(apart, r2.id, '1'));
    expect(apart.sheets.get('s').junctions).toEqual([]);
    const joined = buildNetlist([sheet('s', [...objs, junction(500, 0)])], lib);
    expect(netOf(joined, r1.id, '2')).toBe(netOf(joined, r2.id, '1'));
  });

  it('joins islands with equal net labels on one sheet and across sheets', () => {
    const r1 = part('R1', 0, 0), r2 = part('R2', 2000, 0), r3 = part('R3', 0, 0);
    const a = [r1, wire(200, 0, 400, 0), label('X', 400, 0), r2, wire(1800, 0, 1600, 0), label('X', 1600, 0)];
    const b = [r3, wire(200, 0, 400, 0), label('X', 400, 0)];
    const nl = buildNetlist([sheet('a', a), sheet('b', b)], lib);
    for (const [p, pin] of [[r1, '2'], [r2, '1'], [r3, '2']]) expect(netOf(nl, p.id, pin)).toBe('X');
    const x = nl.nets.find((net) => net.name === 'X');
    expect(x.nodes.map((nd) => nd.ref).sort()).toEqual(['R1', 'R2', 'R3']);
    expect(x.named).toBe(true);
  });

  it('names nets from power ports and joins them globally', () => {
    const r1 = part('R1', 0, 0), r2 = part('R2', 0, 0);
    const nl = buildNetlist([
      sheet('a', [r1, wire(200, 0, 400, 0), power('VCC', 400, 0)]),
      sheet('b', [r2, wire(-200, 0, -400, 0), power('VCC', -400, 0)]),
    ], lib);
    expect(netOf(nl, r1.id, '2')).toBe('VCC');
    expect(netOf(nl, r2.id, '1')).toBe('VCC');
  });

  it('prefers a power port name over a label and reports the other name as an alias', () => {
    const r1 = part('R1', 0, 0);
    const nl = buildNetlist([sheet('s', [r1, wire(200, 0, 600, 0), label('FOO', 400, 0), power('VCC', 600, 0)])], lib);
    expect(netOf(nl, r1.id, '2')).toBe('VCC');
    const net = nl.nets.find((x) => x.name === 'VCC');
    expect(net.aliases).toEqual(['FOO']);
  });

  it('avoids automatic names that collide with user names', () => {
    const r1 = part('R1', 0, 0), r2 = part('R2', 1000, 0);
    const nl = buildNetlist([sheet('s', [r1, r2, wire(200, 0, 800, 0), wire(1200, 0, 1400, 0), label('NetR1_2', 1400, 0)])], lib);
    expect(netOf(nl, r2.id, '2')).toBe('NetR1_2');
    expect(netOf(nl, r1.id, '2')).not.toBe('NetR1_2');
  });

  it('joins hidden power pins to the net named by the pin', () => {
    const u1 = part('U1', 0, 0, 0, 'chip');
    const r1 = part('R1', 0, 1000);
    const nl = buildNetlist([sheet('s', [u1, r1, wire(-200, 1000, -400, 1000), power('GND', -400, 1000, 'gnd')])], lib);
    expect(netOf(nl, u1.id, '2')).toBe('GND');
    expect(netOf(nl, r1.id, '1')).toBe('GND');
    const gnd = nl.nets.find((x) => x.name === 'GND');
    expect(gnd.ground).toBe(true);
    expect(gnd.nodes.find((nd) => nd.ref === 'U1').hidden).toBe(true);
  });

  it('exposes per-sheet wire and point lookups', () => {
    const r1 = part('R1', 0, 0);
    const w = wire(200, 0, 400, 0);
    const nl = buildNetlist([sheet('s', [r1, w, label('SIG', 400, 0)])], lib);
    const si = nl.sheets.get('s');
    expect(si.wireNet.get(w.id)).toBe('SIG');
    expect(si.pointNet(mil(200), 0)).toBe('SIG');
    expect(si.pointNet(mil(9000), 0)).toBe('');
  });
});

describe('exportShape', () => {
  it('lists parts and ref/pin nodes for the exporters', () => {
    const r1 = part('R1', 0, 0), r2 = part('R2', 1000, 0);
    const sheets = [sheet('s', [r2, r1, wire(200, 0, 800, 0)])];
    const out = exportShape(buildNetlist(sheets, lib), sheets, lib);
    expect(out.parts.map((p) => p.ref)).toEqual(['R1', 'R2']);
    expect(out.parts[0].footprint).toBe(res.footprint.name);
    const net = out.nets.find((x) => x.name === 'NetR1_2');
    expect(net.nodes).toEqual([{ ref: 'R1', pin: '2' }, { ref: 'R2', pin: '1' }]);
  });
});
