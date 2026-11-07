import { describe, it, expect } from 'vitest';
import { runErc } from '../src/model/erc.js';
import { buildNetlist } from '../src/model/netlist.js';
import { findComponent, cloneDef } from '../src/model/library/builtin.js';
import { mil } from '../src/core/units.js';

const res = cloneDef(findComponent('res-0603'));
// A buffer: input on the left (pin end at -300 mil), output and nc on the right.
const buf = {
  id: 'buf', name: 'Buffer', prefix: 'U', footprint: { name: 'X', pads: [], graphics: [] },
  symbol: {
    graphics: [],
    pins: [
      { num: '1', name: 'IN', x: -mil(300), y: 0, length: mil(100), rot: 0, type: 'input' },
      { num: '2', name: 'OUT', x: mil(300), y: 0, length: mil(100), rot: 180, type: 'output' },
      { num: '3', name: 'NC', x: mil(300), y: -mil(100), length: mil(100), rot: 180, type: 'nc' },
    ],
  },
};
const lib = { [res.id]: res, buf };

let n = 0;
const part = (designator, x, y, comp = res.id) => ({ id: `p${++n}`, t: 'part', comp, designator, x: mil(x), y: mil(y), rot: 0, uid: `u${n}` });
const wire = (...pts) => ({ id: `w${++n}`, t: 'wire', pts: pts.map(mil) });

function erc(objects, opts) {
  const sheets = [{ id: 's', name: 'S', objects }];
  return runErc(sheets, lib, buildNetlist(sheets, lib), opts);
}
const rules = (list) => list.map((m) => m.rule);
const find = (list, rule) => list.filter((m) => m.rule === rule);

describe('runErc', () => {
  it('flags duplicate and unannotated designators', () => {
    const list = erc([part('R1', 0, 0), part('R1', 1000, 0), part('R?', 2000, 0)]);
    expect(find(list, 'duplicate-designator')).toHaveLength(1);
    expect(find(list, 'unannotated')).toHaveLength(1);
    expect(find(list, 'unannotated')[0].severity).toBe('error');
  });

  it('treats an unconnected input as an error and a passive pin as a warning', () => {
    const list = erc([part('U1', 0, 0, 'buf'), part('R1', 2000, 0)]);
    const unconnected = find(list, 'unconnected-pin');
    const input = unconnected.find((m) => m.message.includes('U1-1'));
    const passive = unconnected.find((m) => m.message.includes('R1-1'));
    expect(input.severity).toBe('error');
    expect(passive.severity).toBe('warning');
    // Errors sort before warnings.
    expect(list.findIndex((m) => m.severity === 'warning')).toBeGreaterThan(list.findLastIndex((m) => m.severity === 'error'));
    expect(input.x).toBe(-mil(300));
  });

  it('suppresses unconnected warnings at a no-ERC marker', () => {
    const list = erc([part('R1', 0, 0), { id: 'x', t: 'noerc', x: -mil(200), y: 0 }]);
    const unconnected = find(list, 'unconnected-pin');
    expect(unconnected.some((m) => m.message.includes('R1-1'))).toBe(false);
    expect(unconnected.some((m) => m.message.includes('R1-2'))).toBe(true);
  });

  it('warns when a not-connected pin is wired', () => {
    // U1 pin 3 (nc) ends at (300, -100); R1 pin 1 ends at (800, -100).
    const list = erc([part('U1', 0, 0, 'buf'), part('R1', 1000, -100), wire(300, -100, 800, -100)]);
    expect(find(list, 'nc-connected')).toHaveLength(1);
  });

  it('reports several outputs driving one net', () => {
    const u1 = part('U1', 0, 0, 'buf'), u2 = part('U2', 1000, 0, 'buf');
    // U1 OUT at (300,0), U2 OUT at (1300,0): joined by a wire.
    const list = erc([u1, u2, wire(300, 0, 1300, 0)]);
    expect(find(list, 'output-conflict')).toHaveLength(1);
    expect(find(list, 'output-conflict')[0].severity).toBe('error');
  });

  it('reports floating net labels and dangling wire ends', () => {
    const list = erc([{ id: 'l', t: 'label', text: 'LONELY', x: mil(5000), y: mil(5000), rot: 0 }, wire(0, 2000, 500, 2000)]);
    expect(find(list, 'floating-label')).toHaveLength(1);
    expect(find(list, 'dangling-wire')).toHaveLength(2);
  });

  it('does not call a wire end dangling when it lands on a pin', () => {
    const list = erc([part('R1', 0, 0), wire(200, 0, 600, 0)]);
    const dangling = find(list, 'dangling-wire');
    expect(dangling).toHaveLength(1);
    expect(dangling[0].x).toBe(mil(600));
  });

  it('reports parts whose component definition is missing', () => {
    const list = erc([part('X1', 0, 0, 'nope')]);
    expect(rules(list)).toContain('missing-component');
  });

  it('can skip the footprint check', () => {
    const noFp = { ...buf, id: 'nofp', footprint: null };
    lib.nofp = noFp;
    expect(rules(erc([part('U1', 0, 0, 'nofp')]))).toContain('no-footprint');
    expect(rules(erc([part('U1', 0, 0, 'nofp')], { requireFootprints: false }))).not.toContain('no-footprint');
  });

  it('is quiet on a fully connected circuit', () => {
    const list = erc([part('R1', 0, 0), part('R2', 1000, 0), wire(200, 0, 800, 0), wire(-200, 0, -200, -500, 1200, -500, 1200, 0)]);
    expect(list).toEqual([]);
  });
});
