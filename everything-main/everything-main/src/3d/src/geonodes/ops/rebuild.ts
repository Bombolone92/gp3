// Mesh rebuilding with attribute propagation: every new vertex/corner records the source
// elements (with weights) it derives from, every new face its source face. Attributes of all
// domains (named and anonymous) are carried over; edges inherit from source edges by vertex pair.
import { EdgeHash, MeshComponent, allocData, dataComps, type AttrMap, type Interp } from '../geometry';
import type { Domain } from '../types';

export type Src = number | number[]; // single source index, or [idx, w, idx, w, …]

class Sources {
  off: number[] = [0];
  src: number[] = [];
  w: number[] = [];
  add(s: Src) {
    if (typeof s === 'number') {
      if (s >= 0) {
        this.src.push(s);
        this.w.push(1);
      }
    } else
      for (let i = 0; i < s.length; i += 2) {
        this.src.push(s[i]);
        this.w.push(s[i + 1]);
      }
    this.off.push(this.src.length);
  }
  interp(): Interp {
    return {
      offsets: Uint32Array.from(this.off),
      src: Uint32Array.from(this.src),
      w: Float32Array.from(this.w),
    };
  }
  /** single source per element (or −1) when every element has at most one weight-1 source */
  gather(): Int32Array | null {
    const n = this.off.length - 1,
      out = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.off[i],
        b = this.off[i + 1];
      if (b - a === 0) out[i] = -1;
      else if (b - a === 1 && this.w[a] === 1) out[i] = this.src[a];
      else return null;
    }
    return out;
  }
}

export class Rebuild {
  pos: number[] = [];
  faceOffsets: number[] = [0];
  corners: number[] = [];
  loose: number[] = [];
  private vs = new Sources();
  private cs = new Sources();
  fSrc: number[] = [];
  /** explicit edge sources for new edges (key "a,b" with a<b) */
  edgeSrc = new Map<number, number>();
  constructor(public src: MeshComponent) {}

  vert(x: number, y: number, z: number, s: Src): number {
    this.pos.push(x, y, z);
    this.vs.add(s);
    return this.pos.length / 3 - 1;
  }
  /** copy an old vertex (same position) */
  copyVert(v: number): number {
    const P = this.src.positions;
    return this.vert(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], v);
  }
  face(verts: number[], cornerSrc: Src[], faceSrc: number) {
    for (let i = 0; i < verts.length; i++) {
      this.corners.push(verts[i]);
      this.cs.add(cornerSrc[i] ?? -1);
    }
    this.faceOffsets.push(this.corners.length);
    this.fSrc.push(faceSrc);
  }
  edge(a: number, b: number) {
    this.loose.push(a, b);
  }
  get vertCount() {
    return this.pos.length / 3;
  }

  build(skip?: Set<string>): MeshComponent {
    const old = this.src;
    const out = new MeshComponent(new Float32Array(this.pos), Uint32Array.from(this.faceOffsets), Uint32Array.from(this.corners), Uint32Array.from(this.loose), new Map(), [...old.materials]);
    const attrs: AttrMap = out.attrs;
    const vg = this.vs.gather(),
      cg = this.cs.gather();
    const vi = vg ? null : this.vs.interp(),
      ci = cg ? null : this.cs.interp();
    const fg = Int32Array.from(this.fSrc);
    let edgeMap: Int32Array | null = null;
    const edgeSources = (): Int32Array => {
      if (edgeMap) return edgeMap;
      const ot = old.topology(),
        nt = out.topology();
      const h = new EdgeHash(ot.edgeCount);
      for (let e = 0; e < ot.edgeCount; e++) h.getOrAdd(ot.edges[e * 2], ot.edges[e * 2 + 1], e);
      edgeMap = new Int32Array(nt.edgeCount).fill(-1);
      const vsrc = vg ?? this.vs.gather();
      for (let e = 0; e < nt.edgeCount; e++) {
        const a = nt.edges[e * 2],
          b = nt.edges[e * 2 + 1];
        const key = a < b ? a * 0x4000000 + b : b * 0x4000000 + a;
        const ex = this.edgeSrc.get(key);
        if (ex !== undefined) {
          edgeMap[e] = ex;
          continue;
        }
        if (!vsrc) continue;
        const oa = vsrc[a],
          ob = vsrc[b];
        if (oa >= 0 && ob >= 0 && oa !== ob) edgeMap[e] = h.get(oa, ob);
      }
      return edgeMap;
    };
    for (const [name, a] of old.attrs) {
      if (skip?.has(name)) continue;
      const comps = dataComps(a.type);
      const gatherWith = (map: ArrayLike<number>, n: number) => {
        const d = allocData(a.type, n);
        for (let i = 0; i < n; i++) {
          const s = map[i];
          if (s < 0) continue;
          for (let k = 0; k < comps; k++) d[i * comps + k] = a.data[s * comps + k];
        }
        return d;
      };
      const interpWith = (ip: Interp) => {
        const n = ip.offsets.length - 1;
        const d = allocData(a.type, n);
        const isBool = a.type === 'BOOLEAN',
          isInt = a.type === 'INT' || a.type === 'INT8';
        for (let i = 0; i < n; i++)
          for (let k = 0; k < comps; k++) {
            let s = 0;
            for (let j = ip.offsets[i]; j < ip.offsets[i + 1]; j++) s += a.data[ip.src[j] * comps + k] * ip.w[j];
            d[i * comps + k] = isBool ? (s >= 0.5 ? 1 : 0) : isInt ? Math.round(s) : s;
          }
        return d;
      };
      let data;
      const dom: Domain = a.domain;
      if (dom === 'POINT') data = vg ? gatherWith(vg, out.vertCount) : interpWith(vi!);
      else if (dom === 'CORNER') data = cg ? gatherWith(cg, out.cornerCount) : interpWith(ci!);
      else if (dom === 'FACE') data = gatherWith(fg, out.faceCount);
      else if (dom === 'EDGE') data = gatherWith(edgeSources(), out.edgeCount);
      else continue;
      attrs.set(name, { domain: dom, type: a.type, data });
    }
    return out;
  }
}

export const edgeKey = (a: number, b: number) => (a < b ? a * 0x4000000 + b : b * 0x4000000 + a);
