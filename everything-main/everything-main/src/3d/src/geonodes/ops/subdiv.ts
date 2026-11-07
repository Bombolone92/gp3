// Subdivision: simple (Subdivide Mesh) and Catmull–Clark (Subdivision Surface) with semi-sharp
// creases, boundary handling and optional projection to the limit surface. Attributes are
// interpolated linearly (vertex/corner averages) on every level.
import { MeshComponent } from '../geometry';
import { Rebuild, edgeKey, type Src } from './rebuild';

export interface SubdivOptions {
  smooth: boolean;
  /** per edge crease 0..1 (EDGE domain of the input) */
  edgeCrease?: Float32Array | null;
  /** per vertex crease 0..1 */
  vertexCrease?: Float32Array | null;
  boundary: 'ALL' | 'KEEP_CORNERS';
  limit: boolean;
}

/** OpenSubdiv-style sharpness from a crease weight. */
const sharpness = (c: number) => c * c * 10;

function level(
  m: MeshComponent,
  opt: SubdivOptions,
  edgeSharp: Float32Array | null,
  vertSharp: Float32Array | null,
): {
  mesh: MeshComponent;
  edgeSharp: Float32Array | null;
  vertSharp: Float32Array | null;
} {
  const topo = m.topology();
  const P = m.positions,
    nv = m.vertCount,
    nf = m.faceCount,
    ne = topo.edgeCount;
  const r = new Rebuild(m);
  // face points
  const fp = new Float64Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const s = m.faceOffsets[f],
      e = m.faceOffsets[f + 1],
      n = e - s;
    for (let c = s; c < e; c++) for (let k = 0; k < 3; k++) fp[f * 3 + k] += P[m.corners[c] * 3 + k] / n;
  }
  const edgeFaces = (e: number) => topo.edgeFaceOffsets[e + 1] - topo.edgeFaceOffsets[e];
  // edge points
  const ep = new Float64Array(ne * 3);
  for (let e = 0; e < ne; e++) {
    const a = topo.edges[e * 2],
      b = topo.edges[e * 2 + 1];
    const s = edgeSharp ? edgeSharp[e] : 0;
    for (let k = 0; k < 3; k++) {
      const mid = (P[a * 3 + k] + P[b * 3 + k]) / 2;
      if (!opt.smooth || edgeFaces(e) !== 2) ep[e * 3 + k] = mid;
      else {
        const f0 = topo.edgeFaces[topo.edgeFaceOffsets[e]],
          f1 = topo.edgeFaces[topo.edgeFaceOffsets[e] + 1];
        const smooth = (P[a * 3 + k] + P[b * 3 + k] + fp[f0 * 3 + k] + fp[f1 * 3 + k]) / 4;
        ep[e * 3 + k] = smooth + (mid - smooth) * Math.min(1, s);
      }
    }
  }
  // vertex points
  const vp = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    const e0 = topo.vertEdgeOffsets[v],
      e1 = topo.vertEdgeOffsets[v + 1];
    const valence = e1 - e0;
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    if (!opt.smooth || valence === 0 || topo.vertFaceOffsets[v + 1] === topo.vertFaceOffsets[v]) {
      vp.set(p, v * 3);
      continue;
    }
    const boundary: number[] = [],
      creased: number[] = [];
    let creaseSum = 0;
    for (let j = e0; j < e1; j++) {
      const e = topo.vertEdges[j];
      const o = topo.edges[e * 2] === v ? topo.edges[e * 2 + 1] : topo.edges[e * 2];
      if (edgeFaces(e) < 2) boundary.push(o);
      else if (edgeSharp && edgeSharp[e] > 0) {
        creased.push(o);
        creaseSum += edgeSharp[e];
      }
    }
    const vs = vertSharp ? vertSharp[v] : 0;
    if (boundary.length >= 2) {
      const nfv = topo.vertFaceOffsets[v + 1] - topo.vertFaceOffsets[v];
      const corner = opt.boundary === 'KEEP_CORNERS' && nfv === 1 && boundary.length === 2;
      if (boundary.length > 2 || corner || vs >= 1) vp.set(p, v * 3);
      else for (let k = 0; k < 3; k++) vp[v * 3 + k] = (P[boundary[0] * 3 + k] + P[boundary[1] * 3 + k] + 6 * p[k]) / 8;
      continue;
    }
    // smooth rule
    const nfv = topo.vertFaceOffsets[v + 1] - topo.vertFaceOffsets[v];
    const Q = [0, 0, 0],
      R = [0, 0, 0];
    for (let j = topo.vertFaceOffsets[v]; j < topo.vertFaceOffsets[v + 1]; j++) {
      const f = topo.vertFaces[j];
      for (let k = 0; k < 3; k++) Q[k] += fp[f * 3 + k] / nfv;
    }
    for (let j = e0; j < e1; j++) {
      const e = topo.vertEdges[j];
      for (let k = 0; k < 3; k++) R[k] += (P[topo.edges[e * 2] * 3 + k] + P[topo.edges[e * 2 + 1] * 3 + k]) / 2 / valence;
    }
    const n = valence;
    let out = [0, 1, 2].map((k) => (Q[k] + 2 * R[k] + (n - 3) * p[k]) / n);
    if (creased.length === 2) {
      const sharp = [0, 1, 2].map((k) => (P[creased[0] * 3 + k] + P[creased[1] * 3 + k] + 6 * p[k]) / 8);
      const w = Math.min(1, creaseSum / 2);
      out = out.map((x, k) => x + (sharp[k] - x) * w);
    } else if (creased.length > 2) {
      const w = Math.min(1, creaseSum / creased.length);
      out = out.map((x, k) => x + (p[k] - x) * w);
    }
    if (vs > 0) out = out.map((x, k) => x + (p[k] - x) * Math.min(1, vs));
    vp.set(out, v * 3);
  }
  // emit vertices
  for (let v = 0; v < nv; v++) r.vert(vp[v * 3], vp[v * 3 + 1], vp[v * 3 + 2], v);
  const eBase = nv;
  for (let e = 0; e < ne; e++) r.vert(ep[e * 3], ep[e * 3 + 1], ep[e * 3 + 2], [topo.edges[e * 2], 0.5, topo.edges[e * 2 + 1], 0.5]);
  const fBase = nv + ne;
  for (let f = 0; f < nf; f++) {
    const s = m.faceOffsets[f],
      e = m.faceOffsets[f + 1],
      n = e - s;
    const src: number[] = [];
    for (let c = s; c < e; c++) src.push(m.corners[c], 1 / n);
    r.vert(fp[f * 3], fp[f * 3 + 1], fp[f * 3 + 2], src);
  }
  // child edges inherit from their parent edge (halves); creases decay by one level
  for (let e = 0; e < ne; e++) {
    r.edgeSrc.set(edgeKey(topo.edges[e * 2], eBase + e), e);
    r.edgeSrc.set(edgeKey(topo.edges[e * 2 + 1], eBase + e), e);
  }
  for (let f = 0; f < nf; f++) {
    const s = m.faceOffsets[f],
      e = m.faceOffsets[f + 1],
      n = e - s;
    const center: number[] = [];
    for (let c = s; c < e; c++) center.push(c, 1 / n);
    for (let k = 0; k < n; k++) {
      const c = s + k,
        cn = s + ((k + 1) % n),
        cp = s + ((k + n - 1) % n);
      const cs: Src[] = [c, [c, 0.5, cn, 0.5], center, [c, 0.5, cp, 0.5]];
      r.face([m.corners[c], eBase + topo.cornerEdge[c], fBase + f, eBase + topo.cornerEdge[cp]], cs, f);
    }
  }
  // loose edges are split as well
  for (let i = 0; i < m.looseEdges.length; i += 2) {
    const a = m.looseEdges[i],
      b = m.looseEdges[i + 1];
    void a;
    void b;
  }
  for (let e = 0; e < ne; e++) {
    if (edgeFaces(e) !== 0) continue;
    r.edge(topo.edges[e * 2], eBase + e);
    r.edge(eBase + e, topo.edges[e * 2 + 1]);
  }
  const mesh = r.build();
  // child sharpness
  let childEdge: Float32Array | null = null;
  if (edgeSharp) {
    const nt = mesh.topology();
    childEdge = new Float32Array(nt.edgeCount);
    const parentOf = new Map<number, number>();
    for (let e = 0; e < ne; e++) {
      parentOf.set(edgeKey(topo.edges[e * 2], eBase + e), e);
      parentOf.set(edgeKey(topo.edges[e * 2 + 1], eBase + e), e);
    }
    for (let e = 0; e < nt.edgeCount; e++) {
      const p = parentOf.get(edgeKey(nt.edges[e * 2], nt.edges[e * 2 + 1]));
      if (p !== undefined) childEdge[e] = Math.max(0, edgeSharp[p] - 1);
    }
  }
  let childVert: Float32Array | null = null;
  if (vertSharp) {
    childVert = new Float32Array(mesh.vertCount);
    for (let v = 0; v < nv; v++) childVert[v] = Math.max(0, vertSharp[v] - 1);
  }
  return { mesh, edgeSharp: childEdge, vertSharp: childVert };
}

/** Move vertices of a (quad) subdivided mesh to their limit positions. */
function projectToLimit(m: MeshComponent, opt: SubdivOptions, edgeSharp: Float32Array | null, vertSharp: Float32Array | null): Float32Array {
  const topo = m.topology();
  const P = m.positions,
    nv = m.vertCount;
  const out = new Float32Array(P);
  for (let v = 0; v < nv; v++) {
    const e0 = topo.vertEdgeOffsets[v],
      e1 = topo.vertEdgeOffsets[v + 1];
    const n = e1 - e0;
    if (!n || topo.vertFaceOffsets[v + 1] === topo.vertFaceOffsets[v]) continue;
    if (vertSharp && vertSharp[v] >= 1) continue;
    const boundary: number[] = [],
      sharpN: number[] = [];
    for (let j = e0; j < e1; j++) {
      const e = topo.vertEdges[j];
      const o = topo.edges[e * 2] === v ? topo.edges[e * 2 + 1] : topo.edges[e * 2];
      const nfe = topo.edgeFaceOffsets[e + 1] - topo.edgeFaceOffsets[e];
      if (nfe < 2) boundary.push(o);
      else if (edgeSharp && edgeSharp[e] >= 1) sharpN.push(o);
    }
    const line = boundary.length ? boundary : sharpN;
    if (line.length > 2) continue;
    if (boundary.length === 2 && opt.boundary === 'KEEP_CORNERS' && topo.vertFaceOffsets[v + 1] - topo.vertFaceOffsets[v] === 1) continue;
    if (line.length === 2) {
      for (let k = 0; k < 3; k++) out[v * 3 + k] = (P[line[0] * 3 + k] + 4 * P[v * 3 + k] + P[line[1] * 3 + k]) / 6;
      continue;
    }
    if (line.length) continue;
    // interior: neighbours along edges and diagonals of the surrounding quads
    const acc = [0, 0, 0],
      diag = [0, 0, 0];
    for (let j = e0; j < e1; j++) {
      const e = topo.vertEdges[j];
      const o = topo.edges[e * 2] === v ? topo.edges[e * 2 + 1] : topo.edges[e * 2];
      for (let k = 0; k < 3; k++) acc[k] += P[o * 3 + k];
    }
    let quads = true;
    for (let j = topo.vertFaceOffsets[v]; j < topo.vertFaceOffsets[v + 1]; j++) {
      const f = topo.vertFaces[j],
        c = topo.vertCorners[j];
      const s = m.faceOffsets[f],
        e = m.faceOffsets[f + 1];
      if (e - s !== 4) {
        quads = false;
        break;
      }
      const opp = m.corners[s + ((c - s + 2) % 4)];
      for (let k = 0; k < 3; k++) diag[k] += P[opp * 3 + k];
    }
    if (!quads) continue;
    for (let k = 0; k < 3; k++) out[v * 3 + k] = (n * n * P[v * 3 + k] + 4 * acc[k] + diag[k]) / (n * (n + 5));
  }
  return out;
}

export function subdivide(m: MeshComponent, levels: number, opt: SubdivOptions): MeshComponent {
  levels = Math.max(0, Math.min(6, Math.round(levels)));
  if (!levels || !m.faceCount) return m;
  let mesh = m;
  let es: Float32Array<ArrayBufferLike> | null = opt.edgeCrease ? Float32Array.from(opt.edgeCrease, sharpness) : null;
  let vs: Float32Array<ArrayBufferLike> | null = opt.vertexCrease ? Float32Array.from(opt.vertexCrease, sharpness) : null;
  if (es && !es.some((x) => x > 0)) es = null;
  if (vs && !vs.some((x) => x > 0)) vs = null;
  for (let l = 0; l < levels; l++) {
    const r = level(mesh, opt, es, vs);
    mesh = r.mesh;
    es = r.edgeSharp;
    vs = r.vertSharp;
  }
  if (opt.smooth && opt.limit) mesh = mesh.withPositions(projectToLimit(mesh, opt, es, vs));
  return mesh;
}
