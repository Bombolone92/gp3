export type Vec3 = [number, number, number];
// Extract Euler XYZ angles from a pure rotation matrix (Rz * Ry * Rx).
export function rotationFromMatrix(m: Float32Array): Vec3 {
  const y = Math.asin(Math.max(-1, Math.min(1, -m[2])));
  const regular = Math.abs(Math.cos(y)) > 1e-6;
  return [
    regular ? Math.atan2(m[6], m[10]) : Math.atan2(-m[9], m[5]),
    y,
    regular ? Math.atan2(m[1], m[0]) : 0,
  ].map((v) => (v * 180) / Math.PI) as Vec3;
}
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (v: Vec3) => Math.hypot(...v);
export const normalize = (v: Vec3): Vec3 => mul(v, 1 / (length(v) || 1));
export const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function multiply(a: Float32Array, b: Float32Array) {
  const r = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) r[c * 4 + row] += a[k * 4 + row] * b[c * 4 + k];
  return r;
}
export function point(m: Float32Array, v: Vec3, w = 1): Vec3 {
  const d = w ? m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] : 1;
  return [
    (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * w) / d,
    (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * w) / d,
    (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * w) / d,
  ];
}
export function transpose(m: Float32Array) {
  const r = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) r[i * 4 + j] = m[j * 4 + i];
  return r;
}
export function inverse(m: Float32Array) {
  const a = Array.from({ length: 4 }, (_, r) => [
    ...Array.from({ length: 4 }, (_, c) => m[c * 4 + r]),
    ...Array.from({ length: 4 }, (_, c) => (r === c ? 1 : 0)),
  ]);
  for (let i = 0; i < 4; i++) {
    let best = i;
    for (let j = i + 1; j < 4; j++) if (Math.abs(a[j][i]) > Math.abs(a[best][i])) best = j;
    [a[i], a[best]] = [a[best], a[i]];
    const d = a[i][i];
    if (Math.abs(d) < 1e-12) throw new Error('Singular transform');
    for (let k = 0; k < 8; k++) a[i][k] /= d;
    for (let j = 0; j < 4; j++)
      if (j !== i) {
        const f = a[j][i];
        for (let k = 0; k < 8; k++) a[j][k] -= f * a[i][k];
      }
  }
  return new Float32Array(Array.from({ length: 16 }, (_, i) => a[i % 4][4 + Math.floor(i / 4)]));
}
export function modelMatrix(position: Vec3, rotation: Vec3, scale: Vec3) {
  const [x, y, z] = rotation.map((n) => (n * Math.PI) / 180);
  const cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  const rx = new Float32Array([1, 0, 0, 0, 0, cx, sx, 0, 0, -sx, cx, 0, 0, 0, 0, 1]);
  const ry = new Float32Array([cy, 0, -sy, 0, 0, 1, 0, 0, sy, 0, cy, 0, 0, 0, 0, 1]);
  const rz = new Float32Array([cz, sz, 0, 0, -sz, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const s = identity();
  scale.forEach((n, i) => (s[i * 5] = n));
  const r = multiply(multiply(multiply(rz, ry), rx), s);
  r.set(position, 12);
  return r;
}
export function perspective(aspect: number, near = 0.05, far = 2000, fov = Math.PI / 4) {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    far / (near - far),
    -1,
    0,
    0,
    (near * far) / (near - far),
    0,
  ]);
}
export function lookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]) {
  const z = normalize(sub(eye, target)),
    x = normalize(cross(up, z)),
    y = cross(z, x);
  return new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ]);
}
export function rayTriangle(origin: Vec3, dir: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null {
  const e1 = sub(b, a),
    e2 = sub(c, a),
    h = cross(dir, e2),
    det = dot(e1, h);
  if (Math.abs(det) < 1e-7) return null;
  const s = sub(origin, a),
    u = dot(s, h) / det;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const q = cross(s, e1),
    v = dot(dir, q) / det;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  const t = dot(e2, q) / det;
  return t > 0.0001 ? t : null;
}

export function axisRotation(axis: Vec3, degrees: number) {
  const [x, y, z] = normalize(axis),
    angle = (degrees * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle),
    t = 1 - c;
  return new Float32Array([
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    0,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    0,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ]);
}
export function around(pivot: Vec3, matrix: Float32Array) {
  const a = identity(),
    b = identity();
  a.set(pivot, 12);
  b.set(mul(pivot, -1), 12);
  return multiply(multiply(a, matrix), b);
}
export function orthographic(halfHeight: number, aspect: number, near: number, far: number) {
  return new Float32Array([
    1 / (halfHeight * aspect),
    0,
    0,
    0,
    0,
    1 / halfHeight,
    0,
    0,
    0,
    0,
    1 / (near - far),
    0,
    0,
    0,
    near / (near - far),
    1,
  ]);
}
