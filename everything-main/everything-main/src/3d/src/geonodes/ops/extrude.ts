// Extrude Mesh (vertices, edges, faces; individual or connected regions).
import { MeshComponent, adaptDomain, EdgeHash } from '../geometry';
import { Rebuild, edgeKey, type Src } from './rebuild';

export interface ExtrudeResult {
  mesh: MeshComponent;
  /** Top / Side flags on their domains */
  top: { domain: 'POINT' | 'EDGE' | 'FACE'; data: Uint8Array };
  side: { domain: 'EDGE' | 'FACE'; data: Uint8Array };
}

/** Mark new edges (vertex pairs) in a boolean array over the result's edge domain. */
function edgeFlags(m: MeshComponent, pairs: number[]): Uint8Array {
  const topo = m.topology();
  const h = new EdgeHash(topo.edgeCount);
  for (let e = 0; e < topo.edgeCount; e++) h.getOrAdd(topo.edges[e * 2], topo.edges[e * 2 + 1], e);
  const out = new Uint8Array(topo.edgeCount);
  for (let i = 0; i < pairs.length; i += 2) {
    const e = h.get(pairs[i], pairs[i + 1]);
    if (e >= 0) out[e] = 1;
  }
  return out;
}

/** Copy the whole mesh into a rebuild (vertices and faces unchanged). */
function copyAll(r: Rebuild, m: MeshComponent, faceVerts?: (f: number, k: number, v: number) => number, skipFace?: (f: number) => boolean) {
  for (let v = 0; v < m.vertCount; v++) r.copyVert(v);
  for (let f = 0; f < m.faceCount; f++) {
    if (skipFace?.(f)) continue;
    const s = m.faceOffsets[f],
      e = m.faceOffsets[f + 1];
    const vs: number[] = [],
      cs: Src[] = [];
    for (let c = s; c < e; c++) {
      vs.push(faceVerts ? faceVerts(f, c - s, m.corners[c]) : m.corners[c]);
      cs.push(c);
    }
    r.face(vs, cs, f);
  }
  for (let i = 0; i < m.looseEdges.length; i += 2) r.edge(m.looseEdges[i], m.looseEdges[i + 1]);
}

export function extrudeVertices(m: MeshComponent, sel: Uint8Array | null, offset: Float32Array): ExtrudeResult {
  const r = new Rebuild(m);
  copyAll(r, m);
  const nv = m.vertCount;
  const newEdges: number[] = [];
  for (let v = 0; v < nv; v++) {
    if (sel && !sel[v]) continue;
    const P = m.positions;
    const nvx = r.vert(P[v * 3] + offset[v * 3], P[v * 3 + 1] + offset[v * 3 + 1], P[v * 3 + 2] + offset[v * 3 + 2], v);
    r.edge(v, nvx);
    newEdges.push(v, nvx);
  }
  const mesh = r.build();
  const top = new Uint8Array(mesh.vertCount);
  top.fill(1, nv);
  return {
    mesh,
    top: { domain: 'POINT', data: top },
    side: { domain: 'EDGE', data: edgeFlags(mesh, newEdges) },
  };
}

export function extrudeEdges(m: MeshComponent, sel: Uint8Array | null, offset: Float32Array /* per edge */): ExtrudeResult {
  const topo = m.topology();
  const ne = topo.edgeCount,
    nv = m.vertCount;
  const r = new Rebuild(m);
  copyAll(r, m);
  // average edge offsets onto their vertices
  const dup = new Int32Array(nv).fill(-1);
  const acc = new Float64Array(nv * 3),
    cnt = new Uint32Array(nv);
  for (let e = 0; e < ne; e++) {
    if (sel && !sel[e]) continue;
    for (const v of [topo.edges[e * 2], topo.edges[e * 2 + 1]]) {
      for (let k = 0; k < 3; k++) acc[v * 3 + k] += offset[e * 3 + k];
      cnt[v]++;
    }
  }
  const P = m.positions;
  for (let v = 0; v < nv; v++) {
    if (!cnt[v]) continue;
    dup[v] = r.vert(P[v * 3] + acc[v * 3] / cnt[v], P[v * 3 + 1] + acc[v * 3 + 1] / cnt[v], P[v * 3 + 2] + acc[v * 3 + 2] / cnt[v], v);
  }
  const fstart = m.faceCount;
  const topEdges: number[] = [];
  for (let e = 0; e < ne; e++) {
    if (sel && !sel[e]) continue;
    let a = topo.edges[e * 2],
      b = topo.edges[e * 2 + 1];
    // orient the side face against an adjacent face so normals stay consistent
    const f0 = topo.edgeFaceOffsets[e] < topo.edgeFaceOffsets[e + 1] ? topo.edgeFaces[topo.edgeFaceOffsets[e]] : -1;
    let ca: Src = -1,
      cb: Src = -1;
    if (f0 >= 0) {
      const s = m.faceOffsets[f0],
        en = m.faceOffsets[f0 + 1];
      for (let c = s; c < en; c++) {
        const nx = c + 1 < en ? c + 1 : s;
        if (m.corners[c] === a && m.corners[nx] === b) {
          [a, b] = [b, a];
          ca = nx;
          cb = c;
          break;
        }
        if (m.corners[c] === b && m.corners[nx] === a) {
          ca = nx;
          cb = c;
          break;
        }
      }
    }
    r.face([a, b, dup[b], dup[a]], [ca, cb, cb, ca], f0);
    r.edgeSrc.set(edgeKey(dup[a], dup[b]), e);
    topEdges.push(dup[a], dup[b]);
  }
  const mesh = r.build();
  const side = new Uint8Array(mesh.faceCount);
  side.fill(1, fstart);
  return {
    mesh,
    top: { domain: 'EDGE', data: edgeFlags(mesh, topEdges) },
    side: { domain: 'FACE', data: side },
  };
}

export function extrudeFaces(m: MeshComponent, sel: Uint8Array | null, offsetFace: Float32Array, individual: boolean): ExtrudeResult {
  const nf = m.faceCount,
    nv = m.vertCount;
  const isSel = (f: number) => !sel || !!sel[f];
  const topo = m.topology();
  const r = new Rebuild(m);
  const P = m.positions;
  // connected regions: vertices completely inside the selected region are moved, not duplicated
  const inside = new Uint8Array(nv);
  const regionAcc = new Float64Array(nv * 3),
    regionCnt = new Uint32Array(nv);
  if (!individual) {
    for (let v = 0; v < nv; v++) {
      const f0 = topo.vertFaceOffsets[v],
        f1 = topo.vertFaceOffsets[v + 1];
      if (f1 === f0) continue;
      let all = true;
      for (let j = f0; j < f1; j++) if (!isSel(topo.vertFaces[j])) all = false;
      if (!all) continue;
      let boundary = false;
      for (let j = topo.vertEdgeOffsets[v]; j < topo.vertEdgeOffsets[v + 1] && !boundary; j++) {
        const e = topo.vertEdges[j];
        const nfe = topo.edgeFaceOffsets[e + 1] - topo.edgeFaceOffsets[e];
        if (nfe !== 2) boundary = true;
      }
      if (!boundary) inside[v] = 1;
    }
    for (let f = 0; f < nf; f++) {
      if (!isSel(f)) continue;
      for (let c = m.faceOffsets[f]; c < m.faceOffsets[f + 1]; c++) {
        const v = m.corners[c];
        for (let k = 0; k < 3; k++) regionAcc[v * 3 + k] += offsetFace[f * 3 + k];
        regionCnt[v]++;
      }
    }
  }
  for (let v = 0; v < nv; v++) {
    if (inside[v]) r.vert(P[v * 3] + regionAcc[v * 3] / regionCnt[v], P[v * 3 + 1] + regionAcc[v * 3 + 1] / regionCnt[v], P[v * 3 + 2] + regionAcc[v * 3 + 2] / regionCnt[v], v);
    else r.copyVert(v);
  }
  const topFlags: number[] = [],
    sideFlags: number[] = [];
  if (individual) {
    // each selected face gets its own new vertices
    const faceNew: Int32Array[] = [];
    for (let f = 0; f < nf; f++) {
      if (!isSel(f)) continue;
      const s = m.faceOffsets[f],
        e = m.faceOffsets[f + 1];
      const ids = new Int32Array(e - s);
      for (let c = s; c < e; c++) {
        const v = m.corners[c];
        ids[c - s] = r.vert(P[v * 3] + offsetFace[f * 3], P[v * 3 + 1] + offsetFace[f * 3 + 1], P[v * 3 + 2] + offsetFace[f * 3 + 2], v);
      }
      faceNew[f] = ids;
    }
    for (let f = 0; f < nf; f++) {
      const s = m.faceOffsets[f],
        e = m.faceOffsets[f + 1];
      const vs: number[] = [],
        cs: Src[] = [];
      for (let c = s; c < e; c++) {
        vs.push(faceNew[f] ? faceNew[f][c - s] : m.corners[c]);
        cs.push(c);
      }
      r.face(vs, cs, f);
      topFlags.push(faceNew[f] ? 1 : 0);
      sideFlags.push(0);
    }
    for (let f = 0; f < nf; f++) {
      if (!faceNew[f]) continue;
      const s = m.faceOffsets[f],
        e = m.faceOffsets[f + 1],
        n = e - s;
      for (let k = 0; k < n; k++) {
        const c = s + k,
          cn = s + ((k + 1) % n);
        const a = m.corners[c],
          b = m.corners[cn];
        r.face([a, b, faceNew[f][(k + 1) % n], faceNew[f][k]], [c, cn, cn, c], f);
        r.edgeSrc.set(edgeKey(faceNew[f][k], faceNew[f][(k + 1) % n]), topo.cornerEdge[c]);
        topFlags.push(0);
        sideFlags.push(1);
      }
    }
  } else {
    // region boundary vertices are duplicated; offsets are averaged per vertex
    const acc = regionAcc,
      cnt = regionCnt;
    const dup = new Int32Array(nv).fill(-1);
    for (let v = 0; v < nv; v++) {
      if (!cnt[v]) continue;
      dup[v] = inside[v] ? v : r.vert(P[v * 3] + acc[v * 3] / cnt[v], P[v * 3 + 1] + acc[v * 3 + 1] / cnt[v], P[v * 3 + 2] + acc[v * 3 + 2] / cnt[v], v);
    }
    for (let f = 0; f < nf; f++) {
      const vs: number[] = [],
        cs: Src[] = [];
      for (let c = m.faceOffsets[f]; c < m.faceOffsets[f + 1]; c++) {
        vs.push(isSel(f) ? dup[m.corners[c]] : m.corners[c]);
        cs.push(c);
      }
      r.face(vs, cs, f);
      topFlags.push(isSel(f) ? 1 : 0);
      sideFlags.push(0);
    }
    // side faces along the boundary of the selected region
    for (let f = 0; f < nf; f++) {
      if (!isSel(f)) continue;
      const s = m.faceOffsets[f],
        e = m.faceOffsets[f + 1];
      for (let c = s; c < e; c++) {
        const ed = topo.cornerEdge[c];
        let selCount = 0;
        for (let j = topo.edgeFaceOffsets[ed]; j < topo.edgeFaceOffsets[ed + 1]; j++) if (isSel(topo.edgeFaces[j])) selCount++;
        if (selCount !== 1) continue;
        const cn = c + 1 < e ? c + 1 : s;
        const a = m.corners[c],
          b = m.corners[cn];
        r.face([a, b, dup[b], dup[a]], [c, cn, cn, c], f);
        r.edgeSrc.set(edgeKey(dup[a], dup[b]), ed);
        topFlags.push(0);
        sideFlags.push(1);
      }
    }
    // loose edges of selected vertices stay on the original vertices
  }
  for (let i = 0; i < m.looseEdges.length; i += 2) r.edge(m.looseEdges[i], m.looseEdges[i + 1]);
  let mesh = r.build();
  // vertices that are no longer used by anything are removed (fully extruded closed regions)
  mesh = removeUnusedVerts(mesh, nv);
  return {
    mesh,
    top: { domain: 'FACE', data: Uint8Array.from(topFlags) },
    side: { domain: 'FACE', data: Uint8Array.from(sideFlags) },
  };
}

/** Remove original vertices (index < limit) that are used by no face or edge. */
function removeUnusedVerts(m: MeshComponent, limit: number): MeshComponent {
  const used = new Uint8Array(m.vertCount);
  for (const v of m.corners) used[v] = 1;
  for (const v of m.looseEdges) used[v] = 1;
  let unused = 0;
  for (let v = 0; v < limit; v++) if (!used[v]) unused++;
  if (!unused) return m;
  for (let v = limit; v < m.vertCount; v++) used[v] = 1;
  const map = new Int32Array(m.vertCount).fill(-1),
    back: number[] = [];
  for (let v = 0; v < m.vertCount; v++)
    if (used[v]) {
      map[v] = back.length;
      back.push(v);
    }
  const pos = new Float32Array(back.length * 3);
  back.forEach((v, i) => pos.set(m.positions.subarray(v * 3, v * 3 + 3), i * 3));
  const corners = Uint32Array.from(m.corners, (v) => map[v]);
  const loose = Uint32Array.from(m.looseEdges, (v) => map[v]);
  const out = new MeshComponent(pos, m.faceOffsets, corners, loose, new Map(), m.materials);
  const ot = m.topology(),
    nt = out.topology();
  for (const [name, a] of m.attrs) {
    if (a.domain === 'POINT') {
      const comps = a.data.length / m.vertCount;
      const d = new (a.data.constructor as { new (n: number): typeof a.data })(back.length * comps);
      back.forEach((v, i) => {
        for (let k = 0; k < comps; k++) d[i * comps + k] = a.data[v * comps + k];
      });
      out.attrs.set(name, { ...a, data: d });
    } else if (a.domain === 'EDGE') {
      // edge order is preserved for face edges; remap via vertex pairs
      const h = new EdgeHash(nt.edgeCount);
      for (let e = 0; e < nt.edgeCount; e++) h.getOrAdd(nt.edges[e * 2], nt.edges[e * 2 + 1], e);
      const comps = a.data.length / ot.edgeCount;
      const d = new (a.data.constructor as { new (n: number): typeof a.data })(nt.edgeCount * comps);
      for (let e = 0; e < ot.edgeCount; e++) {
        const x = map[ot.edges[e * 2]],
          y = map[ot.edges[e * 2 + 1]];
        if (x < 0 || y < 0) continue;
        const j = h.get(x, y);
        if (j >= 0) for (let k = 0; k < comps; k++) d[j * comps + k] = a.data[e * comps + k];
      }
      out.attrs.set(name, { ...a, data: d });
    } else out.attrs.set(name, a);
  }
  return out;
}

/** Evaluate an offset field given on one domain as per-face vectors (helper for callers). */
export function toFaceVectors(m: MeshComponent, data: Float32Array, from: 'POINT' | 'FACE'): Float32Array {
  return from === 'FACE' ? data : (adaptDomain(m, data, 'FLOAT_VECTOR', 'POINT', 'FACE') as Float32Array);
}
