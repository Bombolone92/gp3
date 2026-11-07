/**
 * 2D affine matrices as plain arrays [a, b, c, d, e, f], the same layout as
 * CanvasRenderingContext2D.setTransform and SVG matrix():
 *   x' = a*x + c*y + e
 *   y' = b*x + d*y + f
 */

export const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

export function identity() {
  return [1, 0, 0, 1, 0, 0];
}

/** m1 * m2: apply m2 first, then m1. */
export function multiply(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) return identity();
  const id = 1 / det;
  return [d * id, -b * id, -c * id, a * id, (c * f - d * e) * id, (b * e - a * f) * id];
}

export function translate(tx, ty) {
  return [1, 0, 0, 1, tx, ty];
}

export function scale(sx, sy = sx, ox = 0, oy = 0) {
  return [sx, 0, 0, sy, ox - sx * ox, oy - sy * oy];
}

/** Rotation by `deg` degrees (clockwise on screen, since y points down) about (ox, oy). */
export function rotate(deg, ox = 0, oy = 0) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, ox - cos * ox + sin * oy, oy - sin * ox - cos * oy];
}

/** Horizontal shear: x' = x + tan(angle) * (y - oy). */
export function shear(degX, degY = 0, ox = 0, oy = 0) {
  const tx = Math.tan((degX * Math.PI) / 180);
  const ty = Math.tan((degY * Math.PI) / 180);
  return [1, ty, tx, 1, -tx * oy, -ty * ox];
}

export function apply(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Transform a direction vector (no translation). */
export function applyVector(m, x, y) {
  return { x: m[0] * x + m[2] * y, y: m[1] * x + m[3] * y };
}

export function isIdentity(m) {
  return !m || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0);
}

/** Uniform scale factor of a matrix (geometric mean of the axis scales). */
export function scaleFactor(m) {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** Rotation angle of the x axis in degrees. */
export function rotation(m) {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}

/** Decompose into translate, rotate, scale and skew (as used by the Transform panel). */
export function decompose(m) {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  const rot = Math.atan2(b, a);
  const det = a * d - b * c;
  const sy = sx ? det / sx : 0;
  const skew = sx ? Math.atan2(a * c + b * d, sx * sx) : 0;
  return { tx: e, ty: f, rotation: (rot * 180) / Math.PI, sx, sy, skew: (skew * 180) / Math.PI };
}

export function equals(m1, m2, eps = 1e-9) {
  for (let i = 0; i < 6; i++) if (Math.abs(m1[i] - m2[i]) > eps) return false;
  return true;
}
