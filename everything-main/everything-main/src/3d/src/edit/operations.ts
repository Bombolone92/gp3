import { layoutUV, type UVLayoutOperation } from './unwrap';
import { projectUV, transformUV, type UVTransformOperation, type UVOperation } from './uv';
import { meshTool, type ToolOperation } from './mesh-tools';
import {
  add,
  cross,
  dot,
  mul,
  normalize,
  sub,
  identity,
  inverse,
  transpose,
  type Vec3,
} from '../core/math';
import {
  faces,
  pack,
  position,
  faceNormal,
  selectedVertices,
  edges,
  triangulate,
  type Topology,
  type ComponentMode,
  type Face,
} from './topology';
export interface Kernels {
  transform: (positions: Float32Array, matrix: Float32Array) => Float32Array;
  inset: (positions: Float32Array, distance: number) => Float32Array;
}
export type MeshOperation =
  | UVLayoutOperation
  | UVTransformOperation
  | UVOperation
  | ToolOperation
  | {
      type: 'transform';
      mode: ComponentMode;
      ids: number[];
      matrix: Float32Array;
    }
  | {
      type: 'extrude' | 'inset';
      mode: ComponentMode;
      ids: number[];
      amount: number;
    }
  | { type: 'delete'; mode: ComponentMode; ids: number[] };
function flat(face: Face, positions: ArrayLike<number>) {
  const n = faceNormal(
    face.vertices.map((id) => [positions[id * 3], positions[id * 3 + 1], positions[id * 3 + 2]]),
  );
  face.normals = face.vertices.flatMap(() => n);
  return face;
}
export function operate(
  t: Topology,
  operation: MeshOperation,
  kernels: Kernels,
): { topology: Topology; ids: number[]; mode?: ComponentMode } {
  if (operation.type === 'seams' || operation.type === 'unwrap' || operation.type === 'uv-pack')
    return layoutUV(t, operation);
  if (operation.type === 'uv-transform')
    return {
      topology: transformUV(t, operation),
      ids: operation.ids,
      mode: operation.mode,
    };
  if (operation.type === 'uv') return projectUV(t, operation);
  if (
    operation.type === 'bevel' ||
    operation.type === 'loopcut' ||
    operation.type === 'merge' ||
    operation.type === 'dissolve'
  )
    return meshTool(t, operation);
  const selected = new Set(operation.ids),
    polygons = faces(t);
  if (!selected.size) throw new Error('Select mesh components first.');
  if (operation.type === 'transform') {
    const ids = selectedVertices(t, operation.mode, operation.ids),
      changed = new Set(ids),
      positions = t.positions.slice();
    const transformed = kernels.transform(
      new Float32Array(ids.flatMap((id) => position(t, id))),
      operation.matrix,
    );
    ids.forEach((id, i) => positions.set(transformed.subarray(i * 3, i * 3 + 3), id * 3));
    if (ids.length === t.positions.length / 3) {
      const normals = kernels.transform(t.normals, transpose(inverse(operation.matrix)));
      for (let f = 0; f < polygons.length; f++)
        polygons[f].normals = polygons[f].vertices.flatMap((_, c) =>
          normalize(
            Array.from(
              normals.subarray((t.offsets[f] + c) * 3, (t.offsets[f] + c) * 3 + 3),
            ) as Vec3,
          ),
        );
    } else {
      // Per-corner normal groups preserve hard edges and smooth normals across UV seams.
      const key = (f: Face, c: number) =>
        `${f.vertices[c]}:${f.normals
          .slice(c * 3, c * 3 + 3)
          .map((v) => Math.round(v * 1e5))
          .join(',')}`;
      const affected = new Set<string>(),
        sums = new Map<string, Vec3>();
      for (const f of polygons)
        if (f.vertices.some((id) => changed.has(id)))
          f.vertices.forEach((_, c) => affected.add(key(f, c)));
      for (const f of polygons) {
        const points = f.vertices.map(
          (id) => Array.from(positions.subarray(id * 3, id * 3 + 3)) as Vec3,
        );
        let n: Vec3 = [0, 0, 0];
        for (let i = 1; i < points.length - 1; i++)
          n = add(n, cross(sub(points[i], points[0]), sub(points[i + 1], points[0])));
        f.vertices.forEach((_, c) => {
          const k = key(f, c);
          if (affected.has(k)) sums.set(k, add(sums.get(k) ?? [0, 0, 0], n));
        });
      }
      for (const f of polygons) {
        const keys = f.vertices.map((_, c) => key(f, c));
        keys.forEach((k, c) => {
          if (sums.has(k)) f.normals.splice(c * 3, 3, ...normalize(sums.get(k)!));
        });
      }
    }
    return { topology: pack(positions, polygons), ids: operation.ids };
  }
  if (operation.type === 'delete') {
    const removeVertices = operation.mode === 'vertex' ? selected : new Set<number>(),
      removeFaces = operation.mode === 'face' ? selected : new Set<number>();
    if (operation.mode === 'edge')
      for (const id of selected) for (const f of edges(t)[id]?.faces ?? []) removeFaces.add(f);
    const remaining = polygons.filter(
        (f, i) => !removeFaces.has(i) && !f.vertices.some((id) => removeVertices.has(id)),
      ),
      positions: number[] = [],
      remap = new Map<number, number>();
    for (let i = 0; i < t.positions.length / 3; i++)
      if (!removeVertices.has(i)) {
        remap.set(i, positions.length / 3);
        positions.push(...position(t, i));
      }
    for (const f of remaining) f.vertices = f.vertices.map((id) => remap.get(id)!);
    return { topology: pack(positions, remaining), ids: [] };
  }
  if (operation.mode !== 'face') throw new Error('Switch to Face selection to extrude or inset.');
  if (
    !Number.isFinite(operation.amount) ||
    Math.abs(operation.amount) > 10000 ||
    operation.amount === 0
  )
    throw new Error('Enter a non-zero distance between -10,000 and 10,000.');
  const positions = Array.from(t.positions),
    caps: number[] = [];
  if (operation.type === 'extrude') {
    const selectedEdges = new Map<
      string,
      { a: number; b: number; face: number; corner: number }[]
    >();
    let normal: Vec3 = [0, 0, 0];
    for (const f of selected) {
      const face = polygons[f];
      if (!face) throw new Error('Invalid face selection.');
      const points = face.vertices.map((id) => position(t, id)),
        n = faceNormal(points);
      for (let i = 1; i < points.length - 1; i++)
        normal = add(
          normal,
          mul(n, Math.hypot(...cross(sub(points[i], points[0]), sub(points[i + 1], points[0])))),
        );
      face.vertices.forEach((a, c) => {
        const b = face.vertices[(c + 1) % face.vertices.length],
          key = `${Math.min(a, b)}:${Math.max(a, b)}`,
          entries = selectedEdges.get(key) ?? [];
        entries.push({ a, b, face: f, corner: c });
        selectedEdges.set(key, entries);
      });
    }
    if (Math.hypot(...normal) < 1e-8)
      throw new Error('Select an open face region with a consistent normal.');
    for (const entries of selectedEdges.values())
      if (entries.length > 2 || (entries.length === 2 && entries[0].a === entries[1].a))
        throw new Error('Extrusion requires a consistently wound, manifold face region.');
    const boundary = [...selectedEdges.values()].filter((e) => e.length === 1).map((e) => e[0]);
    if (!boundary.length) throw new Error('Select a face region with a boundary to extrude.');
    // An existing non-manifold boundary cannot be repaired by extrusion.
    const invalidEdges = edges(t).filter((e) => e.faces.length > 2);
    if (
      boundary.some((e) =>
        invalidEdges.some((b) => b.a === Math.min(e.a, e.b) && b.b === Math.max(e.a, e.b)),
      )
    )
      throw new Error('Cannot extrude a non-manifold boundary.');
    const ids = selectedVertices(t, 'face', operation.ids),
      matrix = identity();
    matrix.set(mul(normalize(normal), operation.amount), 12);
    const moved = kernels.transform(new Float32Array(ids.flatMap((id) => position(t, id))), matrix),
      remap = new Map<number, number>();
    ids.forEach((id, i) => {
      remap.set(id, positions.length / 3);
      positions.push(...moved.subarray(i * 3, i * 3 + 3));
    });
    for (const f of selected) {
      polygons[f].vertices = polygons[f].vertices.map((id) => remap.get(id)!);
      caps.push(f);
    }
    for (const edge of boundary) {
      const a = edge.a,
        b = edge.b,
        length = Math.hypot(...sub(position(t, b), position(t, a)));
      polygons.push(
        flat(
          {
            vertices: [a, b, remap.get(b)!, remap.get(a)!],
            ...(t.seams
              ? {
                  seams: [
                    t.seams[t.offsets[edge.face] + edge.corner],
                    0,
                    t.seams[t.offsets[edge.face] + edge.corner],
                    0,
                  ],
                }
              : {}),
            uvs: [
              0,
              0,
              length,
              0,
              length,
              Math.abs(operation.amount),
              0,
              Math.abs(operation.amount),
            ],
            normals: [],
          },
          positions,
        ),
      );
    }
  } else {
    if (operation.amount <= 0) throw new Error('Inset distance must be greater than zero.');
    for (const f of selected) {
      const original = polygons[f];
      if (!original) throw new Error('Invalid face selection.');
      const points = original.vertices.map((id) => position(t, id)),
        inner = kernels.inset(new Float32Array(points.flat()), operation.amount),
        newIds: number[] = [],
        newUVs: number[] = [],
        newNormals: number[] = [];
      // Interpolate per-corner UVs in the original triangulation, preserving seams.
      const triangles = triangulate(points);
      for (let i = 0; i < points.length; i++) {
        const p = Array.from(inner.subarray(i * 3, i * 3 + 3)) as Vec3;
        newIds.push(positions.length / 3);
        positions.push(...p);
        let uv: number[] | undefined;
        for (let j = 0; j < triangles.length; j += 3) {
          const ia = triangles[j],
            ib = triangles[j + 1],
            ic = triangles[j + 2],
            a = points[ia],
            v0 = sub(points[ib], a),
            v1 = sub(points[ic], a),
            v2 = sub(p, a),
            d00 = dot(v0, v0),
            d01 = dot(v0, v1),
            d11 = dot(v1, v1),
            denom = d00 * d11 - d01 * d01;
          if (Math.abs(denom) < 1e-20) continue;
          const v = (d11 * dot(v2, v0) - d01 * dot(v2, v1)) / denom,
            w = (d00 * dot(v2, v1) - d01 * dot(v2, v0)) / denom,
            u = 1 - v - w;
          if (Math.min(u, v, w) >= -1e-5) {
            uv = [0, 1].map(
              (axis) =>
                original.uvs[ia * 2 + axis] * u +
                original.uvs[ib * 2 + axis] * v +
                original.uvs[ic * 2 + axis] * w,
            );
            newNormals.push(
              ...normalize(
                [0, 1, 2].map(
                  (axis) =>
                    original.normals[ia * 3 + axis] * u +
                    original.normals[ib * 3 + axis] * v +
                    original.normals[ic * 3 + axis] * w,
                ) as Vec3,
              ),
            );
            break;
          }
        }
        if (!uv) throw new Error('Inset exceeds the face boundary. Use a smaller distance.');
        newUVs.push(...uv);
      }
      const cap: Face = { vertices: newIds, uvs: newUVs, normals: newNormals };
      polygons[f] = cap;
      caps.push(f);
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        polygons.push({
          vertices: [original.vertices[i], original.vertices[j], newIds[j], newIds[i]],
          ...(original.seams ? { seams: [original.seams[i], 0, 0, 0] } : {}),
          uvs: [
            ...original.uvs.slice(i * 2, i * 2 + 2),
            ...original.uvs.slice(j * 2, j * 2 + 2),
            ...newUVs.slice(j * 2, j * 2 + 2),
            ...newUVs.slice(i * 2, i * 2 + 2),
          ],
          normals: [
            ...original.normals.slice(i * 3, i * 3 + 3),
            ...original.normals.slice(j * 3, j * 3 + 3),
            ...newNormals.slice(j * 3, j * 3 + 3),
            ...newNormals.slice(i * 3, i * 3 + 3),
          ],
        });
      }
    }
  }
  if (operation.type === 'extrude') {
    const oldSelected = new Set(selectedVertices(t, 'face', operation.ids)),
      used = new Set(polygons.flatMap((f) => f.vertices)),
      remap = new Map<number, number>(),
      compact: number[] = [];
    for (let id = 0; id < positions.length / 3; id++)
      if (!oldSelected.has(id) || used.has(id)) {
        remap.set(id, compact.length / 3);
        compact.push(...positions.slice(id * 3, id * 3 + 3));
      }
    for (const f of polygons) f.vertices = f.vertices.map((id) => remap.get(id)!);
    return { topology: pack(compact, polygons), ids: caps };
  }
  return { topology: pack(positions, polygons), ids: caps };
}
