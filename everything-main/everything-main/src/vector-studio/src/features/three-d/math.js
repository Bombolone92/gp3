/**
 * Small 3D math kit for the 3D effects: vectors as [x, y, z] arrays and
 * 3x3 rotation matrices as row-major arrays of nine numbers.
 *
 * Space: x to the right and y down (document axes), z toward the viewer.
 * An object's rotation is R = Rx(x) * Ry(y) * Rz(z): the Z angle spins the
 * artwork in its own plane first, Y turns it about the vertical axis, and
 * X then tilts it toward or away from the viewer. Positive X shows the
 * top, positive Y shows the left side, positive Z turns clockwise on
 * screen.
 */

export const DEG = Math.PI / 180;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export function normalize(a) {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
}

export const IDENTITY3 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export function mul3(a, b) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return out;
}

export function apply3(m, p) {
  return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];
}

export function transpose3(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Rotation about the X axis: positive angles bring the top (negative y) toward the viewer. */
export function rotX(deg) {
  const a = deg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c];
}

/** Rotation about the vertical axis: positive angles bring the left side toward the viewer. */
export function rotY(deg) {
  const a = deg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

/** Rotation in the artwork's plane: positive angles turn clockwise on screen (y down). */
export function rotZ(deg) {
  const a = deg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** The object rotation for X/Y/Z angles in degrees. */
export function rotationMatrix(x = 0, y = 0, z = 0) {
  return mul3(rotX(x), mul3(rotY(y), rotZ(z)));
}

const wrap = (d) => {
  let v = ((d + 180) % 360 + 360) % 360 - 180;
  if (Math.abs(v) < 1e-9) v = 0;
  return v;
};

/** X/Y/Z angles (degrees, -180..180) of a rotation matrix (inverse of rotationMatrix). */
export function eulerFromMatrix(m) {
  // With R = Rx Ry Rz: m[2] = sin y, m[5] = sin x cos y, m[8] = cos x cos y,
  // m[0] = cos y cos z, m[1] = -cos y sin z.
  const sy = Math.max(-1, Math.min(1, m[2]));
  const y = Math.asin(sy);
  let x;
  let z;
  if (Math.abs(Math.cos(y)) > 1e-6) {
    x = Math.atan2(m[5], m[8]);
    z = Math.atan2(-m[1], m[0]);
  } else {
    // Gimbal lock: put all of the in-plane turn on X.
    z = 0;
    x = Math.atan2(-m[7], m[4]);
  }
  return { x: wrap(x / DEG), y: wrap(y / DEG), z: wrap(z / DEG) };
}

/** Rotation by `deg` degrees about a unit axis (right-handed in x-right, y-down, z-toward-viewer space). */
export function axisAngle(axis, deg) {
  const [x, y, z] = normalize(axis);
  const a = deg * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

/**
 * Trackball: the rotation that turns a sphere of radius `r` (screen units,
 * y down) as if its surface were dragged from (x0, y0) to (x1, y1), both
 * relative to the sphere's center.
 */
export function trackballRotation(x0, y0, x1, y1, r) {
  const onSphere = (x, y) => {
    const d = Math.hypot(x, y);
    // Outside the ball the drag rolls about the view axis.
    if (d >= r) return [x / d, y / d, 0];
    return [x / r, y / r, Math.sqrt(Math.max(0, r * r - d * d)) / r];
  };
  const a = onSphere(x0, y0);
  const b = onSphere(x1, y1);
  const axis = cross(a, b);
  const l = length(axis);
  if (l < 1e-9) return [...IDENTITY3];
  const ang = Math.atan2(l, dot(a, b)) / DEG;
  return axisAngle(axis, ang);
}

/** Newell normal of a polygon (unnormalized; its length is twice the area). */
export function newellNormal(pts) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}
