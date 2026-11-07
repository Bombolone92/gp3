import { seamEdges } from '../edit/seams';
import { add, sub, mul, cross, normalize, type Vec3 } from '../core/math';
import {
  edges,
  faces,
  pack,
  position,
  MAX_EDIT_FACES,
  MAX_EDIT_VERTICES,
  type Topology,
  type Face,
} from '../edit/topology';
import { edgeKey, mix, compact } from '../edit/mesh-tools';
export type Modifier =
  | {
      id: string;
      type: 'mirror';
      enabled: boolean;
      axis: 0 | 1 | 2;
      offset: number;
      merge: boolean;
      bisect: boolean;
      tolerance: number;
    }
  | { id: string; type: 'subdivision'; enabled: boolean; levels: number };
export function validateModifiers(value: unknown): Modifier[] {
  if (!Array.isArray(value) || value.length > 8)
    throw new Error('A mesh can have up to eight modifiers.');
  const ids = new Set<string>();
  return value.map((m) => {
    if (
      !m ||
      typeof m !== 'object' ||
      typeof m.id !== 'string' ||
      !m.id ||
      m.id.length > 100 ||
      ids.has(m.id) ||
      typeof m.enabled !== 'boolean'
    )
      throw new Error('Invalid modifier.');
    ids.add(m.id);
    if (
      m.type === 'mirror' &&
      [0, 1, 2].includes(m.axis) &&
      Number.isFinite(m.offset) &&
      Math.abs(m.offset) <= 10000 &&
      typeof m.merge === 'boolean' &&
      typeof m.bisect === 'boolean' &&
      Number.isFinite(m.tolerance) &&
      m.tolerance >= 0.000001 &&
      m.tolerance <= 0.1
    )
      return {
        id: m.id,
        type: m.type,
        enabled: m.enabled,
        axis: m.axis,
        offset: m.offset,
        merge: m.merge,
        bisect: m.bisect,
        tolerance: m.tolerance,
      };
    if (m.type === 'subdivision' && Number.isInteger(m.levels) && m.levels >= 1 && m.levels <= 3)
      return { id: m.id, type: m.type, enabled: m.enabled, levels: m.levels };
    throw new Error('Invalid modifier settings.');
  });
}
export function evaluateModifiers(t: Topology, modifiers: Modifier[]): Topology {
  for (const m of validateModifiers(modifiers))
    if (m.enabled) {
      if (m.type === 'mirror') t = mirror(t, m);
      else for (let i = 0; i < m.levels; i++) t = subdivide(t);
    }
  return t;
}
function mirror(t: Topology, m: Extract<Modifier, { type: 'mirror' }>) {
  let p = Array.from(t.positions),
    fs = faces(t);
  const { axis, offset, tolerance } = m;
  if (m.bisect) {
    const seamKeys = seamEdges(t);
    const cache = new Map<string, number>(),
      out: Face[] = [];
    for (const f of fs) {
      const vertices: number[] = [],
        uvs: number[] = [],
        normals: number[] = [];
      const append = (v: number, uv: number[], n: number[]) => {
        if (vertices.at(-1) !== v) {
          vertices.push(v);
          uvs.push(...uv);
          normals.push(...n);
        }
      };
      for (let i = 0; i < f.vertices.length; i++) {
        const j = (i + 1) % f.vertices.length,
          a = f.vertices[i],
          b = f.vertices[j],
          da = p[a * 3 + axis] - offset,
          db = p[b * 3 + axis] - offset;
        if (da >= -tolerance) {
          if (Math.abs(da) <= tolerance) p[a * 3 + axis] = offset;
          append(a, f.uvs.slice(i * 2, i * 2 + 2), f.normals.slice(i * 3, i * 3 + 3));
        }
        if ((da > tolerance && db < -tolerance) || (da < -tolerance && db > tolerance)) {
          const k = edgeKey(a, b),
            fraction = da / (da - db);
          let id = cache.get(k);
          if (id === undefined) {
            id = p.length / 3;
            const point = mix(p.slice(a * 3, a * 3 + 3), p.slice(b * 3, b * 3 + 3), fraction);
            point[axis] = offset;
            p.push(...point);
            cache.set(k, id);
          }
          if (seamKeys.has(k)) {
            seamKeys.add(edgeKey(a, id));
            seamKeys.add(edgeKey(id, b));
          }
          append(
            id,
            mix(f.uvs.slice(i * 2, i * 2 + 2), f.uvs.slice(j * 2, j * 2 + 2), fraction),
            normalize(
              mix(
                f.normals.slice(i * 3, i * 3 + 3),
                f.normals.slice(j * 3, j * 3 + 3),
                fraction,
              ) as Vec3,
            ),
          );
        }
      }
      if (
        vertices.length >= 3 &&
        !vertices.every((v) => Math.abs(p[v * 3 + axis] - offset) <= tolerance)
      )
        out.push({ vertices, uvs, normals });
    }
    if (t.seams)
      for (const f of out)
        f.seams = f.vertices.map((a, c) =>
          Number(seamKeys.has(edgeKey(a, f.vertices[(c + 1) % f.vertices.length]))),
        );
    const clipped = compact(pack(p, out));
    p = Array.from(clipped.positions);
    fs = faces(clipped);
    if (!fs.length)
      throw new Error(
        'The mirror plane removes the entire mesh. Move the plane or turn off bisect.',
      );
  }
  const remap = new Map<number, number>(),
    count = p.length / 3;
  for (let id = 0; id < count; id++) {
    if (m.merge && Math.abs(p[id * 3 + axis] - offset) <= tolerance) {
      p[id * 3 + axis] = offset;
      remap.set(id, id);
    } else {
      const reflected = p.slice(id * 3, id * 3 + 3);
      reflected[axis] = 2 * offset - reflected[axis];
      remap.set(id, p.length / 3);
      p.push(...reflected);
    }
  }
  const mirrored = fs
    .filter((f) => !m.merge || !f.vertices.every((v) => remap.get(v) === v))
    .map((f) => {
      const cs = f.vertices.map((_, i) => i).reverse();
      return {
        vertices: cs.map((c) => remap.get(f.vertices[c])!),
        ...(f.seams
          ? {
              seams: cs.map((c) => f.seams![(c + f.vertices.length - 1) % f.vertices.length]),
            }
          : {}),
        uvs: cs.flatMap((c) => f.uvs.slice(c * 2, c * 2 + 2)),
        normals: cs.flatMap((c) =>
          f.normals.slice(c * 3, c * 3 + 3).map((n, a) => (a === axis ? -n : n)),
        ),
      };
    });
  return pack(p, [...fs, ...mirrored]);
}
/** Catmull-Clark, with cubic boundary rules and face-varying UVs. */
function subdivide(t: Topology) {
  const fs = faces(t),
    es = edges(t),
    vc = t.positions.length / 3;
  if (vc + es.length + fs.length > MAX_EDIT_VERTICES || t.indices.length > MAX_EDIT_FACES)
    throw new Error(
      'Subdivision exceeds the mesh budget. Reduce levels or simplify the source mesh.',
    );
  if (es.some((e) => e.faces.length > 2)) throw new Error('Subdivision requires manifold edges.');
  for (const e of es)
    if (e.faces.length === 2) {
      const a = fs[e.faces[0]],
        b = fs[e.faces[1]],
        direction = (f: Face) =>
          f.vertices[(f.vertices.indexOf(e.a) + 1) % f.vertices.length] === e.b;
      if (direction(a) === direction(b))
        throw new Error('Subdivision requires consistently oriented faces.');
    }
  const facePoints = fs.map((f) =>
      mul(
        f.vertices.reduce((s, id) => add(s, position(t, id)), [0, 0, 0] as Vec3),
        1 / f.vertices.length,
      ),
    ),
    incidentEdges = Array.from({ length: vc }, () => [] as number[]),
    incidentFaces = Array.from({ length: vc }, () => [] as number[]);
  es.forEach((e, i) => {
    incidentEdges[e.a].push(i);
    incidentEdges[e.b].push(i);
  });
  fs.forEach((f, i) => f.vertices.forEach((v) => incidentFaces[v].push(i)));
  const p: number[] = [];
  for (let v = 0; v < vc; v++) {
    const point = position(t, v),
      edgeIds = incidentEdges[v],
      faceIds = incidentFaces[v],
      boundary = edgeIds.filter((i) => es[i].faces.length === 1);
    if (!edgeIds.length) {
      p.push(...point);
      continue;
    }
    if (
      (boundary.length && boundary.length !== 2) ||
      (!boundary.length && edgeIds.length !== faceIds.length)
    )
      throw new Error('Subdivision requires manifold vertex neighborhoods.');
    const visited = new Set<number>(),
      queue = faceIds.slice(0, 1);
    while (queue.length) {
      const f = queue.pop()!;
      if (visited.has(f)) continue;
      visited.add(f);
      for (const e of edgeIds)
        if (es[e].faces.includes(f)) queue.push(...es[e].faces.filter((g) => !visited.has(g)));
    }
    if (visited.size !== faceIds.length)
      throw new Error('Subdivision cannot smooth disconnected face fans.');
    if (boundary.length) {
      const neighbors = boundary.map((i) => (es[i].a === v ? es[i].b : es[i].a));
      p.push(
        ...add(
          mul(point, 0.75),
          mul(add(position(t, neighbors[0]), position(t, neighbors[1])), 0.125),
        ),
      );
    } else {
      const n = faceIds.length,
        F = mul(
          faceIds.reduce((s, f) => add(s, facePoints[f]), [0, 0, 0] as Vec3),
          1 / n,
        ),
        R = mul(
          edgeIds.reduce(
            (s, i) => add(s, mul(add(position(t, es[i].a), position(t, es[i].b)), 0.5)),
            [0, 0, 0] as Vec3,
          ),
          1 / n,
        );
      p.push(...mul(add(add(F, mul(R, 2)), mul(point, n - 3)), 1 / n));
    }
  }
  const edgeIds = new Map<string, number>();
  for (const e of es) {
    edgeIds.set(edgeKey(e.a, e.b), p.length / 3);
    const endpoints = add(position(t, e.a), position(t, e.b));
    p.push(
      ...(e.faces.length === 2
        ? mul(add(endpoints, add(facePoints[e.faces[0]], facePoints[e.faces[1]])), 0.25)
        : mul(endpoints, 0.5)),
    );
  }
  const faceIds = facePoints.map((point) => {
      const id = p.length / 3;
      p.push(...point);
      return id;
    }),
    result: Face[] = [];
  fs.forEach((f, fi) => {
    const n = f.vertices.length,
      center = [0, 1].map((a) => f.vertices.reduce((s, _, i) => s + f.uvs[i * 2 + a], 0) / n);
    for (let c = 0; c < n; c++) {
      const next = (c + 1) % n,
        prev = (c + n - 1) % n,
        uv = f.uvs.slice(c * 2, c * 2 + 2);
      result.push({
        ...(f.seams ? { seams: [f.seams[c], 0, 0, f.seams[prev]] } : {}),
        vertices: [
          f.vertices[c],
          edgeIds.get(edgeKey(f.vertices[c], f.vertices[next]))!,
          faceIds[fi],
          edgeIds.get(edgeKey(f.vertices[prev], f.vertices[c]))!,
        ],
        uvs: [
          ...uv,
          ...mix(uv, f.uvs.slice(next * 2, next * 2 + 2), 0.5),
          ...center,
          ...mix(f.uvs.slice(prev * 2, prev * 2 + 2), uv, 0.5),
        ],
        normals: [],
      });
    }
  });
  const sums = Array.from({ length: p.length / 3 }, () => [0, 0, 0] as Vec3),
    point = (v: number) => p.slice(v * 3, v * 3 + 3) as Vec3;
  for (const f of result) {
    let n: Vec3 = [0, 0, 0];
    for (let i = 1; i < f.vertices.length - 1; i++)
      n = add(
        n,
        cross(
          sub(point(f.vertices[i]), point(f.vertices[0])),
          sub(point(f.vertices[i + 1]), point(f.vertices[0])),
        ),
      );
    for (const v of f.vertices) sums[v] = add(sums[v], n);
  }
  for (const f of result) f.normals = f.vertices.flatMap((v) => normalize(sums[v]));
  return pack(p, result);
}
