import { seamEdges, edgeKey } from './seams';
import { faceNormal, position, type Topology, type ComponentMode } from './topology';

export interface UVOperation {
  type: 'uv';
  mode: ComponentMode;
  ids: number[];
  projection: 'planar' | 'box';
  axis: 0 | 1 | 2;
}

// Normalize against the selected bounds, using one scale to preserve aspect ratio.
export function projectUV(t: Topology, operation: UVOperation) {
  if (operation.mode !== 'face' || !operation.ids.length)
    throw new Error('Select faces to project UVs.');
  if (!['planar', 'box'].includes(operation.projection) || ![0, 1, 2].includes(operation.axis))
    throw new Error('Invalid UV projection.');
  const ids = [...new Set(operation.ids)];
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const f of ids) {
    if (!Number.isInteger(f) || f < 0 || f >= t.offsets.length - 1)
      throw new Error('Invalid face selection.');
    for (let c = t.offsets[f]; c < t.offsets[f + 1]; c++) {
      const p = position(t, t.indices[c]);
      p.forEach((v, a) => {
        min[a] = Math.min(min[a], v);
        max[a] = Math.max(max[a], v);
      });
    }
  }
  const axes = [
    [2, 1],
    [0, 2],
    [0, 1],
  ];
  const uvs = t.uvs.slice();
  for (const f of ids) {
    const start = t.offsets[f],
      end = t.offsets[f + 1];
    const normal = faceNormal(Array.from(t.indices.subarray(start, end), (id) => position(t, id)));
    const axis =
      operation.projection === 'box'
        ? normal.reduce((best, n, a) => (Math.abs(n) > Math.abs(normal[best]) ? a : best), 0)
        : operation.axis;
    const [u, v] = axes[axis];
    const scale = Math.max(max[u] - min[u], max[v] - min[v]);
    if (scale < 1e-12) throw new Error('Projection has zero extent. Choose another axis.');
    for (let c = start; c < end; c++) {
      const p = position(t, t.indices[c]);
      const x = (p[u] - (min[u] + max[u]) / 2) / scale;
      uvs[c * 2] = 0.5 + (operation.projection === 'box' && normal[axis] < 0 ? -x : x);
      uvs[c * 2 + 1] = 0.5 - (p[v] - (min[v] + max[v]) / 2) / scale;
    }
  }
  return { topology: { ...t, uvs }, ids, mode: 'face' as const };
}

export interface UVTransform {
  corners: number[];
  move: [number, number];
  angle: number;
  scale: [number, number];
}
export interface UVTransformOperation extends UVTransform {
  type: 'uv-transform';
  mode: ComponentMode;
  ids: number[];
}
export function transformUV(t: Topology, change: UVTransform) {
  const corners = [...new Set(change.corners)];
  if (
    !corners.length ||
    corners.some((c) => !Number.isInteger(c) || c < 0 || c >= t.indices.length)
  )
    throw new Error('Select valid UV components first.');
  if (
    [...change.move, change.angle, ...change.scale].some((v) => !Number.isFinite(v)) ||
    change.scale.some((v) => v === 0 || Math.abs(v) > 1000)
  )
    throw new Error('Use finite UV values and nonzero scales up to 1000.');
  // Average unique UV positions so shared corners do not bias the pivot.
  const points = new Map<string, [number, number]>();
  for (const c of corners)
    points.set(`${t.uvs[c * 2]}:${t.uvs[c * 2 + 1]}`, [t.uvs[c * 2], t.uvs[c * 2 + 1]]);
  let u = 0,
    v = 0;
  for (const p of points.values()) {
    u += p[0] / points.size;
    v += p[1] / points.size;
  }
  const cos = Math.cos((change.angle * Math.PI) / 180),
    sin = Math.sin((change.angle * Math.PI) / 180);
  const uvs = t.uvs.slice();
  for (const c of corners) {
    const x = (t.uvs[c * 2] - u) * change.scale[0],
      y = (t.uvs[c * 2 + 1] - v) * change.scale[1];
    uvs[c * 2] = u + x * cos - y * sin + change.move[0];
    uvs[c * 2 + 1] = v + x * sin + y * cos + change.move[1];
    if (
      !Number.isFinite(uvs[c * 2]) ||
      !Number.isFinite(uvs[c * 2 + 1]) ||
      Math.abs(uvs[c * 2]) > 1e6 ||
      Math.abs(uvs[c * 2 + 1]) > 1e6
    )
      throw new Error('UV coordinates must stay within ±1,000,000.');
  }
  return { ...t, uvs };
}

export type UVMode = 'vertex' | 'edge' | 'island';
export interface UVElement {
  corners: number[];
  segments: [number, number][];
  faces: number[];
}
export function uvElements(t: Topology, mode: UVMode): UVElement[] {
  const key = (c: number) =>
    `${t.indices[c]}:${Math.round(t.uvs[c * 2] * 1e6)}:${Math.round(t.uvs[c * 2 + 1] * 1e6)}`;
  const seams = seamEdges(t);
  const vertices = new Map<string, UVElement>(),
    edgeMap = new Map<string, UVElement>();
  const parent = Array.from(t.offsets.slice(0, -1), (_, i) => i);
  const root = (f: number): number => {
    while (parent[f] !== f) {
      parent[f] = parent[parent[f]];
      f = parent[f];
    }
    return f;
  };
  for (let f = 0; f < parent.length; f++)
    for (let c = t.offsets[f]; c < t.offsets[f + 1]; c++) {
      const next = c + 1 === t.offsets[f + 1] ? t.offsets[f] : c + 1;
      const a = key(c),
        b = key(next);
      const vertex = vertices.get(a) ?? {
        corners: [],
        segments: [],
        faces: [],
      };
      vertex.corners.push(c);
      vertices.set(a, vertex);
      const uvEdgeKey = a < b ? `${a}/${b}` : `${b}/${a}`;
      const edge = edgeMap.get(uvEdgeKey) ?? {
        corners: [],
        segments: [],
        faces: [],
      };
      if (edge.faces.length && !seams.has(edgeKey(t.indices[c], t.indices[next])))
        parent[root(f)] = root(edge.faces[0]);
      edge.corners.push(c, next);
      edge.segments.push([c, next]);
      edge.faces.push(f);
      edgeMap.set(uvEdgeKey, edge);
    }
  if (mode === 'vertex') return [...vertices.values()];
  if (mode === 'edge')
    return [...edgeMap.values()].map((edge) => ({
      ...edge,
      corners: [...new Set(edge.segments[0].flatMap((c) => vertices.get(key(c))!.corners))],
    }));
  const islands = new Map<number, UVElement>();
  for (let f = 0; f < parent.length; f++) {
    const r = root(f),
      island = islands.get(r) ?? { corners: [], segments: [], faces: [] };
    island.faces.push(f);
    for (let c = t.offsets[f]; c < t.offsets[f + 1]; c++) {
      island.corners.push(c);
      island.segments.push([c, c + 1 === t.offsets[f + 1] ? t.offsets[f] : c + 1]);
    }
    islands.set(r, island);
  }
  return [...islands.values()];
}
