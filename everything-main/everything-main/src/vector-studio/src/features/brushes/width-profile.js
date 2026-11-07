/**
 * Variable stroke widths.
 *
 * A path's width profile is node.widthProfile: width points
 *   [{ t, l, r }]   t: position along the path (0..1 of its length),
 *                   l / r: width on the left / right side as a multiple of
 *                   half the stroke weight (1 = the plain stroke)
 * sorted by t. Two points at the same t make a sudden width change. A
 * missing or uniform profile is a plain stroke. Widths between points
 * follow a smooth monotone curve (no overshoot past the points), so a
 * profile with a single wide point swells and tapers evenly.
 *
 * Because widths are relative, changing the stroke weight scales the
 * whole profile, and the profile follows the path when it is edited.
 */

export const UNIFORM = Object.freeze([Object.freeze({ t: 0, l: 1, r: 1 }), Object.freeze({ t: 1, l: 1, r: 1 })]);

const round = (v) => Math.round(v * 1e5) / 1e5;

/** A clean copy of a profile: clamped, sorted, at least two points spanning 0..1. */
export function normalizeProfile(points) {
  if (!Array.isArray(points) || !points.length) return UNIFORM.map((p) => ({ ...p }));
  let pts = points
    .filter((p) => p && Number.isFinite(p.t))
    .map((p) => ({ t: Math.min(1, Math.max(0, round(p.t))), l: Math.max(0, Number.isFinite(p.l) ? p.l : 1), r: Math.max(0, Number.isFinite(p.r) ? p.r : 1) }));
  pts.sort((a, b) => a.t - b.t);
  if (!pts.length) return UNIFORM.map((p) => ({ ...p }));
  if (pts[0].t > 0) pts.unshift({ ...pts[0], t: 0 });
  if (pts[pts.length - 1].t < 1) pts.push({ ...pts[pts.length - 1], t: 1 });
  // At most two points share a position (a step).
  pts = pts.filter((p, i) => !(i > 1 && pts[i - 2].t === p.t && pts[i - 1].t === p.t));
  return pts;
}

export function isUniformProfile(points) {
  if (!Array.isArray(points) || !points.length) return true;
  return points.every((p) => Math.abs(p.l - 1) < 1e-6 && Math.abs(p.r - 1) < 1e-6);
}

/** Monotone cubic (Fritsch-Carlson) slopes for one side. */
function slopes(ts, vs) {
  const n = ts.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      m[i] = (3 * a * d[i]) / h;
      m[i + 1] = (3 * b * d[i]) / h;
    }
  }
  return m;
}

const cache = new WeakMap();

/**
 * A width function for a profile: at(t) -> { l, r } (relative widths).
 * Steps (two points at one t) are split into independent smooth pieces.
 */
export function profileFunction(points) {
  if (isUniformProfile(points)) return () => ({ l: 1, r: 1 });
  let fn = cache.get(points);
  if (fn) return fn;
  const pts = normalizeProfile(points);
  // Pieces between steps.
  const pieces = [];
  let cur = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t - pts[i - 1].t < 1e-9) {
      pieces.push(cur);
      cur = [pts[i]];
    } else cur.push(pts[i]);
  }
  pieces.push(cur);
  const fitted = pieces.map((pc) => {
    if (pc.length === 1) return { t0: pc[0].t, t1: pc[0].t, pts: pc };
    const ts = pc.map((p) => p.t);
    return { t0: ts[0], t1: ts[ts.length - 1], pts: pc, ts, ml: slopes(ts, pc.map((p) => p.l)), mr: slopes(ts, pc.map((p) => p.r)) };
  });
  const evalSide = (f, key, mkey, t) => {
    const { ts, pts: pc } = f;
    let i = 0;
    while (i < ts.length - 2 && t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const u = Math.min(1, Math.max(0, (t - ts[i]) / h));
    const u2 = u * u;
    const u3 = u2 * u;
    const m = f[mkey];
    const v = (2 * u3 - 3 * u2 + 1) * pc[i][key] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * pc[i + 1][key] + (u3 - u2) * h * m[i + 1];
    return Math.max(0, v);
  };
  fn = (t) => {
    let f = fitted[fitted.length - 1];
    for (const p of fitted) {
      if (t <= p.t1 + 1e-12) {
        f = p;
        break;
      }
    }
    if (!f.ts) return { l: f.pts[0].l, r: f.pts[0].r };
    return { l: evalSide(f, 'l', 'ml', t), r: evalSide(f, 'r', 'mr', t) };
  };
  cache.set(points, fn);
  return fn;
}

/** The widest relative width anywhere in a profile. */
export function profileMax(points) {
  if (isUniformProfile(points)) return 1;
  const fn = profileFunction(points);
  let m = 0;
  for (let i = 0; i <= 64; i++) {
    const w = fn(i / 64);
    m = Math.max(m, w.l, w.r);
  }
  for (const p of points) m = Math.max(m, p.l, p.r);
  return m;
}

/** Profile reversed along the path. */
export function flipAlong(points) {
  return normalizeProfile(points.map((p) => ({ t: 1 - p.t, l: p.l, r: p.r })).reverse());
}

/** Profile mirrored across the path (sides swapped). */
export function flipAcross(points) {
  return points.map((p) => ({ t: p.t, l: p.r, r: p.l }));
}

/** Insert a width point at t with the profile's current width there; returns { profile, index }. */
export function insertWidthPoint(points, t, widths = null) {
  const base = normalizeProfile(points);
  const w = widths || profileFunction(base)(t);
  const pt = { t, l: w.l, r: w.r };
  let i = base.findIndex((p) => p.t > t);
  if (i < 0) i = base.length;
  const out = [...base.slice(0, i), pt, ...base.slice(i)];
  return { profile: out, index: i };
}

/**
 * Original width profile presets (shapes, not sizes: the stroke weight is
 * the widest point). `uniform` is the plain stroke.
 */
export const WIDTH_PROFILES = [
  { id: 'uniform', name: 'Uniform', points: null },
  { id: 'lens', name: 'Lens', points: [{ t: 0, l: 0, r: 0 }, { t: 0.5, l: 1, r: 1 }, { t: 1, l: 0, r: 0 }] },
  { id: 'taper-end', name: 'Taper End', points: [{ t: 0, l: 1, r: 1 }, { t: 1, l: 0, r: 0 }] },
  { id: 'taper-start', name: 'Taper Start', points: [{ t: 0, l: 0, r: 0 }, { t: 1, l: 1, r: 1 }] },
  { id: 'waist', name: 'Waist', points: [{ t: 0, l: 1, r: 1 }, { t: 0.5, l: 0.25, r: 0.25 }, { t: 1, l: 1, r: 1 }] },
  { id: 'teardrop', name: 'Teardrop', points: [{ t: 0, l: 0.1, r: 0.1 }, { t: 0.28, l: 1, r: 1 }, { t: 1, l: 0, r: 0 }] },
  { id: 'brush-swell', name: 'Brush Swell', points: [{ t: 0, l: 0, r: 0 }, { t: 0.15, l: 0.85, r: 0.85 }, { t: 0.6, l: 1, r: 1 }, { t: 1, l: 0, r: 0 }] },
  { id: 'ripple', name: 'Ripple', points: [{ t: 0, l: 0.35, r: 0.35 }, { t: 0.25, l: 1, r: 1 }, { t: 0.5, l: 0.35, r: 0.35 }, { t: 0.75, l: 1, r: 1 }, { t: 1, l: 0.35, r: 0.35 }] },
  { id: 'keel', name: 'Keel', points: [{ t: 0, l: 0, r: 0 }, { t: 0.5, l: 1.6, r: 0.4 }, { t: 1, l: 0, r: 0 }] },
  { id: 'blade', name: 'Blade', points: [{ t: 0, l: 1, r: 0 }, { t: 1, l: 0, r: 0 }] },
];

/** Whether two profiles have the same width points. */
export function sameProfile(a, b) {
  const ua = isUniformProfile(a);
  const ub = isUniformProfile(b);
  if (ua || ub) return ua === ub;
  if (a.length !== b.length) return false;
  return a.every((p, i) => Math.abs(p.t - b[i].t) < 1e-4 && Math.abs(p.l - b[i].l) < 1e-4 && Math.abs(p.r - b[i].r) < 1e-4);
}
