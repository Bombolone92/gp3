import { intersectExtrusion } from './drawing-3d-geometry.js';
import { outlineDistance } from './drawing-outline-geometry.js';

// MS-OI29500 2.1.1316 supplies this original specification curve. In the
// bevel mesh its first coordinate moves inward and its second raises the face.
// Native controls distinguish this from the reversed axes in the prose.
export function bevelProfile({ width, height, preset = 'circle' }) {
  if (![width, height].every(v => Number.isFinite(v) && v >= 0) || !['circle', 'angle'].includes(preset)) throw new Error('Invalid bevel profile.');
  const knots = [0];
  if (preset === 'circle' && width && height) {
    const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const flatten = (p, t0, t1, depth) => {
      const dx = p[3][0] - p[0][0], dy = p[3][1] - p[0][1], length = Math.hypot(dx, dy);
      const deviation = Math.max(...p.slice(1, 3).map(q => Math.abs(dx * (q[1] - p[0][1]) - dy * (q[0] - p[0][0])) / length));
      // A quarter CSS pixel in physical points. Keep the same size-dependent
      // profile for geometry and vertex illumination; finer shading alone
      // creates highlights absent from the native small-bevel controls.
      if (deviation <= .1875 || depth === 8) { knots.push(t1); return; }
      const a = midpoint(p[0], p[1]), b = midpoint(p[1], p[2]), c = midpoint(p[2], p[3]);
      const d = midpoint(a, b), e = midpoint(b, c), f = midpoint(d, e), mid = (t0 + t1) / 2;
      flatten([p[0], a, d, f], t0, mid, depth + 1); flatten([f, e, c, p[3]], mid, t1, depth + 1);
    };
    flatten([[0, 0], [0, .55627 * height], [.44373 * width, height], [width, height]], 0, 1, 0);
  } else knots.push(1);
  return knots.map(t => {
    const u = 1 - t;
    const x = preset === 'circle' ? 3 * u * t * t * .44373 + t ** 3 : t;
    const y = preset === 'circle' ? 3 * u * u * t * .55627 + 3 * u * t * t + t ** 3 : t;
    const dx = preset === 'circle' ? 6 * .44373 * t + (3 - 9 * .44373) * t * t : 1;
    const dy = preset === 'circle' ? 3 * .55627 + (6 - 12 * .55627) * t + 3 * (3 * .55627 - 2) * t * t : 1;
    const length = Math.hypot(height * dy, width * dx);
    return { inset: width * x, z: height * y, normal: length ? [height * dy / length, width * dx / length] : [0, 1] };
  });
}

// Rays come from the supported cameras, with origins outside the solid.
export function prepareBevel(shape, bevel) {
  const { width, height, geometry = 'rect' } = shape;
  if (![width, height].every(v => Number.isFinite(v) && v > 0) || !['rect', 'ellipse'].includes(geometry)) throw new Error('Invalid beveled shape.');
  const profile = bevelProfile(bevel);
  const active = bevel.height > 0;
  const band = inset => {
    if (inset >= bevel.width) return { z: bevel.height, normals: [[0, 1], [0, 1]], mix: 0 };
    const i = Math.max(1, profile.findIndex(p => p.inset >= inset));
    const a = profile[i - 1], b = profile[i], mix = Math.max(0, (inset - a.inset) / (b.inset - a.inset));
    return { z: a.z + mix * (b.z - a.z), normals: [a.normal, b.normal], mix };
  };
  const planes = [];
  if (geometry === 'rect' && bevel.width) for (const axis of [0, 1]) for (const sign of [-1, 1]) for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i], slope = (b.z - a.z) / (b.inset - a.inset);
    const extent = (axis ? height : width) / 2;
    const normals = [a, b].map(p => axis ? [0, sign * p.normal[0], p.normal[1]] : [sign * p.normal[0], 0, p.normal[1]]);
    planes.push({ axis, sign, a, b, slope, extent, limit: (axis ? width : height) / 2, constant: a.z + slope * (extent - a.inset), normals });
  }
  return ray => {
    const base = intersectExtrusion(ray, shape);
    if (!active) return base;
    const { origin: o, direction: v } = ray;
    const at = t => o.map((x, i) => x + t * v[i]);
    const distance = p => outlineDistance(p[0], p[1], width, height, geometry);
    if (!bevel.width) {
      const cap = intersectExtrusion({ origin: [o[0], o[1], o[2] - bevel.height], direction: v }, { ...shape, depth: bevel.height });
      return cap && (!base || cap.t < base.t) ? { ...cap, point: [cap.point[0], cap.point[1], cap.point[2] + bevel.height], surface: 'front' } : base;
    }
    if (geometry === 'rect') {
      let best = base;
      if (v[2]) {
        const t = (bevel.height - o[2]) / v[2], p = at(t);
        if (t >= 0 && (!best || t < best.t) && Math.abs(p[0]) <= width / 2 - bevel.width && Math.abs(p[1]) <= height / 2 - bevel.width) {
          best = { t, point: p, normal: [0, 0, 1], surface: 'front' };
          // No point on the cap is above this plane. An incoming camera ray
          // that hits the flat interior cannot hit a bevel strip first.
          if (o[2] >= bevel.height && v[2] < 0) return best;
        }
      }
      for (const plane of planes) {
        const denominator = v[2] + plane.slope * plane.sign * v[plane.axis];
        if (!denominator) continue;
        const t = (plane.constant - o[2] - plane.slope * plane.sign * o[plane.axis]) / denominator;
        if (t < 0 || best && t >= best.t) continue;
        const p = at(t), inset = plane.extent - plane.sign * p[plane.axis];
        if (inset < plane.a.inset - 1e-8 || inset > plane.b.inset + 1e-8 || Math.abs(p[1 - plane.axis]) > plane.limit - inset + 1e-8) continue;
        best = { t, point: p, surface: 'front', normal: plane.normals[0], bevel: { normals: plane.normals, mix: Math.max(0, Math.min(1, (inset - plane.a.inset) / (plane.b.inset - plane.a.inset))) } };
      }
      return best;
    }
    if (!v[0] && !v[1] && v[2] < 0) {
      const d = distance(o);
      if (d.distance > 0) return base;
      const section = band(-d.distance), t = (section.z - o[2]) / v[2];
      const normals = section.normals.map(([out, z]) => [out * d.normal[0], out * d.normal[1], z]);
      return t >= 0 && (!base || t < base.t) ? { t, point: at(t), surface: 'front', normal: normals[0], bevel: { normals, mix: section.mix } } : base;
    }
    const prism = intersectExtrusion({ origin: [o[0], o[1], o[2] - bevel.height], direction: v }, { ...shape, depth: bevel.height });
    if (!prism) return base;
    // Intersect a containing prism before considering the curved cap.
    let lo = Math.max(0, prism.t), hi = base?.t ?? Infinity;
    for (const [axis, lower, upper] of [[0, -width / 2, width / 2], [1, -height / 2, height / 2], [2, 0, bevel.height]]) {
      if (!v[axis]) { if (o[axis] < lower || o[axis] > upper) return base; continue; }
      const a = (lower - o[axis]) / v[axis], b = (upper - o[axis]) / v[axis];
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    }
    if (lo > hi || !Number.isFinite(hi)) return base;
    const gap = t => {
      const p = at(t), d = distance(p).distance;
      return Math.max(d, p[2] - band(Math.max(0, -d)).z);
    };
    if (gap(lo) > 1e-9) {
      if (gap(hi) > 1e-9) {
        // The cap is convex. A grazing ray can enter and leave between both
        // prism endpoints, so find the bracket's minimum before bisecting.
        let a = lo, b = hi;
        for (let i = 0; i < 28; i++) {
          const p = (2 * a + b) / 3, q = (a + 2 * b) / 3;
          if (gap(p) < gap(q)) b = q; else a = p;
        }
        hi = (a + b) / 2;
        if (gap(hi) > 1e-9) return base;
      }
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (gap(mid) > 0) lo = mid; else hi = mid;
      }
      lo = hi;
    }
    if (base && lo >= base.t) return base;
    const point = at(lo), d = distance(point), section = band(Math.max(0, -d.distance));
    const normals = section.normals.map(([out, z]) => [out * d.normal[0], out * d.normal[1], z]);
    return { t: lo, point, surface: 'front', normal: normals[0], bevel: { normals, mix: section.mix } };
  };
}
