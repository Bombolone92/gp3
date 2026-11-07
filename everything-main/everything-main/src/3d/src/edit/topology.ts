import { cross, dot, normalize, sub, type Vec3 } from '../core/math';
import { meshAsset, type MeshAsset } from '../core/assets';
import type { Mesh } from '../geometry/protocol';
export type ComponentMode = 'vertex' | 'edge' | 'face';
export interface EditSelection {
  objectId: string;
  mode: ComponentMode;
  ids: number[];
}
export interface Topology {
  positions: Float32Array;
  offsets: Uint32Array;
  indices: Uint32Array;
  uvs: Float32Array;
  normals: Float32Array;
  seams?: Uint32Array;
}
export interface Face {
  vertices: number[];
  uvs: number[];
  normals: number[];
  seams?: number[];
}
export const MAX_EDIT_VERTICES = 4000000,
  MAX_EDIT_FACES = 4000000;
export function position(t: Topology, id: number): Vec3 {
  return Array.from(t.positions.subarray(id * 3, id * 3 + 3)) as Vec3;
}
export function faces(t: Topology): Face[] {
  return Array.from({ length: t.offsets.length - 1 }, (_, f) => {
    const a = t.offsets[f],
      b = t.offsets[f + 1];
    return {
      vertices: Array.from(t.indices.subarray(a, b)),
      uvs: Array.from(t.uvs.subarray(a * 2, b * 2)),
      normals: Array.from(t.normals.subarray(a * 3, b * 3)),
      ...(t.seams ? { seams: Array.from(t.seams.subarray(a, b)) } : {}),
    };
  });
}
export function faceNormal(points: Vec3[]): Vec3 {
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normalize(n);
}
export function pack(positions: ArrayLike<number>, polygons: Face[]): Topology {
  const offsets = [0],
    indices: number[] = [],
    uvs: number[] = [],
    normals: number[] = [];
  for (const f of polygons) {
    indices.push(...f.vertices);
    uvs.push(...f.uvs);
    normals.push(...f.normals);
    offsets.push(indices.length);
  }
  const t = {
    positions: new Float32Array(positions),
    offsets: new Uint32Array(offsets),
    indices: new Uint32Array(indices),
    uvs: new Float32Array(uvs),
    normals: new Float32Array(normals),
  };
  const result: Topology = t;
  if (polygons.some((f) => f.seams))
    result.seams = new Uint32Array(
      polygons.flatMap((f) => f.vertices.map((_, c) => f.seams?.[c] ?? 0)),
    );
  validateTopology(result);
  return result;
}
export function validateTopology(t: Topology) {
  if (t.seams && (t.seams.length !== t.indices.length || t.seams.some((v) => v !== 0 && v !== 1)))
    throw new Error('Invalid UV seam flags.');
  if (
    t.positions.length % 3 ||
    t.positions.length / 3 > MAX_EDIT_VERTICES ||
    !t.offsets.length ||
    t.offsets.length - 1 > MAX_EDIT_FACES ||
    t.offsets[0] !== 0 ||
    t.offsets.at(-1) !== t.indices.length ||
    t.uvs.length !== t.indices.length * 2 ||
    t.normals.length !== t.indices.length * 3
  )
    throw new Error(
      'Invalid topology or mesh size limit exceeded (4,000,000 vertices / faces).',
    );
  if (
    t.positions.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e6) ||
    t.uvs.some((v) => !Number.isFinite(v)) ||
    t.normals.some((v) => !Number.isFinite(v)) ||
    t.indices.some((i) => i >= t.positions.length / 3)
  )
    throw new Error('Mesh contains invalid coordinates or indices.');
  for (let i = 0; i < t.normals.length; i += 3)
    if (Math.abs(Math.hypot(t.normals[i], t.normals[i + 1], t.normals[i + 2]) - 1) > 0.01)
      throw new Error('Mesh normals must have unit length.');
  for (let f = 0; f < t.offsets.length - 1; f++) {
    const a = t.offsets[f],
      b = t.offsets[f + 1];
    if (b - a < 3 || b - a > 64 || new Set(t.indices.subarray(a, b)).size !== b - a)
      throw new Error('Faces must contain 3 to 64 distinct vertices.');
  }
}
export interface Edge {
  a: number;
  b: number;
  faces: number[];
}
const edgeCache = new WeakMap<Topology, Edge[]>();
export function edges(t: Topology): Edge[] {
  let result = edgeCache.get(t);
  if (result) return result;
  const map = new Map<string, Edge>();
  for (let f = 0; f < t.offsets.length - 1; f++)
    for (let c = t.offsets[f]; c < t.offsets[f + 1]; c++) {
      const x = t.indices[c],
        y = t.indices[c + 1 < t.offsets[f + 1] ? c + 1 : t.offsets[f]],
        a = Math.min(x, y),
        b = Math.max(x, y),
        key = `${a}:${b}`;
      let edge = map.get(key);
      if (!edge) {
        edge = { a, b, faces: [] };
        map.set(key, edge);
      }
      edge.faces.push(f);
    }
  result = [...map.values()];
  edgeCache.set(t, result);
  return result;
}
export function countComponents(t: Topology, mode: ComponentMode) {
  return mode === 'vertex'
    ? t.positions.length / 3
    : mode === 'edge'
      ? edges(t).length
      : t.offsets.length - 1;
}
export function selectedVertices(t: Topology, mode: ComponentMode, ids: number[]): number[] {
  const selected = new Set<number>();
  for (const id of ids) {
    if (mode === 'vertex') selected.add(id);
    else if (mode === 'edge') {
      const e = edges(t)[id];
      if (e) {
        selected.add(e.a);
        selected.add(e.b);
      }
    } else for (let c = t.offsets[id]; c < t.offsets[id + 1]; c++) selected.add(t.indices[c]);
  }
  return [...selected].sort((a, b) => a - b);
}
/** Ear clipping supports concave polygons. Reject collapsed/self-intersecting faces atomically. */
export function triangulate(points: Vec3[]): number[] {
  const n = faceNormal(points);
  if (Math.hypot(...n) < 0.5) throw new Error('The edit would collapse a face.');
  const axis =
    Math.abs(n[0]) > Math.abs(n[1])
      ? Math.abs(n[0]) > Math.abs(n[2])
        ? 0
        : 2
      : Math.abs(n[1]) > Math.abs(n[2])
        ? 1
        : 2;
  const p = points.map((v) => [v[(axis + 1) % 3], v[(axis + 2) % 3]]),
    cross2 = (a: number[], b: number[], c: number[]) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const sign = Math.sign(n[axis]),
    remaining = points.map((_, i) => i),
    result: number[] = [];
  const span =
      Math.max(...p.map((v) => v[0])) -
      Math.min(...p.map((v) => v[0])) +
      Math.max(...p.map((v) => v[1])) -
      Math.min(...p.map((v) => v[1])),
    epsilon = Math.max(1e-20, span * span * 1e-10);
  // Exclude crossing non-adjacent polygon edges, including after component transforms.
  for (let i = 0; i < p.length; i++)
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      const a = p[i],
        b = p[(i + 1) % p.length],
        c = p[j],
        d = p[(j + 1) % p.length];
      if (
        cross2(a, b, c) * cross2(a, b, d) < -epsilon * epsilon &&
        cross2(c, d, a) * cross2(c, d, b) < -epsilon * epsilon
      )
        throw new Error('The edit would make a face intersect itself.');
    }
  while (remaining.length > 3) {
    let found = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length],
        b = remaining[i],
        c = remaining[(i + 1) % remaining.length];
      if (cross2(p[a], p[b], p[c]) * sign <= epsilon) continue;
      const inside = remaining.some(
        (v) =>
          v !== a &&
          v !== b &&
          v !== c &&
          cross2(p[a], p[b], p[v]) * sign >= -epsilon &&
          cross2(p[b], p[c], p[v]) * sign >= -epsilon &&
          cross2(p[c], p[a], p[v]) * sign >= -epsilon,
      );
      if (inside) continue;
      result.push(a, b, c);
      remaining.splice(i, 1);
      found = true;
      break;
    }
    if (!found) throw new Error('The edit would create a degenerate polygon.');
  }
  if (cross2(p[remaining[0]], p[remaining[1]], p[remaining[2]]) * sign <= epsilon)
    throw new Error('The edit would collapse a face.');
  result.push(...remaining);
  return result;
}
export function topologyMesh(id: string, t: Topology): MeshAsset {
  validateTopology(t);
  const vertices: number[] = [],
    uvs: number[] = [],
    triangleFaces: number[] = [];
  for (let f = 0; f < t.offsets.length - 1; f++) {
    const start = t.offsets[f],
      ids = Array.from(t.indices.subarray(start, t.offsets[f + 1])),
      points = ids.map((id) => position(t, id));
    for (const [i, c] of triangulate(points).entries()) {
      const corner = start + c;
      vertices.push(...points[c], ...t.normals.subarray(corner * 3, corner * 3 + 3));
      uvs.push(...t.uvs.subarray(corner * 2, corner * 2 + 2));
      if (i % 3 === 0) triangleFaces.push(f);
    }
  }
  const mesh = meshAsset(id, new Float32Array(vertices), new Float32Array(uvs));
  mesh.topology = t;
  mesh.triangleFaces = new Uint32Array(triangleFaces);
  // Include loose vertices in bounds, even when every face has been deleted.
  mesh.min = [0, 0, 0];
  mesh.max = [0, 0, 0];
  if (t.positions.length) {
    mesh.min = [Infinity, Infinity, Infinity];
    mesh.max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < t.positions.length; i++) {
      const a = i % 3;
      mesh.min[a] = Math.min(mesh.min[a], t.positions[i]);
      mesh.max[a] = Math.max(mesh.max[a], t.positions[i]);
    }
  }
  return mesh;
}
export function fromMesh(mesh: Mesh, quads = false): Topology {
  if (mesh.count / 3 > MAX_EDIT_FACES)
    throw new Error('This mesh is too large for Edit Mode (50,000 faces maximum).');
  let extent = 0;
  for (let axis = 0; axis < 3; axis++) {
    let min = Infinity,
      max = -Infinity;
    for (let i = axis; i < mesh.vertices.length; i += 6) {
      min = Math.min(min, mesh.vertices[i]);
      max = Math.max(max, mesh.vertices[i]);
    }
    extent = Math.max(extent, max - min);
  }
  const tolerance = Math.max(extent * 1e-9, 1e-30);
  const positions: number[] = [],
    lookup = new Map<string, number>(),
    polygons: Face[] = [];
  for (let i = 0; i < mesh.count; i += 3) {
    const ids: number[] = [],
      uvs: number[] = [],
      normals: number[] = [];
    for (let j = 0; j < 3; j++) {
      const p = Array.from(mesh.vertices.subarray((i + j) * 6, (i + j) * 6 + 3)),
        key = p.map((v) => Math.round(v / tolerance)).join(':');
      let id = lookup.get(key);
      if (id === undefined) {
        id = positions.length / 3;
        positions.push(...p);
        lookup.set(key, id);
      }
      ids.push(id);
      uvs.push(...(mesh.uvs?.subarray((i + j) * 2, (i + j) * 2 + 2) ?? [0, 0]));
      normals.push(...mesh.vertices.subarray((i + j) * 6 + 3, (i + j) * 6 + 6));
    }
    if (new Set(ids).size === 3) polygons.push({ vertices: ids, uvs, normals });
  }
  if (quads) {
    const merged: Face[] = [];
    for (let i = 0; i < polygons.length; i += 2) {
      const pair = polygons.slice(i, i + 2),
        boundary = pair
          .flatMap((f) =>
            f.vertices.map((a, c) => ({
              a,
              b: f.vertices[(c + 1) % 3],
              uv: f.uvs.slice(c * 2, c * 2 + 2),
              normal: f.normals.slice(c * 3, c * 3 + 3),
            })),
          )
          .filter(
            (e) =>
              !pair.some((f) =>
                f.vertices.some((a, c) => a === e.b && f.vertices[(c + 1) % 3] === e.a),
              ),
          );
      if (boundary.length !== 4) {
        merged.push(...pair);
        continue;
      }
      const loop = [boundary[0]];
      while (loop.length < 4) {
        const next = boundary.find((e) => e.a === loop.at(-1)!.b && !loop.includes(e));
        if (!next) break;
        loop.push(next);
      }
      if (loop.length === 4)
        merged.push({
          vertices: loop.map((e) => e.a),
          uvs: loop.flatMap((e) => e.uv),
          normals: loop.flatMap((e) => e.normal),
        });
      else merged.push(...pair);
    }
    return pack(positions, merged);
  }
  return pack(positions, polygons);
}
export function cloneTopology(t: Topology): Topology {
  return {
    positions: t.positions.slice(),
    offsets: t.offsets.slice(),
    indices: t.indices.slice(),
    uvs: t.uvs.slice(),
    normals: t.normals.slice(),
    ...(t.seams ? { seams: t.seams.slice() } : {}),
  };
}
export function topologyBuffers(t: Topology): ArrayBuffer[] {
  return [
    t.positions.buffer,
    t.offsets.buffer,
    t.indices.buffer,
    t.uvs.buffer,
    t.normals.buffer,
    ...(t.seams ? [t.seams.buffer] : []),
  ] as ArrayBuffer[];
}
