import { describe, it, expect } from 'vitest';
import { Batch } from '../src/render/batch.js';
import { buildPcbLayers, emitPcbObject, layerDrawOrder, buildBoardShape } from '../src/render/pcb-scene.js';
import { buildSchematic } from '../src/render/sch-scene.js';
import { PCB_PALETTES, SCH_PALETTES } from '../src/render/palette.js';
import { pack } from '../src/render/color.js';
import { createExampleProject } from '../src/app/demo.js';
import { findComponent, cloneDef } from '../src/model/library/builtin.js';
import { defaultRules } from '../src/model/schema.js';
import { boardLayers, copperLayers } from '../src/model/layers.js';
import { mil, mm } from '../src/core/units.js';

const C = pack('#ff0000');

/** Sum of triangle areas in square micrometres. */
function triArea(b) {
  const { f, stride, count } = b.bufs.tri;
  let area = 0;
  for (let i = 0; i < count; i += 3) {
    const o = i * stride;
    const ax = f[o], ay = f[o + 1], bx = f[o + stride], by = f[o + stride + 1], cx = f[o + 2 * stride], cy = f[o + 2 * stride + 1];
    area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  }
  return area;
}

/** Segments as rounded tuples, for comparing two text renderings. */
function segs(b) {
  const { f, stride, count } = b.bufs.seg;
  const out = [];
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    const a = [Math.round(f[o]), Math.round(f[o + 1])], c = [Math.round(f[o + 2]), Math.round(f[o + 3])];
    out.push(a[0] < c[0] || (a[0] === c[0] && a[1] <= c[1]) ? [...a, ...c] : [...c, ...a]);
  }
  return out.map(String).sort();
}

describe('Batch', () => {
  it('counts each primitive kind and clears', () => {
    const b = new Batch();
    b.line(0, 0, 1000, 0, 100, C);
    b.polyline([0, 0, 10, 0, 10, 10], 0, C, true);
    b.circle(0, 0, 500, C);
    b.ring(0, 0, 500, 100, C);
    b.rect(0, 0, 100, 50, 45, 10, C);
    b.rectOutline(0, 0, 10, 10, 1, C);
    b.arc(0, 0, 100, 0, 90, 10, C);
    const k = b.bufs;
    expect([k.seg.count, k.circ.count, k.rect.count, k.arc.count, k.tri.count]).toEqual([1 + 3 + 4, 2, 1, 1, 0]);
    expect(b.empty).toBe(false);
    const v = b.version;
    b.clear();
    expect(b.empty).toBe(true);
    expect(b.version).toBeGreaterThan(v);
  });

  it('stores micrometres and packs half widths and colors', () => {
    const b = new Batch();
    b.line(1000, 2000, 3000, 4000, 500, C);
    const { f, u } = b.bufs.seg;
    expect([...f.subarray(0, 5)]).toEqual([1, 2, 3, 4, 0.25]);
    expect(u[5]).toBe(C);
  });

  it('grows past its initial capacity without losing data', () => {
    const b = new Batch();
    for (let i = 0; i < 1000; i++) b.line(i * 1000, 0, i * 1000, 1000, 0, C);
    const s = b.bufs.seg;
    expect(s.count).toBe(1000);
    expect(s.capacity).toBeGreaterThanOrEqual(1000);
    expect(s.f[999 * s.stride]).toBe(999);
    expect(s.f[0]).toBe(0);
  });

  it('triangulates polygons with holes', () => {
    const b = new Batch();
    const outer = [0, 0, mm(10), 0, mm(10), mm(10), 0, mm(10)];
    const hole = [mm(3), mm(3), mm(3), mm(7), mm(7), mm(7), mm(7), mm(3)];
    b.poly([outer, hole], C);
    expect(b.bufs.tri.count % 3).toBe(0);
    expect(triArea(b)).toBeCloseTo(10000 * 10000 - 4000 * 4000, -2);
    const before = b.bufs.tri.count;
    b.poly([[0, 0, 1, 1]], C); // degenerate: ignored
    expect(b.bufs.tri.count).toBe(before);
  });

  it('draws text as segments and keeps upright text readable', () => {
    const b = new Batch();
    b.text('', 0, 0, mm(1), C);
    expect(b.empty).toBe(true);
    b.text('AB', 0, 0, mm(1), C);
    expect(b.bufs.seg.count).toBeGreaterThan(4);
    // Upside-down upright text equals unrotated text with the opposite anchor.
    const flipped = new Batch(), plain = new Batch();
    flipped.text('R12', 0, 0, mm(1), C, { rot: 180, upright: true });
    plain.text('R12', 0, 0, mm(1), C, { rot: 0, align: { h: 'right', v: 'top' } });
    expect(segs(flipped)).toEqual(segs(plain));
  });
});

describe('board scene', () => {
  const res = cloneDef(findComponent('res-0603'));
  const hdr = cloneDef(findComponent('hdr-1x02'));
  const lib = { [res.id]: res, [hdr.id]: hdr };
  const ctx = { lib, count: 2, pal: PCB_PALETTES.dark, colors: {}, rules: defaultRules(), pourFills: null };
  const objects = [
    { id: 'r', t: 'comp', comp: res.id, x: 0, y: 0, rot: 0, side: 'top', designator: 'R1', padNets: {} },
    { id: 'h', t: 'comp', comp: hdr.id, x: mm(10), y: 0, rot: 0, side: 'top', designator: 'J1', padNets: {} },
    { id: 't', t: 'track', layer: 'bottom', x1: 0, y1: 0, x2: mm(5), y2: 0, w: mm(0.3) },
    { id: 'v', t: 'via', x: mm(5), y: 0, d: mm(0.6), drill: mm(0.3), from: 'top', to: 'bottom' },
  ];

  it('rebuilds only the requested layers', () => {
    const batches = new Map(boardLayers(2).concat(['holes']).map((l) => [l, new Batch()]));
    const versions = new Map([...batches].map(([l, b]) => [l, b.version]));
    buildPcbLayers(batches, ['top'], objects, ctx);
    for (const [l, b] of batches) {
      if (l === 'top') { expect(b.version).toBeGreaterThan(versions.get(l)); expect(b.bufs.rect.count).toBe(2); }
      else { expect(b.version).toBe(versions.get(l)); expect(b.empty).toBe(true); }
    }
    buildPcbLayers(batches, ['bottom', 'multi', 'holes'], objects, ctx, new Set(['v']));
    expect(batches.get('bottom').bufs.seg.count).toBe(1);
    // The hidden via draws nothing; the header's two drilled pads remain.
    expect(batches.get('holes').bufs.circ.count).toBe(2);
  });

  it('sends through-hole pads to the multi layer and their holes to the hole layer', () => {
    const hits = [];
    emitPcbObject(objects[1], (l) => { hits.push(l); return null; }, ctx);
    expect(hits).toContain('multi');
    expect(hits).toContain('holes');
    expect(hits).toContain('topSolder');
    expect(hits).not.toContain('top');
    const smd = [];
    emitPcbObject(objects[0], (l) => { smd.push(l); return null; }, ctx);
    expect(smd).toContain('top');
    expect(smd).toContain('topPaste');
    expect(smd).not.toContain('multi');
  });

  it('draws the active copper layer above the other copper layers', () => {
    for (const count of [2, 4]) {
      for (const active of copperLayers(count)) {
        const order = layerDrawOrder(count, active);
        for (const other of copperLayers(count)) if (other !== active) expect(order.indexOf(active)).toBeGreaterThan(order.indexOf(other));
        expect(new Set(order).size).toBe(order.length);
      }
    }
    const silk = layerDrawOrder(2, 'topOverlay');
    expect(silk.indexOf('topOverlay')).toBeGreaterThan(silk.indexOf('top'));
  });

  it('fills the board shape with cutouts', () => {
    const b = new Batch();
    buildBoardShape(b, { outline: [0, 0, mm(10), 0, mm(10), mm(10), 0, mm(10)], cutouts: [[mm(4), mm(4), mm(4), mm(6), mm(6), mm(6), mm(6), mm(4)]] }, PCB_PALETTES.light);
    expect(triArea(b)).toBeCloseTo(10000 * 10000 - 2000 * 2000, -2);
    expect(b.bufs.seg.count).toBe(8);
  });
});

describe('schematic scene', () => {
  it('builds geometry for every kind of schematic object', () => {
    const project = createExampleProject();
    const sheet = project.sheets[0];
    const b = new Batch(), paper = new Batch();
    const nl = project.netlist();
    buildSchematic(b, sheet, project.library, SCH_PALETTES.light, { sheetBatch: paper, junctions: nl.sheets.get(sheet.id).junctions });
    const base = b.bufs.seg.count;
    expect(base).toBeGreaterThan(100);
    expect(paper.bufs.rect.count).toBeGreaterThan(0);

    sheet.store.transact('extras', (s) => {
      s.add({ t: 'bus', pts: [0, 0, mil(500), 0] });
      s.add({ t: 'junction', x: mil(100), y: mil(100) });
      s.add({ t: 'port', x: mil(200), y: mil(200), rot: 90, name: 'DATA', io: 'out' });
      s.add({ t: 'noerc', x: mil(300), y: mil(300) });
      s.add({ t: 'text', x: mil(400), y: mil(400), text: 'Hello\nWorld', size: mil(70) });
      s.add({ t: 'gline', pts: [0, 0, mil(100), mil(100)], w: 0 });
      s.add({ t: 'grect', x1: 0, y1: 0, x2: mil(100), y2: mil(100), w: 0, fill: true });
      s.add({ t: 'gcircle', cx: 0, cy: 0, r: mil(50), w: 0 });
      for (const style of ['gnd', 'signalgnd', 'earth', 'arrow', 'circle', 'wave', 'bar']) s.add({ t: 'power', x: 0, y: 0, rot: 270, net: style, style });
      s.add({ t: 'label', x: 0, y: 0, rot: 270, text: 'L' });
      s.add({ t: 'part', comp: 'missing', x: 0, y: 0, rot: 0, designator: 'X1', uid: 'x' });
    });
    expect(() => buildSchematic(b, sheet, project.library, SCH_PALETTES.dark, {})).not.toThrow();
    expect(b.bufs.seg.count).toBeGreaterThan(base);
    expect(b.bufs.circ.count).toBeGreaterThan(0);
  });

  it('leaves out hidden objects', () => {
    const project = createExampleProject();
    const sheet = project.sheets[0];
    const all = new Batch(), some = new Batch();
    buildSchematic(all, sheet, project.library, SCH_PALETTES.light, { sheetBatch: new Batch() });
    const hidden = new Set([...sheet.items()].filter((o) => o.t === 'part').map((o) => o.id));
    buildSchematic(some, sheet, project.library, SCH_PALETTES.light, { sheetBatch: new Batch(), hidden });
    expect(some.bufs.seg.count).toBeLessThan(all.bufs.seg.count);
  });
});
