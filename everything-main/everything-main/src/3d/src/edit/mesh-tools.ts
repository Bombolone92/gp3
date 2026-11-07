import { seamEdges } from './seams';
import { add, sub, mul, dot, cross, normalize, type Vec3 } from '../core/math';
import {
  faces,
  edges,
  pack,
  position,
  faceNormal,
  triangulate,
  type Face,
  type Topology,
} from './topology';
export type ToolOperation =
  | {
      type: 'bevel';
      mode: 'edge';
      ids: number[];
      amount: number;
      segments: number;
    }
  | {
      type: 'loopcut';
      mode: 'edge';
      ids: number[];
      cuts: number;
      slide: number;
    }
  | { type: 'merge'; mode: 'vertex'; ids: number[] }
  | { type: 'dissolve'; mode: 'edge'; ids: number[] };
export const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
export const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v * (1 - t) + b[i] * t);
export function flatFace(vertices: number[], positions: ArrayLike<number>, uvs?: number[]): Face {
  const n = faceNormal(
    vertices.map((id) => [positions[id * 3], positions[id * 3 + 1], positions[id * 3 + 2]]),
  );
  return {
    vertices,
    uvs: uvs ?? vertices.flatMap(() => [0, 0]),
    normals: vertices.flatMap(() => n),
  };
}
export function compact(t: Topology) {
  const used = new Set(t.indices),
    remap = new Map<number, number>(),
    p: number[] = [];
  for (let i = 0; i < t.positions.length / 3; i++)
    if (used.has(i)) {
      remap.set(i, p.length / 3);
      p.push(...position(t, i));
    }
  return pack(
    p,
    faces(t).map((f) => ({
      ...f,
      vertices: f.vertices.map((v) => remap.get(v)!),
    })),
  );
}
function validSelection(t: Topology, op: ToolOperation) {
  const count = op.mode === 'vertex' ? t.positions.length / 3 : edges(t).length;
  if (
    !op.ids.length ||
    new Set(op.ids).size !== op.ids.length ||
    op.ids.some((i) => !Number.isInteger(i) || i < 0 || i >= count)
  )
    throw new Error('Select valid mesh components first.');
}
export function meshTool(
  t: Topology,
  op: ToolOperation,
): { topology: Topology; ids: number[]; mode: 'edge' | 'vertex' } {
  validSelection(t, op);
  if (op.type === 'bevel')
    return {
      topology: bevel(t, op.ids, op.amount, op.segments),
      ids: [],
      mode: 'edge',
    };
  if (op.type === 'loopcut') return loopCut(t, op.ids, op.cuts, op.slide);
  if (op.type === 'merge') return merge(t, op.ids);
  return { topology: dissolve(t, op.ids), ids: [], mode: 'edge' };
}
/** Convex solid bevel: successive arc chord planes create watertight edge strips and miters. */
function bevel(t: Topology, ids: number[], width: number, segments: number) {
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isInteger(segments) ||
    segments < 1 ||
    segments > 12
  )
    throw new Error('Bevel needs a positive width and 1 to 12 segments.');
  if (ids.length * segments > 256) throw new Error('Bevel up to 256 edge segments at a time.');
  const seamKeys = seamEdges(t);
  const original = faces(t),
    es = edges(t),
    points = Array.from({ length: t.positions.length / 3 }, (_, i) => position(t, i));
  if (es.some((e) => e.faces.length !== 2))
    throw new Error('Bevel currently requires a closed convex mesh.');
  const normals = original.map((f) => faceNormal(f.vertices.map((id) => points[id])));
  const extent = Math.max(
      ...[0, 1, 2].map(
        (a) => Math.max(...points.map((p) => p[a])) - Math.min(...points.map((p) => p[a])),
      ),
    ),
    eps = Math.max(1e-8, extent * 1e-6);
  for (let i = 0; i < original.length; i++) {
    const f = original[i],
      n = normals[i],
      d = dot(n, points[f.vertices[0]]);
    if (
      f.vertices.some((v) => Math.abs(dot(n, points[v]) - d) > eps) ||
      points.some((p) => dot(n, p) - d > eps)
    )
      throw new Error('Bevel currently supports convex meshes with planar faces.');
  }
  if (
    es.some((e) => {
      const f = original[e.faces[0]],
        g = original[e.faces[1]];
      return (
        (f.vertices[(f.vertices.indexOf(e.a) + 1) % f.vertices.length] === e.b &&
          g.vertices[(g.vertices.indexOf(e.a) + 1) % g.vertices.length] === e.b) ||
        (f.vertices[(f.vertices.indexOf(e.b) + 1) % f.vertices.length] === e.a &&
          g.vertices[(g.vertices.indexOf(e.b) + 1) % g.vertices.length] === e.a)
      );
    })
  )
    throw new Error('Bevel requires consistently oriented faces.');
  const planes: { n: Vec3; d: number }[] = [];
  for (const id of ids) {
    const e = es[id],
      n1 = normals[e.faces[0]],
      n2 = normals[e.faces[1]],
      cos = dot(n1, n2),
      angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (angle < 1e-4 || angle > Math.PI - 1e-4)
      throw new Error('Select edges between distinct, non-flat faces to bevel.');
    const adjacent = es.filter(
      (other) => other.a === e.a || other.b === e.a || other.a === e.b || other.b === e.b,
    );
    if (
      adjacent.some(
        (other) => Math.hypot(...sub(points[other.a], points[other.b])) <= 2 * width + eps,
      )
    )
      throw new Error('Bevel width is too large for these edges.');
    const center = sub(points[e.a], mul(add(n1, n2), width / Math.sin(angle))),
      radius = width / Math.tan(angle / 2);
    const arc = (x: number) =>
      add(
        center,
        mul(
          add(
            mul(n1, Math.sin((1 - x) * angle) / Math.sin(angle)),
            mul(n2, Math.sin(x * angle) / Math.sin(angle)),
          ),
          radius,
        ),
      );
    for (let s = 0; s < segments; s++) {
      const a = arc(s / segments),
        b = arc((s + 1) / segments),
        n = normalize(sub(add(a, b), mul(center, 2)));
      planes.push({ n, d: dot(n, a) });
    }
  }
  let p = Array.from(t.positions),
    polygons = original.map((f, i) => ({ ...f, source: i }));
  for (const plane of planes) {
    if (polygons.length * planes.length > 2_000_000)
      throw new Error('Bevel is too complex. Select fewer edges or segments.');
    const cache = new Map<string, number>(),
      cut = new Set<number>(),
      next: typeof polygons = [];
    const get = (id: number) => p.slice(id * 3, id * 3 + 3) as Vec3;
    for (const f of polygons) {
      const vertices: number[] = [],
        uvs: number[] = [],
        ns: number[] = [];
      const append = (id: number, uv: number[], n: number[]) => {
        if (vertices.at(-1) !== id) {
          vertices.push(id);
          uvs.push(...uv);
          ns.push(...n);
        }
      };
      for (let c = 0; c < f.vertices.length; c++) {
        const j = (c + 1) % f.vertices.length,
          a = f.vertices[c],
          b = f.vertices[j],
          da = dot(plane.n, get(a)) - plane.d,
          db = dot(plane.n, get(b)) - plane.d;
        if (da <= eps) append(a, f.uvs.slice(c * 2, c * 2 + 2), f.normals.slice(c * 3, c * 3 + 3));
        if ((da < -eps && db > eps) || (da > eps && db < -eps)) {
          const k = edgeKey(a, b),
            fraction = da / (da - db);
          let id = cache.get(k);
          if (id === undefined) {
            id = p.length / 3;
            p.push(...mix(get(a), get(b), fraction));
            cache.set(k, id);
          }
          if (seamKeys.has(k)) {
            seamKeys.add(edgeKey(a, id));
            seamKeys.add(edgeKey(id, b));
          }
          cut.add(id);
          append(
            id,
            mix(f.uvs.slice(c * 2, c * 2 + 2), f.uvs.slice(j * 2, j * 2 + 2), fraction),
            normalize(
              mix(
                f.normals.slice(c * 3, c * 3 + 3),
                f.normals.slice(j * 3, j * 3 + 3),
                fraction,
              ) as Vec3,
            ),
          );
        }
        if (Math.abs(da) <= eps) cut.add(a);
      }
      if (vertices.length >= 3) next.push({ vertices, uvs, normals: ns, source: f.source });
    }
    if (cut.size >= 3) {
      const ids = [...cut],
        center = mul(
          ids.reduce((s, id) => add(s, get(id)), [0, 0, 0] as Vec3),
          1 / ids.length,
        ),
        u = normalize(sub(get(ids[0]), center)),
        v = cross(plane.n, u);
      ids.sort(
        (a, b) =>
          Math.atan2(dot(sub(get(a), center), v), dot(sub(get(a), center), u)) -
          Math.atan2(dot(sub(get(b), center), v), dot(sub(get(b), center), u)),
      );
      next.push({
        ...flatFace(
          ids,
          p,
          ids.flatMap((id) => [dot(sub(get(id), center), u), dot(sub(get(id), center), v)]),
        ),
        source: -1,
      });
    }
    if (original.some((_, i) => !next.some((f) => f.source === i)))
      throw new Error('Bevel would remove an original face. Reduce the width.');
    polygons = next;
  }
  if (t.seams)
    for (const f of polygons)
      f.seams = f.vertices.map((a, c) =>
        Number(seamKeys.has(edgeKey(a, f.vertices[(c + 1) % f.vertices.length]))),
      );
  const result = compact(pack(p, polygons));
  if (edges(result).some((e) => e.faces.length !== 2))
    throw new Error('Bevel could not preserve this mesh. Reduce the width.');
  return result;
}
function loopCut(t: Topology, ids: number[], cuts: number, slide: number) {
  if (ids.length !== 1) throw new Error('Select one edge to start a loop cut.');
  if (
    !Number.isInteger(cuts) ||
    cuts < 1 ||
    cuts > 8 ||
    !Number.isFinite(slide) ||
    Math.abs(slide) > 0.9
  )
    throw new Error('Use 1 to 8 cuts and a slide between -0.9 and 0.9.');
  const fs = faces(t),
    es = edges(t),
    lookup = new Map(es.map((e, i) => [edgeKey(e.a, e.b), i])),
    orientation = new Map<number, boolean>([[ids[0], true]]),
    queue = [ids[0]],
    splitFaces = new Set<number>();
  while (queue.length) {
    const id = queue.shift()!,
      e = es[id];
    if (e.faces.length > 2) throw new Error('Loop cuts require manifold edges.');
    for (const f of e.faces) {
      const face = fs[f];
      if (face.vertices.length !== 4) continue;
      splitFaces.add(f);
      const c = face.vertices.findIndex(
          (a, i) => edgeKey(a, face.vertices[(i + 1) % 4]) === edgeKey(e.a, e.b),
        ),
        a = face.vertices[(c + 2) % 4],
        b = face.vertices[(c + 3) % 4],
        other = lookup.get(edgeKey(a, b))!,
        forward = (orientation.get(id) !== (face.vertices[c] !== e.a)) === (a !== es[other].a);
      if (orientation.has(other)) {
        if (orientation.get(other) !== forward)
          throw new Error('This loop twists into itself. Choose another edge.');
      } else {
        orientation.set(other, forward);
        queue.push(other);
      }
    }
  }
  if (!splitFaces.size) throw new Error('Loop cuts need a connected strip of quad faces.');
  const p = Array.from(t.positions),
    insertions = new Map<string, { ids: number[]; fractions: number[] }>();
  for (const [id, forward] of orientation) {
    const e = es[id],
      fractions = Array.from(
        { length: cuts },
        (_, i) => (i + 1 + (forward ? slide : -slide)) / (cuts + 1),
      ),
      added = fractions.map((x) => {
        const id = p.length / 3;
        p.push(...mix(position(t, e.a), position(t, e.b), x));
        return id;
      });
    insertions.set(edgeKey(e.a, e.b), { ids: added, fractions });
  }
  const result: Face[] = [],
    newEdges: string[] = [];
  type Corner = { id: number; uv: number[]; n: number[] };
  const corner = (f: Face, c: number): Corner => ({
    id: f.vertices[c],
    uv: f.uvs.slice(c * 2, c * 2 + 2),
    n: f.normals.slice(c * 3, c * 3 + 3),
  });
  const row = (f: Face, c: number): Corner[] => {
    const a = corner(f, c),
      b = corner(f, (c + 1) % f.vertices.length),
      insertion = insertions.get(edgeKey(a.id, b.id));
    if (!insertion) return [a, b];
    const e = es[lookup.get(edgeKey(a.id, b.id))!],
      indices = insertion.ids.map((_, i) => i);
    if (a.id !== e.a) indices.reverse();
    return [
      a,
      ...indices.map((i) => {
        const x = a.id === e.a ? insertion.fractions[i] : 1 - insertion.fractions[i];
        return {
          id: insertion.ids[i],
          uv: mix(a.uv, b.uv, x),
          n: normalize(mix(a.n, b.n, x) as Vec3),
        };
      }),
      b,
    ];
  };
  const seamKeys = seamEdges(t);
  for (const [key, insertion] of insertions)
    if (seamKeys.has(key)) {
      const [a, b] = key.split(':').map(Number),
        chain = [a, ...insertion.ids, b];
      for (let i = 0; i < chain.length - 1; i++) seamKeys.add(edgeKey(chain[i], chain[i + 1]));
    }
  const face = (cs: Corner[]): Face => ({
    vertices: cs.map((c) => c.id),
    ...(t.seams
      ? {
          seams: cs.map((c, i) => Number(seamKeys.has(edgeKey(c.id, cs[(i + 1) % cs.length].id)))),
        }
      : {}),
    uvs: cs.flatMap((c) => c.uv),
    normals: cs.flatMap((c) => c.n),
  });
  fs.forEach((f, i) => {
    if (splitFaces.has(i)) {
      const marked = f.vertices.map((a, c) => insertions.has(edgeKey(a, f.vertices[(c + 1) % 4])));
      if (marked.filter(Boolean).length !== 2)
        throw new Error('Intersecting loops cannot be cut together.');
      const c = marked.indexOf(true);
      if (!marked[(c + 2) % 4]) throw new Error('Loop must cross opposite quad edges.');
      const a = row(f, c),
        b = row(f, (c + 2) % 4).reverse();
      for (let j = 0; j < a.length - 1; j++) result.push(face([a[j], a[j + 1], b[j + 1], b[j]]));
      for (let j = 1; j < a.length - 1; j++) newEdges.push(edgeKey(a[j].id, b[j].id));
    } else result.push(face(f.vertices.flatMap((_, c) => row(f, c).slice(0, -1))));
  });
  const topology = pack(p, result),
    selected = new Set(newEdges);
  return {
    topology,
    ids: edges(topology).flatMap((e, i) => (selected.has(edgeKey(e.a, e.b)) ? [i] : [])),
    mode: 'edge' as const,
  };
}
function merge(t: Topology, ids: number[]) {
  if (ids.length < 2) throw new Error('Select at least two vertices to merge at their center.');
  const selected = new Set(ids),
    first = Math.min(...ids),
    center = mul(
      ids.reduce((s, id) => add(s, position(t, id)), [0, 0, 0] as Vec3),
      1 / ids.length,
    ),
    p: number[] = [],
    map = new Map<number, number>();
  for (let i = 0; i < t.positions.length / 3; i++)
    if (!selected.has(i) || i === first) {
      map.set(i, p.length / 3);
      p.push(...(i === first ? center : position(t, i)));
    }
  for (const id of ids) map.set(id, map.get(first)!);
  const result: Face[] = [];
  for (const f of faces(t)) {
    const vertices: number[] = [],
      uvs: number[] = [];
    f.vertices.forEach((v, c) => {
      const id = map.get(v)!;
      if (id !== vertices.at(-1)) {
        vertices.push(id);
        uvs.push(...f.uvs.slice(c * 2, c * 2 + 2));
      }
    });
    if (vertices.length > 1 && vertices[0] === vertices.at(-1)) {
      vertices.pop();
      uvs.splice(-2);
    }
    if (vertices.length < 3) continue;
    if (new Set(vertices).size !== vertices.length)
      throw new Error('Merge would pinch a face. Select neighboring vertices.');
    result.push(
      f.vertices.some((v) => selected.has(v))
        ? flatFace(vertices, p, uvs)
        : { vertices, uvs, normals: [...f.normals] },
    );
  }
  if (t.seams) {
    const seamKeys = new Set(
      [...seamEdges(t)].map((key) => {
        const [a, b] = key.split(':').map(Number);
        return edgeKey(map.get(a)!, map.get(b)!);
      }),
    );
    for (const f of result)
      f.seams = f.vertices.map((a, c) =>
        Number(seamKeys.has(edgeKey(a, f.vertices[(c + 1) % f.vertices.length]))),
      );
  }
  const topology = pack(p, result);
  for (const f of result) triangulate(f.vertices.map((v) => p.slice(v * 3, v * 3 + 3) as Vec3));
  if (edges(topology).some((e) => e.faces.length > 2))
    throw new Error('Merge would create a non-manifold edge.');
  return { topology, ids: [map.get(first)!], mode: 'vertex' as const };
}
function dissolve(t: Topology, ids: number[]) {
  let fs = faces(t);
  const seams = seamEdges(t);
  const selected = ids.map((id) => edges(t)[id]);
  for (const edge of selected) {
    if (seams.has(edgeKey(edge.a, edge.b)))
      throw new Error('Clear the marked UV seam before dissolving this edge.');
    const matches = fs
      .map((f, i) => ({
        f,
        i,
        c: f.vertices.findIndex(
          (a, c) => edgeKey(a, f.vertices[(c + 1) % f.vertices.length]) === edgeKey(edge.a, edge.b),
        ),
      }))
      .filter((x) => x.c >= 0);
    if (matches.length !== 2)
      throw new Error('Dissolve requires interior edges shared by two faces.');
    const [a, b] = matches,
      na = faceNormal(a.f.vertices.map((id) => position(t, id))),
      nb = faceNormal(b.f.vertices.map((id) => position(t, id)));
    if (dot(na, nb) < 0.99999) throw new Error('Dissolve supports coplanar faces.');
    const origin = position(t, a.f.vertices[0]);
    if (b.f.vertices.some((id) => Math.abs(dot(na, sub(position(t, id), origin))) > 1e-5))
      throw new Error('Dissolve supports coplanar faces.');
    for (const v of [edge.a, edge.b]) {
      const x = a.f.vertices.indexOf(v),
        y = b.f.vertices.indexOf(v);
      if (a.f.uvs.slice(x * 2, x * 2 + 2).some((uv, i) => Math.abs(uv - b.f.uvs[y * 2 + i]) > 1e-5))
        throw new Error('Dissolve would remove a UV seam.');
      if (
        a.f.normals
          .slice(x * 3, x * 3 + 3)
          .some((n, i) => Math.abs(n - b.f.normals[y * 3 + i]) > 1e-5)
      )
        throw new Error('Dissolve would remove a normal seam.');
    }
    const boundary = [a.f, b.f]
      .flatMap((f) =>
        f.vertices.map((v, c) => ({
          a: v,
          b: f.vertices[(c + 1) % f.vertices.length],
          uv: f.uvs.slice(c * 2, c * 2 + 2),
          normal: f.normals.slice(c * 3, c * 3 + 3),
        })),
      )
      .filter((e) => edgeKey(e.a, e.b) !== edgeKey(edge.a, edge.b));
    const loop = [boundary[0]];
    while (loop.length < boundary.length) {
      const next = boundary.find((e) => e.a === loop.at(-1)!.b && !loop.includes(e));
      if (!next) throw new Error('Dissolve would create a hole or inconsistent winding.');
      loop.push(next);
    }
    if (loop.at(-1)!.b !== loop[0].a) throw new Error('Dissolve boundary is not closed.');
    const f = flatFace(
      loop.map((e) => e.a),
      t.positions,
      loop.flatMap((e) => e.uv),
    );
    f.normals = loop.flatMap((e) => e.normal);
    if (t.seams) f.seams = loop.map((e) => Number(seams.has(edgeKey(e.a, e.b))));
    triangulate(f.vertices.map((id) => position(t, id)));
    fs = fs.filter((_, i) => i !== a.i && i !== b.i);
    fs.push(f);
  }
  return pack(t.positions, fs);
}
