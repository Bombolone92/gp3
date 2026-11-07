// Automatic armature weights ("Armature Deform With Automatic Weights", Ctrl P): one vertex group
// per deforming bone; weights from a heat-diffusion style solve on the mesh graph.
//
// Method (simplified "bone heat"): every vertex gets a heat coefficient H = c / d² where d is the
// distance to its nearest bone segment, and that nearest bone (or bones, on ties) is its heat
// source. For each bone we then solve (L + H) w = H p with a uniform graph Laplacian scaled by the
// local edge length, by Gauss-Seidel iterations starting from inverse-distance weights. Weights are
// normalized per vertex, tiny weights (< 1%) are dropped and the rest renormalized. Unlike the full
// method there is no bone visibility test and no cotangent Laplacian.
import { Matrix4, Vector3 } from 'three';
import { app } from '../app/app';
import { own } from '../data/cow';
import type { MeshData, ObjectData } from '../data/types';
import { vertexNeighbors } from '../mesh/mesh';
import { modeHandlers } from '../ops/modes';

/** Squared distance from point p to segment ab. */
export function segmentDistance2(px: number, py: number, pz: number, a: Vector3, b: Vector3): number {
  const abx = b.x - a.x,
    aby = b.y - a.y,
    abz = b.z - a.z;
  const apx = px - a.x,
    apy = py - a.y,
    apz = pz - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 0 ? (apx * abx + apy * aby + apz * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t,
    dy = apy - aby * t,
    dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Compute normalized bone weights for vertices (world-space positions) given bone segments.
 * Returns one Float32Array per bone. Exposed for tests.
 */
export function boneHeatWeights(pos: Float32Array, nbOffsets: Uint32Array, nb: Uint32Array, bones: { head: Vector3; tail: Vector3 }[], iterations?: number): Float32Array[] {
  const nv = pos.length / 3,
    nbn = bones.length;
  const out = bones.map(() => new Float32Array(nv));
  if (!nv || !nbn) return out;
  const dist = new Float32Array(nv * nbn);
  const H = new Float32Array(nv);
  const src = new Int32Array(nv * 2).fill(-1); // up to two nearest (tied) bones
  // local mean edge length squared
  const e2 = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    let s = 0;
    const a = nbOffsets[v],
      e = nbOffsets[v + 1];
    for (let j = a; j < e; j++) {
      const u = nb[j];
      s += (pos[u * 3] - pos[v * 3]) ** 2 + (pos[u * 3 + 1] - pos[v * 3 + 1]) ** 2 + (pos[u * 3 + 2] - pos[v * 3 + 2]) ** 2;
    }
    e2[v] = e > a ? s / (e - a) : 0;
  }
  for (let v = 0; v < nv; v++) {
    let best = Infinity;
    for (let b = 0; b < nbn; b++) {
      const d = Math.sqrt(segmentDistance2(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], bones[b].head, bones[b].tail));
      dist[v * nbn + b] = d;
      if (d < best) best = d;
    }
    let k = 0;
    for (let b = 0; b < nbn && k < 2; b++) if (dist[v * nbn + b] <= best * 1.0001 + 1e-9) src[v * 2 + k++] = b;
    const d = Math.max(best, 1e-4);
    // heat coefficient relative to the local Laplacian scale
    H[v] = (1.0 * (e2[v] || d * d)) / (d * d);
  }
  // initial guess: inverse distance (power 4), normalized
  for (let v = 0; v < nv; v++) {
    let sum = 0;
    for (let b = 0; b < nbn; b++) sum += 1 / Math.max(1e-6, dist[v * nbn + b]) ** 4;
    for (let b = 0; b < nbn; b++) out[b][v] = 1 / Math.max(1e-6, dist[v * nbn + b]) ** 4 / sum;
  }
  const iters = iterations ?? Math.max(20, Math.min(300, Math.round(3e7 / (nv * nbn))));
  for (let b = 0; b < nbn; b++) {
    const w = out[b];
    for (let it = 0; it < iters; it++) {
      for (let v = 0; v < nv; v++) {
        const a = nbOffsets[v],
          e = nbOffsets[v + 1];
        const p = src[v * 2] === b || src[v * 2 + 1] === b ? 1 / (src[v * 2 + 1] >= 0 ? 2 : 1) : 0;
        if (e === a) {
          w[v] = p;
          continue;
        }
        let mean = 0;
        for (let j = a; j < e; j++) mean += w[nb[j]];
        mean /= e - a;
        w[v] = (mean + H[v] * p) / (1 + H[v]);
      }
    }
  }
  // normalize, drop tiny weights, renormalize
  for (let v = 0; v < nv; v++) {
    let sum = 0;
    for (let b = 0; b < nbn; b++) sum += out[b][v];
    if (sum <= 0) continue;
    let sum2 = 0;
    for (let b = 0; b < nbn; b++) {
      let x = out[b][v] / sum;
      if (x < 0.01) x = 0;
      out[b][v] = x;
      sum2 += x;
    }
    if (sum2 > 0) for (let b = 0; b < nbn; b++) out[b][v] /= sum2;
  }
  return out;
}

/** Create vertex groups for the deforming bones of `armOb` on `meshOb` (with automatic weights). */
export function armatureWeightsFor(meshOb: ObjectData, armOb: ObjectData, automatic: boolean) {
  const doc = app.doc;
  const me: MeshData | undefined = meshOb.data ? doc.meshes[meshOb.data] : undefined;
  const arm = armOb.data ? doc.armatures[armOb.data] : undefined;
  if (!me || !arm) return;
  const nv = me.positions.length / 3;
  const bones = arm.bones.filter((b) => b.use_deform);
  me.weights = me.weights.slice();
  const groupIndex: number[] = [];
  for (const b of bones) {
    let gi = me.vertex_groups.findIndex((g) => g.name === b.name);
    if (gi < 0) {
      me.vertex_groups.push({ name: b.name });
      me.weights.push(own(new Float32Array(nv)));
      gi = me.vertex_groups.length - 1;
    } else if (!me.weights[gi] || me.weights[gi].length !== nv) me.weights[gi] = own(new Float32Array(nv));
    groupIndex.push(gi);
  }
  if (me.vertex_groups.length && (meshOb.vertex_group_active_index ?? -1) < 0) meshOb.vertex_group_active_index = 0;
  if (!automatic || !bones.length || !nv) return;
  const mw = app.graph.get(meshOb.id)?.world ?? new Matrix4();
  const aw = app.graph.get(armOb.id)?.world ?? new Matrix4();
  const pos = new Float32Array(nv * 3);
  const p = new Vector3();
  for (let v = 0; v < nv; v++) {
    p.set(me.positions[v * 3], me.positions[v * 3 + 1], me.positions[v * 3 + 2]).applyMatrix4(mw);
    pos[v * 3] = p.x;
    pos[v * 3 + 1] = p.y;
    pos[v * 3 + 2] = p.z;
  }
  const segs = bones.map((b) => ({
    head: new Vector3(...b.head).applyMatrix4(aw),
    tail: new Vector3(...b.tail).applyMatrix4(aw),
  }));
  const nbr = vertexNeighbors(me);
  const w = boneHeatWeights(pos, nbr.offsets, nbr.neighbors, segs);
  bones.forEach((_, i) => {
    const gi = groupIndex[i];
    if (me.vertex_groups[gi].lock_weight) return;
    me.weights[gi] = own(w[i]);
  });
}

modeHandlers.WEIGHT_PAINT = {
  ...(modeHandlers.WEIGHT_PAINT ?? {}),
  armatureWeights: armatureWeightsFor,
};
