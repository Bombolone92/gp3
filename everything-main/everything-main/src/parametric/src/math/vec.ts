// Small, allocation-light vector and matrix helpers. Matrices are column-major
// Float32Array/Float64Array (WebGL convention). Vectors are plain tuples so they
// serialize directly into documents and worker messages.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Mat4 = Float64Array;

export const EPS = 1e-9;

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l < EPS ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];

/** Any unit vector perpendicular to n. */
export function perpendicular(n: Vec3): Vec3 {
  const a: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(n, a));
}

// 2D helpers
export const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale2 = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot2 = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const len2 = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function norm2(a: Vec2): Vec2 {
  const l = len2(a);
  return l < EPS ? [0, 0] : [a[0] / l, a[1] / l];
}
export const angle2 = (a: Vec2): number => Math.atan2(a[1], a[0]);

/** Normalizes an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a <= 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** Normalizes an angle to [0, 2PI). */
export function wrap2Pi(a: number): number {
  a %= 2 * Math.PI;
  return a < 0 ? a + 2 * Math.PI : a;
}

// ---- Quaternions (x, y, z, w) ----

export const qIdentity = (): Quat => [0, 0, 0, 1];

export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qAxisAngle(axis: Vec3, angle: number): Quat {
  const n = normalize(axis);
  const s = Math.sin(angle / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
}

export function qNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function qRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  let k0: number, k1: number;
  if (1 - cos > 1e-6) {
    const omega = Math.acos(Math.min(1, cos));
    const so = Math.sin(omega);
    k0 = Math.sin((1 - t) * omega) / so;
    k1 = Math.sin(t * omega) / so;
  } else {
    k0 = 1 - t;
    k1 = t;
  }
  return qNormalize([a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1]);
}

/** Quaternion rotating the camera basis so its local axes map to (right, up, back). */
export function qFromBasis(right: Vec3, up: Vec3, back: Vec3): Quat {
  const m00 = right[0], m01 = up[0], m02 = back[0];
  const m10 = right[1], m11 = up[1], m12 = back[1];
  const m20 = right[2], m21 = up[2], m22 = back[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qNormalize(q);
}

// ---- 4x4 matrices ----

export function mat4(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mul4(a: Mat4, b: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export function invert4(m: Mat4, out: Mat4 = new Float64Array(16)): Mat4 | null {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

export function transformDir(m: Mat4, d: Vec3): Vec3 {
  return [
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
  ];
}

/** Rigid transform from a rotation (quaternion) and translation. */
export function fromRotationTranslation(q: Quat, t: Vec3, out: Mat4 = new Float64Array(16)): Mat4 {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = 1 - (yy + zz); out[1] = xy + wz; out[2] = xz - wy; out[3] = 0;
  out[4] = xy - wz; out[5] = 1 - (xx + zz); out[6] = yz + wx; out[7] = 0;
  out[8] = xz + wy; out[9] = yz - wx; out[10] = 1 - (xx + yy); out[11] = 0;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
}

export function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  const m = new Float64Array(16);
  m[0] = 2 / (r - l);
  m[5] = 2 / (t - b);
  m[10] = -2 / (f - n);
  m[12] = -(r + l) / (r - l);
  m[13] = -(t + b) / (t - b);
  m[14] = -(f + n) / (f - n);
  m[15] = 1;
  return m;
}

export const toF32 = (m: Mat4, out = new Float32Array(16)): Float32Array => {
  for (let i = 0; i < 16; i++) out[i] = m[i];
  return out;
};

// ---- Plane frames ----

/** A right-handed frame: origin, x axis, y axis, normal (z). */
export interface Frame {
  o: Vec3;
  x: Vec3;
  y: Vec3;
  n: Vec3;
}

export function frameFrom(o: Vec3, x: Vec3, n: Vec3): Frame {
  const nn = normalize(n);
  let xx = sub(x, scale(nn, dot(x, nn)));
  xx = len(xx) < EPS ? perpendicular(nn) : normalize(xx);
  return { o, x: xx, y: cross(nn, xx), n: nn };
}

export const toWorld = (f: Frame, p: Vec2): Vec3 => [
  f.o[0] + f.x[0] * p[0] + f.y[0] * p[1],
  f.o[1] + f.x[1] * p[0] + f.y[1] * p[1],
  f.o[2] + f.x[2] * p[0] + f.y[2] * p[1],
];

export function toLocal(f: Frame, p: Vec3): Vec2 {
  const d = sub(p, f.o);
  return [dot(d, f.x), dot(d, f.y)];
}

/** Intersects a ray with a frame's plane; returns the local 2D point or null. */
export function rayPlane(f: Frame, origin: Vec3, dir: Vec3): Vec2 | null {
  const denom = dot(dir, f.n);
  if (Math.abs(denom) < 1e-12) return null;
  const t = dot(sub(f.o, origin), f.n) / denom;
  return toLocal(f, add(origin, scale(dir, t)));
}

export function rayPlaneT(f: Frame, origin: Vec3, dir: Vec3): number | null {
  const denom = dot(dir, f.n);
  if (Math.abs(denom) < 1e-12) return null;
  return dot(sub(f.o, origin), f.n) / denom;
}
