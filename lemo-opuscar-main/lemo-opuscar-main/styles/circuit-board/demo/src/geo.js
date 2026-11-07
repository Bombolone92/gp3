// Board projection for the Yangtze corridor: 1 unit is about 1 km (equirectangular at 30 deg N).
export const P = (lon, lat) => [(lon - 100.6) * 96, (34.2 - lat) * 111];

// Route through waypoints with PCB-style 45° geometry. Each waypoint after the first may carry a mode:
// 'd' = diagonal first, 's' = straight first (default 's'). Points are [x,y] or [x,y,mode].
export function octi(pts) {
  const out = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i], mode = b[2] || 's';
    const dx = b[0] - a[0], dy = b[1] - a[1], ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.min(ax, ay) > 1e-6 && Math.abs(ax - ay) > 1e-6) {
      const d = Math.min(ax, ay), sx = Math.sign(dx), sy = Math.sign(dy);
      if (mode === 'd') out.push([a[0] + sx * d, a[1] + sy * d]);
      else out.push(ax > ay ? [a[0] + dx - sx * d, a[1]] : [a[0], a[1] + dy - sy * d]);
    }
    out.push([b[0], b[1]]);
  }
  return dedupe(out);
}
function dedupe(p) { const o = [p[0]]; for (let i = 1; i < p.length; i++) if (Math.hypot(p[i][0] - o[o.length - 1][0], p[i][1] - o[o.length - 1][1]) > 1e-6) o.push(p[i]); return o; }

// Parallel offset of an open polyline (mitred). d > 0 = to the left of travel direction (screen: y down).
export function offset(pts, d) {
  const n = pts.length, segs = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0);
    const nx = (y1 - y0) / L, ny = -(x1 - x0) / L;
    segs.push([x0 + nx * d, y0 + ny * d, x1 + nx * d, y1 + ny * d]);
  }
  const out = [[segs[0][0], segs[0][1]]];
  for (let i = 0; i < segs.length - 1; i++) {
    const p = inter(segs[i], segs[i + 1]); out.push(p || [segs[i][2], segs[i][3]]);
  }
  const l = segs[segs.length - 1]; out.push([l[2], l[3]]);
  return out;
}
function inter(a, b) {
  const [x1, y1, x2, y2] = a, [x3, y3, x4, y4] = b;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

// Polyline measuring
export function measure(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
export function at(m, s) {
  const { pts, cum } = m; s = Math.max(0, Math.min(m.len, s));
  let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
  const f = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
  return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
}
// sub-polyline between arc lengths s0..s1
export function sub(m, s0, s1) {
  s0 = Math.max(0, s0); s1 = Math.min(m.len, s1); if (s1 <= s0) return [];
  const out = [at(m, s0)];
  for (let i = 1; i < m.pts.length - 1; i++) if (m.cum[i] > s0 && m.cum[i] < s1) out.push(m.pts[i]);
  out.push(at(m, s1)); return out;
}
// Trim the ends of a polyline by a0 (start) and a1 (end)
export function trim(pts, a0, a1) { const m = measure(pts); return sub(m, a0, m.len - a1); }

// octilinear closed outline through waypoints
export function octiClosed(pts) { const o = octi([...pts, [pts[0][0], pts[0][1], pts[0][2]]]); o.pop(); return o; }
// point and unit tangent at arc length s
export function frameAt(m, s) {
  const p = at(m, s), q = at(m, Math.min(m.len, s + 0.5)), r = at(m, Math.max(0, s - 0.5));
  const dx = q[0] - r[0], dy = q[1] - r[1], L = Math.hypot(dx, dy) || 1;
  return { p, t: [dx / L, dy / L], n: [dy / L, -dx / L] };
}
