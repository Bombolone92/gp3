import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createKernel } from '../src/kernel/ops.js';
import { buildShapes, KIND, FLAG } from '../src/kernel/shapes.js';
import { defaultRules } from '../src/model/schema.js';
import { pointInPoly } from '../src/core/geom.js';
import { mm } from '../src/core/units.js';

const wasm = fs.readFileSync(path.resolve(import.meta.dirname, '../src/kernel/kernel.wasm'));

const library = {
  r: {
    id: 'r', name: 'Resistor', prefix: 'R', symbol: { pins: [], graphics: [] },
    footprint: {
      name: 'test',
      pads: [
        { num: '1', x: -mm(1.5), y: 0, shape: 'rect', w: mm(1), h: mm(1), side: 'top' },
        { num: '2', x: mm(1.5), y: 0, shape: 'rect', w: mm(1), h: mm(1), side: 'top' },
      ],
      graphics: [],
      courtyard: { x1: -mm(2.2), y1: -mm(0.8), x2: mm(2.2), y2: mm(0.8) },
    },
  },
  tht: {
    id: 'tht', name: 'Header', prefix: 'J', symbol: { pins: [], graphics: [] },
    footprint: {
      name: 'tht',
      pads: [{ num: '1', x: 0, y: 0, shape: 'round', w: mm(1.7), h: mm(1.7), side: 'thru', drill: mm(1) }],
      graphics: [],
    },
  },
};

const square = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1];

function board(objects, extra = {}) {
  return {
    id: 'b', kind: 'pcb', name: 'Board',
    board: { outline: square(0, 0, mm(30), mm(20)), origin: { x: 0, y: 0 }, copper: 2, thickness: mm(1.6) },
    rules: defaultRules(),
    nets: { GND: {}, VCC: {}, SIG: {} },
    objects,
    ...extra,
  };
}

const inShape = (x, y, rings) => rings.reduce((inside, r) => (pointInPoly(x, y, r) ? !inside : inside), false);

let kernel;
beforeAll(async () => {
  kernel = await createKernel(wasm);
});

describe('shape encoding', () => {
  it('encodes pads, tracks, vias and courtyards', () => {
    const doc = board([
      { id: 'c1', t: 'comp', comp: 'r', x: mm(10), y: mm(10), rot: 0, side: 'top', designator: 'R1', uid: 'u1', padNets: { 1: 'GND', 2: 'VCC' } },
      { id: 't1', t: 'track', layer: 'top', x1: 0, y1: 0, x2: mm(5), y2: 0, w: mm(0.25), net: 'SIG' },
      { id: 'v1', t: 'via', x: mm(3), y: mm(3), d: mm(0.6), drill: mm(0.3), from: 'top', to: 'bottom', net: 'GND' },
      { id: 's1', t: 'track', layer: 'topOverlay', x1: 0, y1: 0, x2: mm(5), y2: 0, w: mm(0.15) },
    ]);
    const s = buildShapes(doc, library);
    expect(s.count).toBe(5); // two pads, courtyard, track, via (silkscreen skipped)
    expect(s.refs.map((r) => r.kind)).toEqual(['pad', 'pad', 'courtyard', 'track', 'via']);
    expect(s.records[0]).toBe(KIND.roundrect);
    expect(s.records[4]).toBe(FLAG.pad);
    expect(s.nets).toEqual(['GND', 'SIG', 'VCC']);
  });
});

describe('copper pours', () => {
  it('fills around other nets and ties same-net pads with thermals', async () => {
    const doc = board([
      { id: 'c1', t: 'comp', comp: 'r', x: mm(10), y: mm(10), rot: 0, side: 'top', designator: 'R1', uid: 'u1', padNets: { 1: 'GND', 2: 'VCC' } },
      { id: 'p1', t: 'pour', layer: 'top', pts: square(mm(1), mm(1), mm(29), mm(19)), net: 'GND', clearance: mm(0.3) },
    ]);
    const fills = await kernel.pours(doc, library);
    const polys = fills.get('p1');
    expect(polys.length).toBeGreaterThanOrEqual(1);
    const hit = (x, y) => polys.some((rings) => inShape(x, y, rings));
    expect(hit(mm(20), mm(5))).toBe(true); // open area
    expect(hit(mm(11.5), mm(10))).toBe(false); // VCC pad
    expect(hit(mm(11.5) + mm(0.5) + mm(0.2), mm(10))).toBe(false); // inside VCC clearance
    expect(hit(mm(8.5) - mm(0.5) - mm(0.1), mm(10) + mm(0.45))).toBe(false); // thermal gap corner of GND pad
    expect(hit(mm(0.5), mm(10))).toBe(false); // outside the pour outline
  });

  it('removes islands and honours priority', async () => {
    const wall = { id: 'w', t: 'track', layer: 'top', x1: mm(15), y1: -mm(1), x2: mm(15), y2: mm(21), w: mm(0.5), net: 'VCC' };
    const via = { id: 'v', t: 'via', x: mm(5), y: mm(10), d: mm(0.6), drill: mm(0.3), from: 'top', to: 'bottom', net: 'GND' };
    const doc = board([
      wall, via,
      { id: 'hi', t: 'pour', layer: 'top', pts: square(mm(20), mm(2), mm(25), mm(8)), net: 'SIG', clearance: mm(0.3), priority: 0, removeIslands: false },
      { id: 'lo', t: 'pour', layer: 'top', pts: square(0, 0, mm(30), mm(20)), net: 'GND', clearance: mm(0.3), priority: 1 },
    ]);
    const fills = await kernel.pours(doc, library);
    const lo = fills.get('lo');
    const hit = (x, y) => lo.some((rings) => inShape(x, y, rings));
    expect(hit(mm(5), mm(15))).toBe(true); // the side with the GND via
    expect(hit(mm(20), mm(15))).toBe(false); // the island beyond the VCC wall
    expect(fills.get('hi').length).toBe(1);

    const only = await kernel.pours(doc, library, { ids: ['hi'] });
    expect([...only.keys()]).toEqual(['hi']);
  });
});

describe('design rule check', () => {
  it('reports clearance, shorts, widths, holes, edges and courtyards', async () => {
    const doc = board([
      { id: 'a', t: 'track', layer: 'top', x1: mm(2), y1: mm(5), x2: mm(10), y2: mm(5), w: mm(0.25), net: 'GND' },
      { id: 'b', t: 'track', layer: 'top', x1: mm(2), y1: mm(5.35), x2: mm(10), y2: mm(5.35), w: mm(0.25), net: 'VCC' },
      { id: 'c', t: 'track', layer: 'top', x1: mm(6), y1: mm(3), x2: mm(6), y2: mm(4.95), w: mm(0.25), net: 'SIG' },
      { id: 'thin', t: 'track', layer: 'bottom', x1: mm(2), y1: mm(15), x2: mm(10), y2: mm(15), w: mm(0.1), net: 'SIG' },
      { id: 'v', t: 'via', x: mm(20), y: mm(15), d: mm(0.38), drill: mm(0.15), from: 'top', to: 'bottom', net: 'GND' },
      { id: 'edge', t: 'track', layer: 'bottom', x1: mm(20), y1: mm(0.2), x2: mm(25), y2: mm(0.2), w: mm(0.2), net: 'SIG' },
      { id: 'c1', t: 'comp', comp: 'r', x: mm(20), y: mm(8), rot: 0, side: 'top', designator: 'R1', uid: 'u1', padNets: { 1: 'GND', 2: 'GND' } },
      { id: 'c2', t: 'comp', comp: 'r', x: mm(23), y: mm(8.5), rot: 0, side: 'top', designator: 'R2', uid: 'u2', padNets: { 1: 'GND', 2: 'GND' } },
    ]);
    const v = await kernel.drc(doc, library);
    const rules = (r) => v.filter((x) => x.rule === r);
    expect(rules('clearance').some((x) => x.ids.includes('a') && x.ids.includes('b'))).toBe(true);
    expect(rules('clearance')[0].message).toMatch(/Clearance 0\.1mm is less than 0\.2mm/);
    expect(rules('short').some((x) => x.ids.includes('a') && x.ids.includes('c'))).toBe(true);
    expect(rules('width').map((x) => x.ids[0])).toEqual(['thin']);
    expect(rules('hole').map((x) => x.ids[0])).toEqual(['v']);
    expect(rules('annular').map((x) => x.ids[0])).toEqual(['v']);
    expect(rules('edge').some((x) => x.ids[0] === 'edge')).toBe(true);
    const court = rules('courtyard');
    expect(court.length).toBe(1);
    expect(court[0].severity).toBe('warning');
    expect(court[0].ids.sort()).toEqual(['c1', 'c2']);
  });

  it('accepts a freshly poured board', async () => {
    const doc = board([
      { id: 'c1', t: 'comp', comp: 'r', x: mm(10), y: mm(10), rot: 45, side: 'top', designator: 'R1', uid: 'u1', padNets: { 1: 'GND', 2: 'VCC' } },
      { id: 'j1', t: 'comp', comp: 'tht', x: mm(20), y: mm(10), rot: 0, side: 'top', designator: 'J1', uid: 'u2', padNets: { 1: 'SIG' } },
      { id: 'p1', t: 'pour', layer: 'top', pts: square(0, 0, mm(30), mm(20)), net: 'GND', clearance: mm(0.3) },
      { id: 'p2', t: 'pour', layer: 'bottom', pts: square(0, 0, mm(30), mm(20)), net: 'GND', clearance: mm(0.3) },
    ]);
    const fills = await kernel.pours(doc, library);
    const v = await kernel.drc(doc, library, { pourFills: fills });
    expect(v.filter((x) => x.rule === 'clearance' || x.rule === 'short' || x.rule === 'edge')).toEqual([]);
  });

  it('checks thousands of objects quickly', async () => {
    const objects = [];
    for (let i = 0; i < 5000; i++) {
      const x = mm(1) + (i % 100) * mm(0.28), y = mm(1) + Math.floor(i / 100) * mm(0.36);
      objects.push({ id: `t${i}`, t: 'track', layer: 'top', x1: x, y1: y, x2: x, y2: y + mm(0.1), w: mm(0.05), net: `N${i}` });
    }
    const doc = board(objects, { rules: { ...defaultRules(), minTrackWidth: 0 } });
    const t0 = performance.now();
    const v = await kernel.drc(doc, library);
    const ms = performance.now() - t0;
    expect(v.filter((x) => x.rule === 'clearance').length).toBe(0);
    expect(ms).toBeLessThan(3000);
  });
});

describe('autorouter', () => {
  it('routes connections and the result passes the rule check', async () => {
    const doc = board([
      { id: 'c1', t: 'comp', comp: 'r', x: mm(6), y: mm(10), rot: 0, side: 'top', designator: 'R1', uid: 'u1', padNets: { 1: 'SIG', 2: 'VCC' } },
      { id: 'c2', t: 'comp', comp: 'r', x: mm(24), y: mm(10), rot: 0, side: 'top', designator: 'R2', uid: 'u2', padNets: { 1: 'VCC', 2: 'SIG' } },
      { id: 'j1', t: 'comp', comp: 'tht', x: mm(15), y: mm(15), rot: 0, side: 'top', designator: 'J1', uid: 'u3', padNets: { 1: 'VCC' } },
    ]);
    const progress = [];
    const res = await kernel.autoroute(doc, library, {}, (p) => progress.push(p));
    expect(res.total).toBe(3);
    expect(res.routed).toBe(3);
    expect(res.failed).toEqual([]);
    expect(res.tracks.length).toBeGreaterThan(0);
    expect(progress.at(-1).done).toBe(3);
    for (const t of res.tracks) expect(['top', 'bottom']).toContain(t.layer);
    let n = 0;
    const routed = {
      ...doc,
      objects: [
        ...doc.objects,
        ...res.tracks.map((t) => ({ id: `rt${n++}`, t: 'track', ...t })),
        ...res.vias.map((v) => ({ id: `rv${n++}`, t: 'via', ...v })),
      ],
    };
    const issues = await kernel.drc(routed, library);
    expect(issues.filter((x) => x.severity === 'error')).toEqual([]);
  });

  it('only routes the requested nets', async () => {
    const doc = board([
      { id: 'c1', t: 'comp', comp: 'r', x: mm(6), y: mm(10), rot: 0, side: 'top', designator: 'R1', uid: 'u1', padNets: { 1: 'SIG', 2: 'VCC' } },
      { id: 'c2', t: 'comp', comp: 'r', x: mm(24), y: mm(10), rot: 0, side: 'top', designator: 'R2', uid: 'u2', padNets: { 1: 'VCC', 2: 'SIG' } },
    ]);
    const res = await kernel.autoroute(doc, library, { nets: ['VCC'] });
    expect(res.total).toBe(1);
    expect(new Set(res.tracks.map((t) => t.net))).toEqual(new Set(['VCC']));
  });
});
