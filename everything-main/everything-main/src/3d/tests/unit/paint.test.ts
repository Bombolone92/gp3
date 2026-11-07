import { describe, it, expect } from 'vitest';
import { BufferAttribute, BufferGeometry, Ray, Vector3, DoubleSide } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { falloff, symmetryPasses, mirror, blendColor, blendWeight, normalizeVertexWeights, laplacianSmooth, weightColor, type Falloff } from '../../src/paint/math';
import { closestPointTriangle, voxelRemesh } from '../../src/paint/remesh';
import { boneHeatWeights, segmentDistance2 } from '../../src/paint/armweights';
import { grid, cube, uvSphere } from '../../src/mesh/primitives';
import { vertexNeighbors } from '../../src/mesh/mesh';
import { newMeshData, newObject } from '../../src/data/defaults';
import { MeshSession } from '../../src/paint/session';
import { createStrokeState, surfaceDab } from '../../src/paint/sculpt';
import type { PaintBrush } from '../../src/paint/brushes';

describe('brush falloff', () => {
  const types: Falloff[] = ['SMOOTH', 'SPHERE', 'ROOT', 'SHARP', 'LINEAR', 'CONSTANT', 'INVERSE_SQUARE'];
  it('is 1 at the center, 0 at the rim and monotonic', () => {
    for (const t of types) {
      expect(falloff(t, 0)).toBeCloseTo(1);
      expect(falloff(t, 1)).toBe(0);
      expect(falloff(t, 1.5)).toBe(0);
      let prev = 1;
      for (let i = 1; i < 20; i++) {
        const f = falloff(t, i / 20);
        expect(f).toBeLessThanOrEqual(prev + 1e-9);
        expect(f).toBeGreaterThanOrEqual(0);
        prev = f;
      }
    }
  });
  it('matches the curve shapes', () => {
    expect(falloff('LINEAR', 0.25)).toBeCloseTo(0.75);
    expect(falloff('SHARP', 0.5)).toBeCloseTo(0.25);
    expect(falloff('ROOT', 0.75)).toBeCloseTo(0.5);
    expect(falloff('SPHERE', 0.6)).toBeCloseTo(0.8);
    expect(falloff('SMOOTH', 0.5)).toBeCloseTo(0.5);
    expect(falloff('CONSTANT', 0.99)).toBe(1);
    // sharp keeps less strength than smooth away from the center
    expect(falloff('SHARP', 0.3)).toBeLessThan(falloff('SMOOTH', 0.3));
  });
  it('hardness keeps full strength inside the hard core', () => {
    expect(falloff('SMOOTH', 0.4, 0.5)).toBe(1);
    expect(falloff('LINEAR', 0.75, 0.5)).toBeCloseTo(0.5);
  });
});

describe('symmetry', () => {
  it('produces 2^n passes with the identity first', () => {
    expect(symmetryPasses(false, false, false)).toEqual([[1, 1, 1]]);
    expect(symmetryPasses(true, false, false)).toEqual([
      [1, 1, 1],
      [-1, 1, 1],
    ]);
    const all = symmetryPasses(true, true, true);
    expect(all).toHaveLength(8);
    expect(new Set(all.map((s) => s.join(','))).size).toBe(8);
    expect(symmetryPasses(false, true, true)).toHaveLength(4);
  });
  it('mirrors points across the enabled axes', () => {
    expect(mirror([1, 2, 3], [-1, 1, 1])).toEqual([-1, 2, 3]);
    expect(mirror([1, 2, 3], [-1, -1, -1])).toEqual([-1, -2, -3]);
  });
});

describe('blend modes', () => {
  const dst = [0.2, 0.4, 0.6, 1];
  it('mix interpolates by alpha', () => {
    const o = blendColor('MIX', dst, [1, 0, 0], 0.5);
    expect(o[0]).toBeCloseTo(0.6);
    expect(o[1]).toBeCloseTo(0.2);
    expect(o[2]).toBeCloseTo(0.3);
  });
  it('add / subtract / multiply / lighten / darken', () => {
    expect(blendColor('ADD', dst, [0.5, 0.5, 0.5], 1)[2]).toBeCloseTo(1); // clamped
    expect(blendColor('SUB', dst, [0.5, 0.5, 0.5], 1)[0]).toBeCloseTo(0);
    expect(blendColor('MUL', dst, [0.5, 0.5, 0.5], 1)[1]).toBeCloseTo(0.2);
    expect(blendColor('LIGHTEN', dst, [0.3, 0.3, 0.3], 1)).toEqual([0.3, 0.4, 0.6, 1]);
    const d = blendColor('DARKEN', dst, [0.3, 0.3, 0.3], 1);
    expect(d[0]).toBeCloseTo(0.2);
    expect(d[1]).toBeCloseTo(0.3);
    expect(d[2]).toBeCloseTo(0.3);
    expect(blendColor('ERASE_ALPHA', dst, [0, 0, 0], 0.25)[3]).toBeCloseTo(0.75);
  });
  it('weights blend and clamp to 0..1', () => {
    expect(blendWeight('MIX', 0.2, 1, 0.5)).toBeCloseTo(0.6);
    expect(blendWeight('ADD', 0.8, 1, 0.5)).toBeCloseTo(1);
    expect(blendWeight('SUB', 0.2, 1, 0.5)).toBe(0);
    expect(blendWeight('LIGHTEN', 0.7, 0.5, 1)).toBeCloseTo(0.7);
    expect(blendWeight('DARKEN', 0.7, 0.5, 1)).toBeCloseTo(0.5);
  });
});

describe('weight normalization', () => {
  it('keeps the active group and scales the others to sum 1', () => {
    const w = [new Float32Array([0.8]), new Float32Array([0.5]), new Float32Array([0.5])];
    normalizeVertexWeights(w, [0, 1, 2], 0, 0);
    expect(w[0][0]).toBeCloseTo(0.8);
    expect(w[1][0] + w[2][0]).toBeCloseTo(0.2);
    expect(w[1][0]).toBeCloseTo(w[2][0]);
  });
  it('respects locked groups and clamps the active weight to the free budget', () => {
    const w = [new Float32Array([0.9]), new Float32Array([0.4]), new Float32Array([0.3])];
    normalizeVertexWeights(w, [0, 1, 2], 0, 0, [false, true, false]);
    expect(w[1][0]).toBeCloseTo(0.4); // locked
    expect(w[0][0]).toBeCloseTo(0.6); // clamped to 1 - locked
    expect(w[2][0]).toBeCloseTo(0);
    expect(w[0][0] + w[1][0] + w[2][0]).toBeCloseTo(1);
  });
  it('leaves a lone active weight unchanged when nothing can be redistributed', () => {
    const w = [new Float32Array([0.3]), new Float32Array([0])];
    normalizeVertexWeights(w, [0, 1], 0, 0);
    expect(w[0][0]).toBeCloseTo(0.3);
  });
});

describe('smoothing and colors', () => {
  it('laplacian smoothing moves a spike toward its neighbours', () => {
    const g = grid(4, 4, 2);
    const pos = Float32Array.from(g.positions);
    const center = 12; // middle vertex of a 5×5 grid
    pos[center * 3 + 2] = 1;
    const nb = vertexNeighbors({ ...g, positions: pos });
    laplacianSmooth(pos, nb.offsets, nb.neighbors, [center], [1], 1, new Float32Array(3));
    expect(pos[center * 3 + 2]).toBeCloseTo(0);
    pos[center * 3 + 2] = 1;
    laplacianSmooth(pos, nb.offsets, nb.neighbors, [center], [0.5], 1, new Float32Array(3));
    expect(pos[center * 3 + 2]).toBeCloseTo(0.5);
  });
  it('weight heat map goes blue → green → red', () => {
    expect(weightColor(0)).toEqual([0, 0, 1]);
    expect(weightColor(0.5)).toEqual([0, 1, 0]);
    expect(weightColor(1)).toEqual([1, 0, 0]);
  });
});

function sessionFor(arrays: ReturnType<typeof grid>) {
  const me = newMeshData('Test', arrays);
  const ob = newObject('Test', 'MESH', me.id);
  return { me, s: new MeshSession(ob, me) };
}

const brush = (tool: string, extra: Partial<PaintBrush> = {}): PaintBrush =>
  ({
    id: 'b',
    name: tool,
    sculpt_tool: tool,
    mode: 'SCULPT',
    strength: 0.5,
    radius: 50,
    falloff: 'SMOOTH',
    direction: 'ADD',
    auto_smooth_factor: 0,
    spacing: 10,
    normal_radius_factor: 0.5,
    ...extra,
  }) as PaintBrush;

describe('sculpt brushes', () => {
  const up = new Vector3(0, 0, 1),
    view = new Vector3(0, 0, -1);
  it('draw moves vertices along the area normal, Ctrl inverts', () => {
    const { me, s } = sessionFor(grid(20, 20, 2));
    const st = createStrokeState(s, me, brush('DRAW'));
    surfaceDab(st, 'DRAW', new Vector3(0, 0, 0), up, view, 0.5, null, 0.5);
    const c = 220; // center vertex of the 21×21 grid
    expect(s.positions[c * 3 + 2]).toBeGreaterThan(0);
    // vertices outside the radius do not move
    expect(s.positions[2]).toBe(0);
    const inv = createStrokeState(s, me, brush('DRAW'), { invert: true });
    const before = s.positions[c * 3 + 2];
    surfaceDab(inv, 'DRAW', new Vector3(0, 0, 0), up, view, 0.5, null, 0.5);
    surfaceDab(inv, 'DRAW', new Vector3(0, 0, 0), up, view, 0.5, null, 0.5);
    expect(s.positions[c * 3 + 2]).toBeLessThan(before);
  });
  it('falloff makes the center move more than the rim', () => {
    const { me, s } = sessionFor(grid(20, 20, 2));
    const st = createStrokeState(s, me, brush('DRAW'));
    surfaceDab(st, 'DRAW', new Vector3(0, 0, 0), up, view, 0.5, null, 1);
    const center = s.positions[220 * 3 + 2],
      near = s.positions[(220 + 3) * 3 + 2];
    expect(center).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(0);
  });
  it('X symmetry mirrors the dab', () => {
    const { me, s } = sessionFor(grid(20, 20, 2));
    const st = createStrokeState(s, me, brush('DRAW'), {
      symmetry: [true, false, false],
    });
    surfaceDab(st, 'DRAW', new Vector3(0.5, 0.2, 0), up, view, 0.3, null, 0.5);
    // vertex at (0.5, 0.2) and its mirror (-0.5, 0.2)
    const idx = (x: number, y: number) => Math.round((y / 2 + 0.5) * 20) * 21 + Math.round((x / 2 + 0.5) * 20);
    const a = s.positions[idx(0.5, 0.2) * 3 + 2],
      b = s.positions[idx(-0.5, 0.2) * 3 + 2];
    expect(a).toBeGreaterThan(0);
    expect(b).toBeCloseTo(a, 6);
  });
  it('smooth flattens a bump, flatten projects to the area plane', () => {
    const { me, s } = sessionFor(grid(20, 20, 2));
    s.positions[220 * 3 + 2] = 0.3;
    s.recomputeNormals();
    const st = createStrokeState(s, me, brush('SMOOTH', { strength: 1 }));
    surfaceDab(st, 'SMOOTH', new Vector3(0, 0, 0), up, view, 0.4, null, 1);
    expect(s.positions[220 * 3 + 2]).toBeLessThan(0.3);
    const f = createStrokeState(s, me, brush('FLATTEN', { strength: 1 }));
    const before = Math.abs(s.positions[220 * 3 + 2]);
    for (let i = 0; i < 10; i++) surfaceDab(f, 'FLATTEN', new Vector3(0, 0, 0), up, view, 0.4, null, 1);
    expect(Math.abs(s.positions[220 * 3 + 2] - s.positions[(220 + 2) * 3 + 2])).toBeLessThan(before);
  });
  it('inflate pushes along vertex normals of a sphere', () => {
    const { me, s } = sessionFor(uvSphere(32, 16, 1));
    const st = createStrokeState(s, me, brush('INFLATE', { strength: 1 }));
    // top of the sphere
    const top = new Vector3(0, 0, 1);
    surfaceDab(st, 'INFLATE', top, up, view, 0.4, null, 1);
    let maxR = 0;
    for (let v = 0; v < s.nv; v++) maxR = Math.max(maxR, Math.hypot(s.positions[v * 3], s.positions[v * 3 + 1], s.positions[v * 3 + 2]));
    expect(maxR).toBeGreaterThan(1.001);
  });
  it('mask protects vertices', () => {
    const { me, s } = sessionFor(grid(20, 20, 2));
    me.sculpt_mask = new Float32Array(s.nv).fill(1);
    const st = createStrokeState(s, me, brush('DRAW'));
    surfaceDab(st, 'DRAW', new Vector3(0, 0, 0), up, view, 0.5, null, 1);
    expect(s.positions[220 * 3 + 2]).toBe(0);
  });
  it('the BVH raycast hits the expected triangle (indirect face index)', () => {
    const { s } = sessionFor(grid(4, 4, 2));
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(s.positions, 3));
    geo.setIndex(new BufferAttribute(s.tris, 1));
    const bvh = new MeshBVH(geo, { indirect: true });
    const hit = bvh.raycastFirst(new Ray(new Vector3(0.9, 0.9, 1), new Vector3(0, 0, -1)), DoubleSide)!;
    expect(hit).toBeTruthy();
    const t = hit.faceIndex!;
    // the hit triangle contains the point (0.9, 0.9)
    const xs = [0, 1, 2].map((k) => s.positions[s.tris[t * 3 + k] * 3]);
    expect(Math.min(...xs)).toBeLessThanOrEqual(0.9);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(0.9);
    expect(s.triFace[t]).toBe(15);
  });
});

describe('voxel remesh', () => {
  it('closest point on triangle', () => {
    const out = [0, 0, 0];
    closestPointTriangle([0.2, 0.2, 1], [0, 0, 0], [1, 0, 0], [0, 1, 0], out);
    out.forEach((x, i) => expect(x).toBeCloseTo([0.2, 0.2, 0][i]));
    closestPointTriangle([2, -1, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0], out);
    expect(out).toEqual([1, 0, 0]);
  });
  it('remeshes a cube into a closed, outward facing quad surface', () => {
    const c = cube(2);
    const tris: number[] = [];
    for (let f = 0; f < c.offsets.length - 1; f++) {
      const s = c.offsets[f];
      for (let k = 1; k < c.offsets[f + 1] - s - 1; k++) tris.push(c.indices[s], c.indices[s + k], c.indices[s + k + 1]);
    }
    const r = voxelRemesh(c.positions, new Uint32Array(tris), 0.1);
    const nv = r.positions.length / 3;
    expect(nv).toBeGreaterThan(500);
    // bounding box close to the cube
    let max = 0;
    for (let i = 0; i < r.positions.length; i++) max = Math.max(max, Math.abs(r.positions[i]));
    expect(max).toBeGreaterThan(0.9);
    expect(max).toBeLessThan(1.1);
    // closed: every edge is shared by exactly two quads
    const edges = new Map<string, number>();
    for (let f = 0; f < r.quads.length / 4; f++)
      for (let k = 0; k < 4; k++) {
        const a = r.quads[f * 4 + k],
          b = r.quads[f * 4 + ((k + 1) & 3)];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    for (const n of edges.values()) expect(n).toBe(2);
    // signed volume > 0 (faces point outward) and close to the cube volume
    let vol = 0;
    const P = r.positions;
    for (let f = 0; f < r.quads.length / 4; f++) {
      const q = [0, 1, 2, 3].map((k) => r.quads[f * 4 + k] * 3);
      for (const [a, b, d] of [
        [q[0], q[1], q[2]],
        [q[0], q[2], q[3]],
      ])
        vol += (P[a] * (P[b + 1] * P[d + 2] - P[b + 2] * P[d + 1]) - P[a + 1] * (P[b] * P[d + 2] - P[b + 2] * P[d]) + P[a + 2] * (P[b] * P[d + 1] - P[b + 1] * P[d])) / 6;
    }
    expect(vol).toBeGreaterThan(7);
    expect(vol).toBeLessThan(8.5);
  });
});

describe('automatic armature weights', () => {
  it('segment distance', () => {
    expect(segmentDistance2(0, 1, 0, new Vector3(0, 0, 0), new Vector3(0, 0, 2))).toBeCloseTo(1);
    expect(segmentDistance2(0, 0, 3, new Vector3(0, 0, 0), new Vector3(0, 0, 2))).toBeCloseTo(1);
  });
  it('weights sum to one and follow the nearest bone', () => {
    // a tall grid (x: -0.5..0.5, y: 0..4) with two bones along y
    const g = grid(4, 16, 1);
    const pos = Float32Array.from(g.positions);
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = (pos[i + 1] + 0.5) * 4;
    const nb = vertexNeighbors({ ...g, positions: pos });
    const bones = [
      { head: new Vector3(0, 0, 0), tail: new Vector3(0, 2, 0) },
      { head: new Vector3(0, 2, 0), tail: new Vector3(0, 4, 0) },
    ];
    const w = boneHeatWeights(pos, nb.offsets, nb.neighbors, bones);
    const nv = pos.length / 3;
    for (let v = 0; v < nv; v++) {
      expect(w[0][v] + w[1][v]).toBeCloseTo(1, 4);
      const y = pos[v * 3 + 1];
      if (y < 1) expect(w[0][v]).toBeGreaterThan(0.9);
      if (y > 3) expect(w[1][v]).toBeGreaterThan(0.9);
    }
    // smooth transition near the joint
    const mid = [...Array(nv).keys()].find((v) => Math.abs(pos[v * 3 + 1] - 2) < 1e-6)!;
    expect(w[0][mid]).toBeGreaterThan(0.2);
    expect(w[0][mid]).toBeLessThan(0.8);
  });
});
