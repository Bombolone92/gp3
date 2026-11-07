// Component picking for Edit Mode (vertices / edges / faces) with occlusion tests.
import { BufferGeometry, Float32BufferAttribute, Matrix4, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MeshData, ObjectData } from '../../data/types';
import { app } from '../../app/app';
import type { View3D } from '../../editors/view3d/view3d';
import { triangulatePoly } from '../../mesh/mesh';

interface BvhEntry {
  key: object;
  bvh: MeshBVH;
  triFace: Uint32Array;
}
const bvhCache = new WeakMap<MeshData, BvhEntry>();

export function meshBVH(me: MeshData): BvhEntry {
  const hit = bvhCache.get(me);
  if (hit && hit.key === me.positions && (hit as unknown as { idx: unknown }).idx === me.indices) return hit;
  const pos: number[] = [],
    index: number[] = [],
    triFace: number[] = [];
  const tmp: number[] = [];
  const P = me.positions;
  for (let i = 0; i < P.length; i++) pos.push(P[i]);
  for (let f = 0; f < me.offsets.length - 1; f++) {
    const s = me.offsets[f],
      e = me.offsets[f + 1];
    if (me.hide_vert && Array.from(me.indices.subarray(s, e)).some((v) => me.hide_vert![v])) continue;
    tmp.length = 0;
    triangulatePoly(P, me.indices.subarray(s, e), tmp, 0);
    for (let i = 0; i < tmp.length; i++) index.push(me.indices[s + tmp[i]]);
    for (let i = 0; i < tmp.length / 3; i++) triFace.push(f);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(index.length ? index : [0, 0, 0]);
  const bvh = new MeshBVH(g);
  const entry = { key: me.positions, bvh, triFace: new Uint32Array(triFace), idx: me.indices } as unknown as BvhEntry;
  bvhCache.set(me, entry);
  return entry;
}

export interface PickContext {
  v: View3D;
  ob: ObjectData;
  me: MeshData;
  world: Matrix4;
  inv: Matrix4;
  xray: boolean;
}

export function pickContext(v: View3D, ob: ObjectData, me: MeshData): PickContext {
  const world = app.graph.get(ob.id)?.world ?? new Matrix4();
  const xray = v.shading.type === 'WIREFRAME' ? v.shading.show_xray_wireframe : v.shading.show_xray;
  return { v, ob, me, world, inv: world.clone().invert(), xray };
}

/** Screen projection of an object-space point. */
export function project(c: PickContext, x: number, y: number, z: number) {
  const p = new Vector3(x, y, z).applyMatrix4(c.world);
  return c.v.project(p);
}

/** Raycast the mesh (object space) under a pixel; returns face and distance. */
export function raycastFace(c: PickContext, px: number, py: number): { face: number; point: Vector3; dist: number } | null {
  const { origin, dir } = c.v.ray(px, py);
  const o = origin.clone().applyMatrix4(c.inv),
    d = dir.clone().transformDirection(c.inv);
  const e = meshBVH(c.me);
  const hit = e.bvh.raycastFirst(new Ray(o, d), 2 /* DoubleSide */);
  if (!hit || hit.faceIndex === undefined || hit.faceIndex === null) return null;
  return { face: e.triFace[hit.faceIndex], point: hit.point, dist: hit.distance };
}

/** Whether an object-space point is visible from the viewer (not occluded by the mesh). */
export function isVisible(c: PickContext, p: Vector3): boolean {
  if (c.xray) return true;
  const world = p.clone().applyMatrix4(c.world);
  const cam = c.v.camera;
  const camPos = c.v.nav.ortho && !c.v.sceneCamera ? null : cam.position.clone();
  let o: Vector3, d: Vector3, len: number;
  if (camPos) {
    o = camPos.applyMatrix4(c.inv);
    const pl = p.clone();
    d = pl.clone().sub(o);
    len = d.length();
    d.normalize();
  } else {
    const fwd = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    o = world.clone().addScaledVector(fwd, -1e4).applyMatrix4(c.inv);
    d = p.clone().sub(o);
    len = d.length();
    d.normalize();
  }
  const e = meshBVH(c.me);
  const hit = e.bvh.raycastFirst(new Ray(o, d), 2);
  if (!hit) return true;
  return hit.distance >= len - Math.max(1e-4, len * 1e-4);
}

export function nearestVertex(c: PickContext, px: number, py: number, radius = 20): { index: number; dist: number } | null {
  const P = c.me.positions;
  let best = -1,
    bd = radius;
  const cand: { i: number; d: number }[] = [];
  for (let i = 0; i < P.length / 3; i++) {
    if (c.me.hide_vert?.[i]) continue;
    const s = project(c, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    if (s.z < -1 || s.z > 1) continue;
    const d = Math.hypot(s.x - px, s.y - py);
    if (d < radius) cand.push({ i, d });
  }
  cand.sort((a, b) => a.d - b.d);
  for (const { i, d } of cand) {
    if (isVisible(c, new Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]))) {
      best = i;
      bd = d;
      break;
    }
  }
  return best >= 0 ? { index: best, dist: bd } : null;
}

export function nearestEdge(c: PickContext, px: number, py: number, radius = 16): { a: number; b: number; dist: number } | null {
  const me = c.me,
    P = me.positions;
  const cand: { a: number; b: number; d: number; t: number }[] = [];
  const seen = new Set<string>();
  const proj = new Map<number, { x: number; y: number; z: number }>();
  const sp = (i: number) => {
    let s = proj.get(i);
    if (!s) {
      s = project(c, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      proj.set(i, s);
    }
    return s;
  };
  const consider = (a: number, b: number) => {
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(k)) return;
    seen.add(k);
    if (me.hide_vert?.[a] || me.hide_vert?.[b]) return;
    const A = sp(a),
      B = sp(b);
    if (A.z > 1 || B.z > 1) return;
    const dx = B.x - A.x,
      dy = B.y - A.y,
      l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - A.x) * dx + (py - A.y) * dy) / l2)) : 0;
    const d = Math.hypot(A.x + dx * t - px, A.y + dy * t - py);
    if (d < radius) cand.push({ a, b, d, t });
  };
  for (let f = 0; f < me.offsets.length - 1; f++) {
    const s = me.offsets[f],
      e = me.offsets[f + 1];
    for (let k = s; k < e; k++) consider(me.indices[k], me.indices[k + 1 < e ? k + 1 : s]);
  }
  if (me.loose_edges) for (let i = 0; i < me.loose_edges.length; i += 2) consider(me.loose_edges[i], me.loose_edges[i + 1]);
  cand.sort((x, y) => x.d - y.d);
  for (const e of cand) {
    const p = new Vector3(P[e.a * 3], P[e.a * 3 + 1], P[e.a * 3 + 2]).lerp(new Vector3(P[e.b * 3], P[e.b * 3 + 1], P[e.b * 3 + 2]), e.t);
    if (isVisible(c, p)) return { a: e.a, b: e.b, dist: e.d };
  }
  return null;
}

export function pickFace(c: PickContext, px: number, py: number): { face: number; dist: number } | null {
  if (!c.xray) {
    const h = raycastFace(c, px, py);
    return h ? { face: h.face, dist: 0 } : null;
  }
  // x-ray: nearest face center
  const me = c.me,
    P = me.positions;
  let best = -1,
    bd = 30;
  for (let f = 0; f < me.offsets.length - 1; f++) {
    let cx = 0,
      cy = 0,
      cz = 0;
    const s = me.offsets[f],
      e = me.offsets[f + 1];
    for (let k = s; k < e; k++) {
      const v = me.indices[k];
      cx += P[v * 3];
      cy += P[v * 3 + 1];
      cz += P[v * 3 + 2];
    }
    const n = e - s;
    const sp = project(c, cx / n, cy / n, cz / n);
    const d = Math.hypot(sp.x - px, sp.y - py);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best >= 0 ? { face: best, dist: bd } : null;
}

/** Inside test for selection regions. */
export type Region = { kind: 'box'; x0: number; y0: number; x1: number; y1: number } | { kind: 'circle'; x: number; y: number; r: number } | { kind: 'lasso'; pts: { x: number; y: number }[] };

export function inRegion(r: Region, x: number, y: number) {
  if (r.kind === 'box') return x >= Math.min(r.x0, r.x1) && x <= Math.max(r.x0, r.x1) && y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1);
  if (r.kind === 'circle') return Math.hypot(x - r.x, y - r.y) <= r.r;
  let c = false;
  const p = r.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (p[i].y > y !== p[j].y > y && x < ((p[j].x - p[i].x) * (y - p[i].y)) / (p[j].y - p[i].y) + p[i].x) c = !c;
  return c;
}

/** Vertices inside a region (visible only unless x-ray). */
export function vertsInRegion(c: PickContext, r: Region): number[] {
  const P = c.me.positions,
    out: number[] = [];
  for (let i = 0; i < P.length / 3; i++) {
    if (c.me.hide_vert?.[i]) continue;
    const s = project(c, P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    if (s.z < -1 || s.z > 1 || !inRegion(r, s.x, s.y)) continue;
    if (isVisible(c, new Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]))) out.push(i);
  }
  return out;
}

/** Faces whose center is inside a region (visible centers only unless x-ray). */
export function facesInRegion(c: PickContext, r: Region): number[] {
  const me = c.me,
    P = me.positions,
    out: number[] = [];
  for (let f = 0; f < me.offsets.length - 1; f++) {
    const s = me.offsets[f],
      e = me.offsets[f + 1];
    let cx = 0,
      cy = 0,
      cz = 0,
      hidden = false;
    for (let k = s; k < e; k++) {
      const v = me.indices[k];
      if (me.hide_vert?.[v]) hidden = true;
      cx += P[v * 3];
      cy += P[v * 3 + 1];
      cz += P[v * 3 + 2];
    }
    if (hidden) continue;
    const n = e - s;
    const cen = new Vector3(cx / n, cy / n, cz / n);
    const sp = project(c, cen.x, cen.y, cen.z);
    if (sp.z > 1 || !inRegion(r, sp.x, sp.y)) continue;
    if (c.xray) {
      out.push(f);
      continue;
    }
    // visible if the face is the first hit along the ray to its center
    const h = raycastFace(c, sp.x, sp.y);
    if (h && h.face === f) out.push(f);
  }
  return out;
}
