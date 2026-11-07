// Eraser kernels (screen space circle): Point (hard) cuts strokes exactly where they cross the
// eraser circle, Stroke removes every stroke the circle touches, Dissolve (soft) fades point
// opacity and removes points that become invisible, splitting strokes there. Pure functions.
import type { GPPoint, GPStroke } from './data';

export type ScreenFn = (p: GPPoint) => [number, number];

function lerpPoint(a: GPPoint, b: GPPoint, t: number): GPPoint {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    co: [l(a.co[0], b.co[0]), l(a.co[1], b.co[1]), l(a.co[2], b.co[2])],
    radius: l(a.radius, b.radius),
    opacity: l(a.opacity, b.opacity),
    vertex_color: [l(a.vertex_color[0], b.vertex_color[0]), l(a.vertex_color[1], b.vertex_color[1]), l(a.vertex_color[2], b.vertex_color[2]), l(a.vertex_color[3], b.vertex_color[3])],
    select: a.select && b.select,
  };
}

/** Roots t in [0,1] where segment a→b crosses the circle (sorted). */
export function circleRoots(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number[] {
  const dx = bx - ax,
    dy = by - ay;
  const fx = ax - cx,
    fy = ay - cy;
  const A = dx * dx + dy * dy;
  if (A < 1e-12) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const s = Math.sqrt(disc);
  const out: number[] = [];
  for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) if (t >= 0 && t <= 1) out.push(t);
  return out;
}

function touches(st: GPStroke, screen: ScreenFn, cx: number, cy: number, r: number): boolean {
  const pts = st.points;
  const sc = pts.map(screen);
  for (const [x, y] of sc) if (Math.hypot(x - cx, y - cy) < r) return true;
  const segs = st.cyclic ? pts.length : pts.length - 1;
  for (let k = 0; k < segs; k++) {
    const a = sc[k],
      b = sc[(k + 1) % pts.length];
    if (circleRoots(a[0], a[1], b[0], b[1], cx, cy, r).length) return true;
  }
  return false;
}

/** Stroke eraser: remove whole strokes touched by the circle. */
export function eraseStrokes(strokes: GPStroke[], screen: ScreenFn, cx: number, cy: number, r: number): { strokes: GPStroke[]; changed: boolean } {
  const out = strokes.filter((s) => !touches(s, screen, cx, cy, r));
  return { strokes: out, changed: out.length !== strokes.length };
}

/** Point eraser: cut strokes at the circle boundary, removing the parts inside it. */
export function eraseHard(strokes: GPStroke[], screen: ScreenFn, cx: number, cy: number, r: number): { strokes: GPStroke[]; changed: boolean } {
  const out: GPStroke[] = [];
  let changed = false;
  for (const st of strokes) {
    const res = cutStroke(st, screen, cx, cy, r);
    if (res === null) out.push(st);
    else {
      changed = true;
      out.push(...res);
    }
  }
  return { strokes: out, changed };
}

function cutStroke(st: GPStroke, screen: ScreenFn, cx: number, cy: number, r: number): GPStroke[] | null {
  if (!touches(st, screen, cx, cy, r)) return null;
  let pts = st.points;
  const n = pts.length;
  const inside = (p: GPPoint) => {
    const [x, y] = screen(p);
    return Math.hypot(x - cx, y - cy) < r;
  };
  const cyclic = st.cyclic && n > 2;
  if (cyclic) {
    // start at a point outside the circle and walk the closing segment too
    const start = pts.findIndex((p) => !inside(p));
    if (start < 0) return [];
    pts = [...pts.slice(start), ...pts.slice(0, start), pts[start]];
  }
  const runs: GPPoint[][] = [];
  let run: GPPoint[] | null = inside(pts[0]) ? null : [pts[0]];
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k],
      b = pts[k + 1];
    const sa = screen(a),
      sb = screen(b);
    const inA = inside(a),
      inB = inside(b);
    const roots = circleRoots(sa[0], sa[1], sb[0], sb[1], cx, cy, r);
    if (!inA && !inB) {
      if (roots.length === 2 && roots[1] - roots[0] > 1e-6) {
        run!.push(lerpPoint(a, b, roots[0]));
        runs.push(run!);
        run = [lerpPoint(a, b, roots[1]), b];
      } else run!.push(b);
    } else if (!inA && inB) {
      run!.push(lerpPoint(a, b, roots.length ? roots[0] : 1));
      runs.push(run!);
      run = null;
    } else if (inA && !inB) {
      run = [lerpPoint(a, b, roots.length ? roots[roots.length - 1] : 0), b];
    }
  }
  if (run) runs.push(run);
  if (cyclic && runs.length > 1) {
    // the walk started and ended at the same outside point: join the last run onto the first
    const last = runs.pop()!;
    runs[0] = [...last, ...runs[0].slice(1)];
  } else if (cyclic && runs.length === 1) {
    // a cyclic stroke cut once becomes an open stroke; drop the duplicated start point
    const only = runs[0];
    if (only.length > 1 && only[0] === only[only.length - 1]) only.pop();
  }
  return runs
    .filter((rp) => rp.length >= 2)
    .map((rp, i, all) => ({
      ...st,
      points: rp,
      cyclic: false,
      start_cap: i === 0 && !cyclic ? st.start_cap : 0,
      end_cap: i === all.length - 1 && !cyclic ? st.end_cap : 0,
    }));
}

/** Dissolve eraser: fade opacity (strength × falloff) and drop points that become invisible. */
export function eraseSoft(strokes: GPStroke[], screen: ScreenFn, cx: number, cy: number, r: number, strength: number, threshold = 0.02): { strokes: GPStroke[]; changed: boolean } {
  let changed = false;
  const out: GPStroke[] = [];
  for (const st of strokes) {
    let touched = false;
    const pts = st.points.map((p) => {
      const [x, y] = screen(p);
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d >= 1) return p;
      touched = true;
      const f = 1 - d * d * (3 - 2 * d);
      return { ...p, opacity: Math.max(0, p.opacity - strength * f) };
    });
    if (!touched) {
      out.push(st);
      continue;
    }
    changed = true;
    // split at dissolved points
    const runs: GPPoint[][] = [];
    let cur: GPPoint[] = [];
    for (const p of pts) {
      if (p.opacity <= threshold) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else cur.push(p);
    }
    if (cur.length) runs.push(cur);
    if (runs.length === 1 && runs[0].length === pts.length) out.push({ ...st, points: runs[0] });
    else {
      if (st.cyclic && runs.length > 1 && pts[0].opacity > threshold && pts[pts.length - 1].opacity > threshold) {
        const last = runs.pop()!;
        runs[0] = [...last, ...runs[0]];
      }
      for (const rp of runs) if (rp.length >= 2) out.push({ ...st, points: rp, cyclic: false });
    }
  }
  return { strokes: out, changed };
}
