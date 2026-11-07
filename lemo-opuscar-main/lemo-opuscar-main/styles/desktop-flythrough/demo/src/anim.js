// Motion helpers shared by every segment. Time in seconds; 120 BPM → beat = 0.5 s, bar = 2 s.
import * as THREE from 'three';
import { clamp, lerp, seg, ss, eio, eo, ei, back, hash } from '/core/lib.js';
export const BEAT = .5, BAR = 2;
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const arc = p => 4 * p * (1 - p);

// a squash/stretch envelope from a list of landings and take-offs
export function squash(t, lands = [], takeoffs = [], air = null, k = 1) {
  let sq = 1;
  if (air !== null && air > 0 && air < 1) sq += .14 * k * Math.sin(Math.PI * air);
  for (const tl of lands) { const d = t - tl; if (d >= 0 && d < .2) sq -= .32 * k * Math.sin(Math.PI * d / .2) * (1 - d / .2); }
  for (const ta of takeoffs) { const d = ta - t; if (d > 0 && d < .09) sq -= .18 * k * Math.sin(Math.PI * d / .09); }
  return sq;
}

// hops along a list [{t0, t1, from:Vector3, to:Vector3, h}] → {pos, air, lands, takeoffs, dir}
export function hops(t, list, rest) {
  let pos = rest.clone(), air = null, dir = null;
  for (const hp of list) {
    if (t >= hp.t1) { pos = hp.to.clone(); continue; }
    if (t >= hp.t0) {
      const p = seg(t, hp.t0, hp.t1), e = hp.ease ? hp.ease(p) : lerp(p, ss(p), .5);
      pos = hp.from.clone().lerp(hp.to, e); pos.y += (hp.h ?? .03) * arc(p); air = p;
      dir = hp.to.clone().sub(hp.from);
    }
    break;
  }
  return { pos, air, dir, lands: list.map(h => h.t1), takeoffs: list.map(h => h.t0) };
}

// bounce on every beat between t0 and t1 (a little dance); returns {y, sq}
export function beatBounce(t, t0, t1, amp = .018, phase = 0) {
  if (t < t0 || t > t1) return { y: 0, sq: 1 };
  const u = ((t - t0 + phase) % BEAT) / BEAT;
  const air = u < .55 ? u / .55 : null;                       // airborne for the first 55 % of each beat
  const y = air !== null ? amp * arc(air) : 0;
  let sq = 1;
  if (air !== null) sq += .12 * Math.sin(Math.PI * air);
  else { const d = (u - .55) / .45; sq -= .22 * Math.sin(Math.PI * d) * (1 - d); }
  return { y, sq };
}

// the "pop": a flat sticker stands up and extrudes into a toy, with a jump. Returns {e, hinge, y, sq}
export function pop(t, t0, dur = .4, jump = .045) {
  const p = seg(t, t0, t0 + dur);
  if (t < t0) return { e: 0, hinge: 0, y: 0, sq: 1 };
  const hinge = back(seg(t, t0, t0 + dur * .45), 2.2), e = seg(t, t0 + dur * .1, t0 + dur);
  const y = p < 1 ? jump * arc(p) : 0;
  let sq = p < 1 ? 1 + .25 * Math.sin(Math.PI * p) : 1;
  const d = t - (t0 + dur); if (d >= 0 && d < .22) sq -= .3 * Math.sin(Math.PI * d / .22) * (1 - d / .22);
  return { e, hinge, y, sq };
}

export const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
export { clamp, lerp, seg, ss, eio, eo, ei, back, hash };
