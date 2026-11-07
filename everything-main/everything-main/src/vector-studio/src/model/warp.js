/**
 * Warp: fifteen bend styles that map artwork inside a bounding box.
 *
 *   warpMapping(style, params, bounds) -> (x, y) => { x, y }
 *   warpSubpaths(subpaths, style, params, bounds, { tolerance }) -> subpaths
 *
 * params: { bend, vertical, distortH, distortV } with bend and the
 * distortions as fractions in -1..1 (the dialog shows them as -100..100%).
 * Horizontal styles bend along the width (an Arc curves the artwork's
 * baseline up); vertical ones along the height. Distortion squeezes one
 * side of the box before the bend, like a perspective view: Horizontal
 * makes the right side taller than the left (negative: shorter), Vertical
 * makes the bottom wider than the top.
 *
 * The mapping is a pure point function, so warpSubpaths can bend any
 * outline with adaptive subdivision (model/point-map.js) and envelopes or
 * other tools can reuse the same styles.
 */
import { mapSubpaths } from './point-map.js';

export const WARP_STYLES = Object.freeze([
  { id: 'arc', label: 'Arc' },
  { id: 'arcLower', label: 'Arc Lower' },
  { id: 'arcUpper', label: 'Arc Upper' },
  { id: 'arch', label: 'Arch' },
  { id: 'bulge', label: 'Bulge' },
  { id: 'shellLower', label: 'Shell Lower' },
  { id: 'shellUpper', label: 'Shell Upper' },
  { id: 'flag', label: 'Flag' },
  { id: 'wave', label: 'Wave' },
  { id: 'fish', label: 'Fish' },
  { id: 'rise', label: 'Rise' },
  { id: 'fisheye', label: 'Fisheye' },
  { id: 'inflate', label: 'Inflate' },
  { id: 'squeeze', label: 'Squeeze' },
  { id: 'twist', label: 'Twist' },
]);

export const WARP_DEFAULTS = Object.freeze({ style: 'arc', bend: 0.5, vertical: false, distortH: 0, distortV: 0 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Style functions in the box's own frame: s runs along the bend axis
 * (-A..A), t across it (-B..B, negative is the "top" side), b is the bend.
 * Each returns [s', t'].
 */
const STYLES = {
  arc(s, t, A, B, b) {
    // The center line becomes a circular arc of the same length spanning b * 180 degrees.
    const theta = b * Math.PI;
    if (Math.abs(theta) < 1e-6) return [s, t];
    const R = (2 * A) / theta;
    const phi = s / R;
    const r = R - t;
    return [r * Math.sin(phi), R - r * Math.cos(phi)];
  },
  arcLower(s, t, A, B, b) {
    const u = s / A;
    return [s, t + b * 2 * B * (1 - u * u) * ((t / B + 1) / 2)];
  },
  arcUpper(s, t, A, B, b) {
    const u = s / A;
    return [s, t - b * 2 * B * (1 - u * u) * ((1 - t / B) / 2)];
  },
  arch(s, t, A, B, b) {
    const u = s / A;
    return [s, t - b * 1.5 * B * (1 - u * u)];
  },
  bulge(s, t, A, B, b) {
    const u = s / A;
    return [s, t + b * B * (1 - u * u) * (t / B)];
  },
  shellLower(s, t, A, B, b) {
    // The top edge stays; the height grows in the middle and shrinks at the ends.
    const u = s / A;
    const k = Math.max(0.02, 1 + b * (1 - 2 * u * u));
    return [s, -B + (t + B) * k];
  },
  shellUpper(s, t, A, B, b) {
    const u = s / A;
    const k = Math.max(0.02, 1 + b * (1 - 2 * u * u));
    return [s, B - (B - t) * k];
  },
  flag(s, t, A, B, b) {
    const u = s / A;
    return [s, t + b * B * Math.sin(Math.PI * u)];
  },
  wave(s, t, A, B, b) {
    // Two full waves along the length; the band thins at the crests and swells between them.
    const u = s / A;
    return [s, 0.7 * b * B * Math.sin(2 * Math.PI * u) + t * (1 - 0.4 * b * Math.cos(2 * Math.PI * u))];
  },
  fish(s, t, A, B, b) {
    // Full body toward the front, pinched tail at the far end.
    const u = s / A;
    const k = Math.max(0.02, 1 + b * Math.sin(Math.PI * 0.75 * (u + 1)));
    return [s, t * k];
  },
  rise(s, t, A, B, b) {
    const u = s / A;
    return [s, t - b * B * Math.sin((Math.PI / 2) * u) * (1 + 0.25 * (t / B))];
  },
  fisheye(s, t, A, B, b) {
    // Magnify (or shrink) the middle of the inscribed ellipse; the rim stays put.
    const u = s / A;
    const w = t / B;
    const rho = Math.hypot(u, w);
    if (rho >= 1) return [s, t];
    const f = 1 + b * (1 - rho) * (1 - rho);
    return [s * f, t * f];
  },
  inflate(s, t, A, B, b) {
    const u = s / A;
    const w = t / B;
    return [s * (1 + 0.45 * b * (1 - u * u) * (1 - w * w)), t * (1 + 0.45 * b * (1 - w * w) * (1 - u * u))];
  },
  squeeze(s, t, A, B, b) {
    // Pinch the sides in at mid-height and stretch the middle across.
    const u = s / A;
    const w = t / B;
    return [s * (1 - 0.4 * b * (1 - w * w)), t * (1 + 0.4 * b * (1 - u * u))];
  },
  twist(s, t, A, B, b) {
    // Turn the middle most, fading to nothing at the rim of the inscribed ellipse.
    const u = s / A;
    const w = t / B;
    const rho2 = u * u + w * w;
    if (rho2 >= 1) return [s, t];
    const phi = b * (Math.PI / 2) * (1 - rho2) * (1 - rho2) * 2;
    const c = Math.cos(phi);
    const sn = Math.sin(phi);
    return [(u * c - w * sn) * A, (u * sn + w * c) * B];
  },
};

export function isWarpStyle(style) {
  return Object.hasOwn(STYLES, style);
}

/** Normalized warp parameters (unknown style -> Arc, values clamped). */
export function normalizeWarp(p = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) ? clamp(Number(v), -1, 1) : d);
  return {
    style: isWarpStyle(p.style) ? p.style : 'arc',
    bend: num(p.bend, 0.5),
    vertical: Boolean(p.vertical),
    distortH: num(p.distortH, 0),
    distortV: num(p.distortV, 0),
  };
}

/**
 * The point function of a warp over `bounds` ({ x, y, w, h }). Degenerate
 * boxes (zero width or height) are widened so lines still bend sensibly.
 */
export function warpMapping(style, params, bounds) {
  const p = normalizeWarp({ ...params, style });
  const fn = STYLES[p.style];
  const W = Math.max(bounds.w, 1e-6);
  const H = Math.max(bounds.h, 1e-6);
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  // A flat box bends as if it were a little taller.
  const hw = Math.max(W, H * 0.01) / 2;
  const hh = Math.max(H, W * 0.01) / 2;
  const { bend, vertical, distortH, distortV } = p;
  return (x, y) => {
    let dx = x - cx;
    let dy = y - cy;
    if (distortH || distortV) {
      const nx = dx / hw;
      const ny = dy / hh;
      dy *= Math.max(0.01, 1 + distortH * nx);
      dx *= Math.max(0.01, 1 + distortV * ny);
    }
    if (!bend) return { x: cx + dx, y: cy + dy };
    if (vertical) {
      const [s, t] = fn(dy, dx, hh, hw, bend);
      return { x: cx + t, y: cy + s };
    }
    const [s, t] = fn(dx, dy, hw, hh, bend);
    return { x: cx + s, y: cy + t };
  };
}

/** Warp subpaths [{ anchors, closed }] over `bounds`, keeping curves smooth. */
export function warpSubpaths(subpaths, style, params, bounds, { tolerance } = {}) {
  const p = normalizeWarp({ ...params, style });
  if (!p.bend && !p.distortH && !p.distortV) return subpaths;
  const tol = tolerance ?? Math.max(0.02, Math.min(0.25, Math.hypot(bounds.w, bounds.h) * 0.0005));
  return mapSubpaths(subpaths, warpMapping(p.style, p, bounds), { tolerance: tol });
}
