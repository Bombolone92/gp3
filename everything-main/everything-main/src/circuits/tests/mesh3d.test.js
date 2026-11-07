import { describe, it, expect } from 'vitest';
import { buildBoardScene, padOutline } from '../src/render/mesh3d.js';
import { createViewer3D } from '../src/render/viewer3d.js';
import { mm } from '../src/core/units.js';

const library = {
  'r0805': {
    id: 'r0805', name: 'Resistor', prefix: 'R',
    symbol: { pins: [], graphics: [] },
    footprint: {
      name: '0805',
      pads: [
        { num: '1', x: -mm(1), y: 0, shape: 'roundrect', w: mm(1), h: mm(1.3), side: 'top', radius: 0.25 },
        { num: '2', x: mm(1), y: 0, shape: 'roundrect', w: mm(1), h: mm(1.3), side: 'top', radius: 0.25 },
      ],
      graphics: [{ t: 'line', x1: -mm(0.3), y1: mm(0.8), x2: mm(0.3), y2: mm(0.8), w: mm(0.15), layer: 'topOverlay' }],
      courtyard: { x1: -mm(1.8), y1: -mm(1), x2: mm(1.8), y2: mm(1) },
      body: { w: mm(2), h: mm(1.25), height: mm(0.6), color: '#3a3a3a' },
    },
  },
  'soic3': {
    id: 'soic3', name: 'Blue part', prefix: 'U',
    symbol: { pins: [], graphics: [] },
    footprint: {
      name: 'bottom-test',
      pads: [
        { num: '1', x: -mm(1), y: 0, shape: 'rect', w: mm(0.6), h: mm(1), side: 'top' },
        { num: '2', x: 0, y: 0, shape: 'rect', w: mm(0.6), h: mm(1), side: 'top' },
        { num: '3', x: mm(1), y: 0, shape: 'rect', w: mm(0.6), h: mm(1), side: 'top' },
      ],
      graphics: [],
      body: { w: mm(3), h: mm(2), height: mm(1.5), color: '#3355aa' },
    },
  },
  'hdr2': {
    id: 'hdr2', name: 'Header', prefix: 'J',
    symbol: { pins: [], graphics: [] },
    footprint: {
      name: 'HDR-1x2',
      pads: [
        { num: '1', x: 0, y: 0, shape: 'rect', w: mm(1.7), h: mm(1.7), side: 'thru', drill: mm(1) },
        { num: '2', x: mm(2.54), y: 0, shape: 'round', w: mm(1.7), h: mm(1.7), side: 'thru', drill: mm(1) },
      ],
      graphics: [{ t: 'rect', x1: -mm(1.27), y1: -mm(1.27), x2: mm(3.81), y2: mm(1.27), w: mm(0.15), layer: 'topOverlay' }],
      body: { w: mm(5.08), h: mm(2.54), height: mm(8.5), x: mm(1.27), color: '#222222' },
    },
  },
};

const boardDoc = {
  id: 'b', kind: 'pcb', name: 'Board.pcb',
  board: {
    outline: [0, 0, mm(50), 0, mm(50), mm(30), 0, mm(30)],
    cutouts: [[mm(20), mm(10), mm(25), mm(10), mm(25), mm(15), mm(20), mm(15)]],
    origin: { x: 0, y: 0 }, copper: 2, thickness: mm(1.6),
  },
  rules: {},
  nets: {},
  objects: [
    { id: 'c1', t: 'comp', comp: 'r0805', x: mm(10), y: mm(10), rot: 90, side: 'top', designator: 'R1', uid: 'u1', padNets: { 1: 'VCC', 2: 'N1' } },
    { id: 'c2', t: 'comp', comp: 'hdr2', x: mm(35), y: mm(20), rot: 0, side: 'top', designator: 'J1', uid: 'u2', padNets: {} },
    { id: 'c3', t: 'comp', comp: 'soic3', x: mm(40), y: mm(8), rot: 30, side: 'bottom', designator: 'U1', uid: 'u3', padNets: {} },
    { id: 'v1', t: 'via', x: mm(15), y: mm(20), d: mm(0.6), drill: mm(0.3), from: 'top', to: 'bottom', net: 'VCC' },
    { id: 't1', t: 'track', layer: 'top', x1: mm(10), y1: mm(11), x2: mm(15), y2: mm(20), w: mm(0.25), net: 'VCC' },
    { id: 's1', t: 'track', layer: 'topOverlay', x1: mm(2), y1: mm(2), x2: mm(8), y2: mm(2), w: mm(0.15) },
  ],
};

function strokes(text, x, y, size) {
  // Stand-in for the stroke font: one bar per character.
  return [...text].map((_, i) => [x + i * size, y, x + i * size + size * 0.8, y]);
}

describe('buildBoardScene', () => {
  const scene = buildBoardScene(boardDoc, library, { textStrokes: strokes });

  it('produces meshes with valid indices and unit normals', () => {
    expect(scene.meshes.length).toBeGreaterThan(4);
    for (const m of scene.meshes) {
      const verts = m.positions.length / 3;
      expect(m.normals.length).toBe(m.positions.length);
      expect(m.indices.length % 3).toBe(0);
      expect(m.indices.length).toBeGreaterThan(0);
      for (const i of m.indices) expect(i).toBeLessThan(verts);
      for (let k = 0; k < m.normals.length; k += 3) {
        expect(Math.hypot(m.normals[k], m.normals[k + 1], m.normals[k + 2])).toBeCloseTo(1, 4);
      }
      for (const c of m.color) expect(c >= 0 && c <= 1).toBe(true);
    }
  });

  it('matches the board size and thickness', () => {
    const substrate = scene.meshes.find((m) => m.name === 'substrate');
    const xs = [], ys = [], zs = [];
    for (let k = 0; k < substrate.positions.length; k += 3) {
      xs.push(substrate.positions[k]); ys.push(substrate.positions[k + 1]); zs.push(substrate.positions[k + 2]);
    }
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(50);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(30);
    expect(Math.min(...zs)).toBeCloseTo(0);
    expect(Math.max(...zs)).toBeCloseTo(1.6);
    expect(scene.bounds.min[0]).toBeCloseTo(0);
    expect(scene.bounds.max[0]).toBeCloseTo(50);
    expect(scene.bounds.max[1]).toBeCloseTo(30);
    expect(scene.thickness).toBeCloseTo(1.6);
  });

  it('cuts the board cutout out of the mask caps', () => {
    const mask = scene.meshes.find((m) => m.name === 'mask');
    // No triangle centroid of the top cap lies inside the cutout.
    const p = mask.positions, idx = mask.indices;
    for (let k = 0; k < idx.length; k += 3) {
      const cx = (p[idx[k] * 3] + p[idx[k + 1] * 3] + p[idx[k + 2] * 3]) / 3;
      const cy = (p[idx[k] * 3 + 1] + p[idx[k + 1] * 3 + 1] + p[idx[k + 2] * 3 + 1]) / 3;
      expect(cx > 20 && cx < 25 && cy > 10 && cy < 15).toBe(false);
    }
  });

  it('puts top bodies above the board and bottom bodies below it', () => {
    const top = scene.meshes.find((m) => m.name === 'body:#222222');
    const bottom = scene.meshes.find((m) => m.name === 'body:#3355aa');
    const zs = (m) => [...m.positions].filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs(top))).toBeGreaterThan(1.6);
    expect(Math.max(...zs(top))).toBeCloseTo(1.6 + 0.05 + 8.5, 3);
    expect(Math.max(...zs(bottom))).toBeLessThan(0);
    expect(Math.min(...zs(bottom))).toBeCloseTo(-0.05 - 1.5, 3);
    expect(scene.bounds.min[2]).toBeLessThan(-1.5);
  });

  it('renders exposed pads on both sides for through-hole parts and holes as discs', () => {
    const names = scene.meshes.map((m) => m.name);
    expect(names).toContain('pads:top');
    expect(names).toContain('pads:bottom');
    expect(names).toContain('holes');
    expect(names).toContain('silk:top');
    const bottomPads = scene.meshes.find((m) => m.name === 'pads:bottom');
    // The bottom-side component contributes pads below the board too.
    const zs = [...bottomPads.positions].filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs)).toBeLessThan(0);
    expect(scene.meshes.find((m) => m.name === 'pads:top').metal).toBe(1);
  });

  it('builds without a text function or library entries', () => {
    const s = buildBoardScene({ ...boardDoc, objects: [...boardDoc.objects, { id: 'x', t: 'comp', comp: 'missing', x: 0, y: 0, rot: 0, side: 'top', designator: 'X1', uid: 'x', padNets: {} }] }, library);
    expect(s.meshes.length).toBeGreaterThan(0);
  });

  it('handles an empty board', () => {
    const s = buildBoardScene({ board: {}, objects: [] }, {});
    expect(s.meshes).toEqual([]);
    expect(s.bounds.min).toEqual([0, 0, 0]);
  });
});

describe('padOutline', () => {
  it('rotates rectangular pads', () => {
    const pts = padOutline({ x: 0, y: 0, w: 4, h: 2, shape: 'rect', rot: 90 });
    const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
    expect(Math.max(...xs)).toBeCloseTo(1);
    expect(Math.max(...ys)).toBeCloseTo(2);
  });
});

describe('createViewer3D', () => {
  it('reports unsupported without WebGL2 and never throws', () => {
    const canvas = document.createElement('canvas');
    canvas.getContext = () => null;
    const v = createViewer3D(canvas);
    expect(v.supported).toBe(false);
    expect(() => {
      v.setScene(buildBoardScene(boardDoc, library));
      v.setTheme('light');
      v.setView('top');
      v.fit();
      v.resize();
      v.render();
      v.dispose();
    }).not.toThrow();
  });
});
