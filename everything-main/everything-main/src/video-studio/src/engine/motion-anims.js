/**
 * Motion animations for any visual clip, beyond the basic set in scene.js.
 * Each takes a progress p (0..1) and mutates the layer state
 * { x, y, scale, rotation, opacity, blur } where x and y are fractions of the
 * frame (y grows downward). In animations end at rest at p = 1, out
 * animations start at rest at p = 0, loops repeat with a phase 0..1, and
 * "whole" loops play once across the entire clip.
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const outCubic = (p) => 1 - (1 - p) ** 3;
const inCubic = (p) => p * p * p;
const inOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const outExpo = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p));
const inExpo = (p) => (p <= 0 ? 0 : 2 ** (10 * p - 10));
const outElastic = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : 2 ** (-10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
const outBack = (p, k = 1.70158) => 1 + (k + 1) * (p - 1) ** 3 + k * (p - 1) ** 2;
const inBack = (p, k = 1.70158) => (k + 1) * p * p * p - k * p * p;
/** Damped spring from 0 to 1 (lands exactly on 1 at p = 1). */
const spring = (p) => 1 - Math.exp(-6 * p) * Math.cos(p * 12) * (1 - p);
/** Deterministic wiggle in -1..1 for a phase and a seed. */
const wiggle = (t, seed) => Math.sin(t * 12.9898 + seed * 78.233) * 0.6 + Math.sin(t * 31.7 + seed * 3.1) * 0.4;

export const MOTION_IN = {
  'rise-in': (p, s) => { s.y += 0.12 * (1 - outCubic(p)); s.opacity *= clamp01(p * 1.6); },
  'drop-in': (p, s) => { s.y -= 0.12 * (1 - outCubic(p)); s.opacity *= clamp01(p * 1.6); },
  'peek-in': (p, s) => { const e = outCubic(p); s.y += 0.05 * (1 - e); s.scale *= 0.92 + 0.08 * e; s.opacity *= e; },
  'settle-in': (p, s) => { const e = outCubic(p); s.scale *= 1.18 - 0.18 * e; s.opacity *= e; },
  'glide-in': (p, s) => { const e = outCubic(p); s.x -= 0.3 * (1 - e); s.y += 0.18 * (1 - e); s.opacity *= clamp01(p * 2); },
  'whip-left-in': (p, s) => { const e = outExpo(p); s.x += 0.9 * (1 - e); s.blur = Math.max(s.blur, (1 - e) * 0.9); },
  'whip-right-in': (p, s) => { const e = outExpo(p); s.x -= 0.9 * (1 - e); s.blur = Math.max(s.blur, (1 - e) * 0.9); },
  'roll-in': (p, s) => { const e = outCubic(p); s.x -= 0.6 * (1 - e); s.rotation -= 270 * (1 - e); s.opacity *= clamp01(p * 3); },
  'spin-up-in': (p, s) => { const e = outCubic(p); s.rotation -= 360 * (1 - e); s.scale *= 0.2 + 0.8 * e; s.opacity *= clamp01(p * 3); },
  'twist-in': (p, s) => { const e = outCubic(p); s.rotation += 90 * (1 - e); s.scale *= 0.5 + 0.5 * e; s.opacity *= clamp01(p * 2); },
  'swing-in': (p, s) => { s.rotation += 28 * Math.exp(-4 * p) * Math.cos(p * 11) * (1 - p); s.opacity *= clamp01(p * 4); },
  'elastic-in': (p, s) => { s.scale *= Math.max(0, outElastic(p)); },
  'rubber-in': (p, s) => { s.scale *= 1 + 0.28 * Math.sin(p * Math.PI * 3) * (1 - p); s.opacity *= clamp01(p * 4); },
  'spring-in': (p, s) => { s.y += 0.5 * (1 - spring(p)); s.opacity *= clamp01(p * 4); },
  'dive-in': (p, s) => { const e = outCubic(p); s.scale *= 3 - 2 * e; s.opacity *= e; s.blur = Math.max(s.blur, (1 - e) * 0.6); },
  'focus-in': (p, s) => { const e = outCubic(p); s.blur = Math.max(s.blur, 1 - e); s.scale *= 1.2 - 0.2 * e; s.opacity *= clamp01(p * 2.5); },
  'shake-in': (p, s) => { s.x += Math.sin(p * Math.PI * 10) * 0.03 * (1 - p); s.opacity *= clamp01(p * 3); },
  'flicker-in': (p, s) => { s.opacity *= p > 0.7 ? 1 : (Math.floor(p * 14) % 2 ? 1 : 0.15) * clamp01(p * 3); },
  'back-in': (p, s) => { s.scale *= Math.max(0, outBack(p, 2.6)); s.opacity *= clamp01(p * 3); },
};

export const MOTION_OUT = {
  'sink-out': (p, s) => { s.y += 0.12 * inCubic(p); s.opacity *= 1 - p; },
  'lift-out': (p, s) => { s.y -= 0.12 * inCubic(p); s.opacity *= 1 - p; },
  'settle-out': (p, s) => { const e = inCubic(p); s.scale *= 1 + 0.18 * e; s.opacity *= 1 - e; },
  'whip-left-out': (p, s) => { const e = inExpo(p); s.x -= 0.9 * e; s.blur = Math.max(s.blur, e * 0.9); },
  'whip-right-out': (p, s) => { const e = inExpo(p); s.x += 0.9 * e; s.blur = Math.max(s.blur, e * 0.9); },
  'roll-out': (p, s) => { const e = inCubic(p); s.x += 0.6 * e; s.rotation += 270 * e; s.opacity *= clamp01((1 - p) * 3); },
  'spin-away-out': (p, s) => { const e = inCubic(p); s.rotation += 360 * e; s.scale *= 1 - 0.8 * e; s.opacity *= clamp01((1 - p) * 3); },
  'twist-out': (p, s) => { const e = inCubic(p); s.rotation -= 90 * e; s.scale *= 1 - 0.5 * e; s.opacity *= 1 - p; },
  'fall-out': (p, s) => { s.y += 0.9 * p * p; s.rotation += 18 * p; s.opacity *= clamp01((1 - p) * 4); },
  'shrink-back-out': (p, s) => { s.scale *= Math.max(0, 1 - inBack(p, 2.4)); },
  'dive-out': (p, s) => { const e = inCubic(p); s.scale *= 1 + 2 * e; s.opacity *= 1 - p; s.blur = Math.max(s.blur, e * 0.6); },
  'focus-out': (p, s) => { const e = inCubic(p); s.blur = Math.max(s.blur, e); s.scale *= 1 + 0.2 * e; s.opacity *= clamp01((1 - p) * 2.5); },
  'shake-out': (p, s) => { s.x += Math.sin(p * Math.PI * 10) * 0.03 * p; s.opacity *= 1 - p * p; },
  'flicker-out': (p, s) => { s.opacity *= p < 0.3 ? 1 : (Math.floor(p * 14) % 2 ? 0.15 : 1) * clamp01((1 - p) * 3); },
  'squeeze-out': (p, s) => { const e = inCubic(p); s.scale *= 1 - e; s.rotation += 25 * e; },
};

export const MOTION_LOOP = {
  heartbeat: (q, s) => { const beat = (c) => Math.exp(-((q - c) ** 2) / 0.002); s.scale *= 1 + 0.07 * beat(0.1) + 0.05 * beat(0.28); },
  bob: (q, s) => { s.y -= Math.abs(Math.sin(q * Math.PI)) * 0.04; },
  rock: (q, s) => { s.rotation += Math.sin(q * Math.PI * 2) * 4; },
  orbit: (q, s) => { s.x += Math.cos(q * Math.PI * 2) * 0.015; s.y += Math.sin(q * Math.PI * 2) * 0.015; },
  jiggle: (q, s) => { s.x += wiggle(q * 6, 1) * 0.008; s.y += wiggle(q * 6, 2) * 0.008; s.rotation += wiggle(q * 6, 3) * 1.5; },
  pendulum: (q, s) => { s.rotation += Math.sin(q * Math.PI * 2) * 14; },
  blink: (q, s) => { s.opacity *= 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(q * Math.PI * 2)); },
  hover: (q, s) => { s.y += Math.sin(q * Math.PI * 2) * 0.012; s.rotation += Math.sin(q * Math.PI * 2 + 1) * 1.2; },
  // One pass over the whole clip (photos and b-roll).
  'push-in': (q, s) => { s.scale *= 1 + 0.15 * inOut(q); },
  'pull-out': (q, s) => { s.scale *= 1.15 - 0.15 * inOut(q); },
  'pan-left': (q, s) => { s.scale *= 1.15; s.x += 0.06 - 0.12 * inOut(q); },
  'pan-right': (q, s) => { s.scale *= 1.15; s.x -= 0.06 - 0.12 * inOut(q); },
  'pan-up': (q, s) => { s.scale *= 1.15; s.y += 0.06 - 0.12 * inOut(q); },
  'pan-down': (q, s) => { s.scale *= 1.15; s.y -= 0.06 - 0.12 * inOut(q); },
  'drift-zoom': (q, s) => { s.scale *= 1.04 + 0.12 * inOut(q); s.x += 0.03 * (inOut(q) - 0.5); s.rotation += 1.2 * (q - 0.5); },
};

/** Whole-clip loops: progress runs from the clip start to its end once. */
export const WHOLE_LOOPS = new Set(['push-in', 'pull-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'drift-zoom']);

const TABLES = { in: MOTION_IN, out: MOTION_OUT, loop: MOTION_LOOP };

/** Apply a motion animation if id is one of these; returns whether it was. */
export function applyMotion(kind, id, p, s) {
  const fn = TABLES[kind]?.[id];
  if (!fn) return false;
  fn(p, s);
  return true;
}
