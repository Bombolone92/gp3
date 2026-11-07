import { intersectExtrusion } from './drawing-3d-geometry.js';

// Signed Euclidean distance to a centered rectangle/ellipse. Negative is inside.
// The ellipse projection follows the Lagrange multiplier of its quadratic
// constraint; safeguarded Newton iteration keeps the nearest-point root bracketed.
export function outlineDistance(x, y, width, height, geometry) {
  if (geometry === 'rect') {
    const dx = Math.abs(x) - width / 2, dy = Math.abs(y) - height / 2;
    const ox = Math.max(0, dx), oy = Math.max(0, dy), length = Math.hypot(ox, oy);
    return { distance: length + Math.min(Math.max(dx, dy), 0), normal: length ? [Math.sign(x) * ox / length, Math.sign(y) * oy / length] : dx > dy ? [Math.sign(x) || 1, 0] : [0, Math.sign(y) || 1] };
  }
  const swap = height > width;
  const a = Math.max(width, height) / 2, b = Math.min(width, height) / 2;
  const u = Math.abs(swap ? y : x), v = Math.abs(swap ? x : y);
  let qx, qy;
  if (a === b) {
    const length = Math.hypot(x, y);
    return { distance: length - a, normal: length ? [x / length, y / length] : [1, 0] };
  }
  if (v === 0) {
    qx = Math.min(a, a * a * u / (a * a - b * b)); qy = b * Math.sqrt(Math.max(0, 1 - (qx / a) ** 2));
  } else {
    const inside = (u / a) ** 2 + (v / b) ** 2 < 1;
    let lo = inside ? -b * b : 0, hi = inside ? 0 : Math.hypot(a * u, b * v), t = (lo + hi) / 2;
    for (let i = 0; i < 64; i++) {
      const ax = a * u / (t + a * a), by = b * v / (t + b * b), f = ax * ax + by * by - 1;
      if (Math.abs(f) < 1e-12) break;
      if (f > 0) lo = t; else hi = t;
      const derivative = -2 * (ax * ax / (t + a * a) + by * by / (t + b * b));
      const next = t - f / derivative;
      t = next > lo && next < hi ? next : (lo + hi) / 2;
    }
    qx = a * a * u / (t + a * a); qy = b * b * v / (t + b * b);
  }
  const distance = Math.hypot(qx - u, qy - v) * ((u / a) ** 2 + (v / b) ** 2 < 1 ? -1 : 1);
  const length = Math.hypot(qx / (a * a), qy / (b * b));
  const normal = [qx / (a * a) / length, qy / (b * b) / length];
  if (swap) normal.reverse();
  return { distance, normal: [normal[0] * (Math.sign(x) || 1), normal[1] * (Math.sign(y) || 1)] };
}

export function outlineBoundary(width, height, geometry, radius, segments) {
  if (geometry === 'ellipse') return Array.from({ length: segments }, (_, i) => {
    const angle = i * 2 * Math.PI / segments, x = width / 2 * Math.cos(angle), y = height / 2 * Math.sin(angle);
    const nx = x / (width * width), ny = y / (height * height), length = Math.hypot(nx, ny);
    return [x + radius * nx / length, y + radius * ny / length];
  });
  if (!radius) return [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
  const points = [], steps = Math.max(4, Math.ceil(segments / 4));
  for (const [cx, cy, start] of [[width / 2, height / 2, 0], [-width / 2, height / 2, Math.PI / 2], [-width / 2, -height / 2, Math.PI], [width / 2, -height / 2, 3 * Math.PI / 2]]) for (let i = 0; i <= steps; i++) {
    const angle = start + i / steps * Math.PI / 2;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

export function intersectOffsetExtrusion(ray, shape, radius) {
  if (!radius) return intersectExtrusion(ray, shape);
  const { width, height, depth, geometry } = shape;
  if (geometry === 'rect') {
    // A rounded rectangle is the union of two strips and four corner discs.
    // Rays originate outside the solid, so the first union hit is its boundary.
    const solids = [[0, 0, width + 2 * radius, height, 'rect'], [0, 0, width, height + 2 * radius, 'rect']];
    for (const x of [-width / 2, width / 2]) for (const y of [-height / 2, height / 2]) solids.push([x, y, radius * 2, radius * 2, 'ellipse']);
    let best = null;
    for (const [x, y, w, h, g] of solids) {
      const hit = intersectExtrusion({ origin: [ray.origin[0] - x, ray.origin[1] - y, ray.origin[2]], direction: ray.direction }, { width: w, height: h, depth, geometry: g });
      if (hit && (!best || hit.t < best.t)) best = { ...hit, point: [hit.point[0] + x, hit.point[1] + y, hit.point[2]] };
    }
    return best;
  }
  if (width === height) return intersectExtrusion(ray, { ...shape, width: width + 2 * radius, height: height + 2 * radius });
  const [ox, oy, oz] = ray.origin, [dx, dy, dz] = ray.direction;
  let best = null;
  const add = (t, normal, surface) => {
    if (t < 0 || !Number.isFinite(t) || best && best.t <= t) return;
    best = { t, normal, surface, point: [ox + t * dx, oy + t * dy, oz + t * dz] };
  };
  for (const [z, normal, surface] of [[0, [0, 0, 1], 'front'], [-depth, [0, 0, -1], 'back']]) if (dz) {
    const t = (z - oz) / dz;
    if (outlineDistance(ox + t * dx, oy + t * dy, width, height, geometry).distance <= radius) add(t, normal, surface);
  }
  if (!depth || !(dx || dy) || best?.surface === 'front' && oz >= 0 && dz < 0) return best;
  const a = width / 2, b = height / 2, length = Math.hypot(dx, dy), nx = -dy / length, ny = dx / length;
  const offset = ox * nx + oy * ny, support = Math.hypot(a * nx, b * ny);
  if (Math.abs(offset) > support + radius) return best;
  let center;
  if (Math.abs(offset) <= support) center = -(ox * dx / (a * a) + oy * dy / (b * b)) / ((dx / a) ** 2 + (dy / b) ** 2);
  else {
    const sign = Math.sign(offset), qx = sign * a * a * nx / support, qy = sign * b * b * ny / support;
    center = ((qx - ox) * dx + (qy - oy) * dy) / (length * length);
  }
  let lo = -Infinity, hi = Infinity;
  for (const [o, d, extent] of [[ox, dx, a + radius], [oy, dy, b + radius]]) {
    if (!d) { if (Math.abs(o) > extent) return best; continue; }
    const t0 = (-extent - o) / d, t1 = (extent - o) / d;
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
  }
  if (lo > hi) return best;
  if (Math.max(oz + lo * dz, oz + hi * dz) < -depth || Math.min(oz + lo * dz, oz + hi * dz) > 0) return best;
  for (const end of [lo, hi]) {
    let outside = end, inside = center;
    for (let i = 0; i < 48 && Math.abs(outside - inside) * length > 1e-7; i++) {
      const t = (outside + inside) / 2;
      if (outlineDistance(ox + t * dx, oy + t * dy, width, height, geometry).distance > radius) outside = t; else inside = t;
    }
    const t = (inside + outside) / 2, z = oz + t * dz;
    if (z < -depth - 1e-8 || z > 1e-8) continue;
    const { normal } = outlineDistance(ox + t * dx, oy + t * dy, width, height, geometry);
    add(t, [...normal, 0], 'side');
  }
  return best;
}
