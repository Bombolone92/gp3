/**
 * Curve fitting for traced boundaries.
 *
 * A chain arrives as lattice points along pixel edges (a staircase).
 * fitChain() finds corners on the staircase at several points of reach,
 * smooths each run between corners with a Gaussian average, and fits
 * cubic Beziers to the run within a tolerance (least squares with Newton
 * reparameterization, splitting at the worst point when a single curve
 * does not fit). Runs that are straight within tolerance become lines.
 * Chain end points (junctions) are kept exactly, so chains that meet stay
 * joined.
 *
 * Output geometry: { x0, y0, segs } where each seg is [x, y] (line) or
 * [c1x, c1y, c2x, c2y, x, y] (cubic), in lattice (pixel) units.
 */

/** Turning angle in degrees at each lattice point, measured over `k` points of reach. */
function turning(xs, ys, closed, k) {
  const n = xs.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let bx = 0;
    let by = 0;
    let fx = 0;
    let fy = 0;
    let nb = 0;
    let nf = 0;
    for (let j = 1; j <= k; j++) {
      let a = i - j;
      let b = i + j;
      if (closed) {
        a = (a + n) % n;
        b %= n;
      }
      if (a >= 0) {
        bx += xs[a];
        by += ys[a];
        nb++;
      }
      if (b < n) {
        fx += xs[b];
        fy += ys[b];
        nf++;
      }
    }
    if (!nb || !nf) continue;
    const ax = xs[i] - bx / nb;
    const ay = ys[i] - by / nb;
    const cx = fx / nf - xs[i];
    const cy = fy / nf - ys[i];
    const la = Math.hypot(ax, ay);
    const lc = Math.hypot(cx, cy);
    if (la < 1e-9 || lc < 1e-9) continue;
    const cos = Math.max(-1, Math.min(1, (ax * cx + ay * cy) / (la * lc)));
    out[i] = (Math.acos(cos) * 180) / Math.PI;
  }
  return out;
}

/** Indices of corner points: sharp turns that are the sharpest in their neighborhood. */
export function findCorners(xs, ys, closed, threshold, forced = null, reach = 4) {
  const n = xs.length;
  if (n < 3) return forced ? [...forced].sort((a, b) => a - b) : [];
  const k = Math.max(1, Math.min(reach, Math.floor(n / 4)));
  const ang = turning(xs, ys, closed, k);
  const corners = [];
  for (let i = 0; i < n; i++) {
    if (forced?.has(i)) {
      corners.push(i);
      continue;
    }
    if (!closed && (i < 1 || i > n - 2)) continue;
    if (ang[i] < threshold) continue;
    let peak = true;
    for (let j = 1; j <= k && peak; j++) {
      let a = i - j;
      let b = i + j;
      if (closed) {
        a = (a + n) % n;
        b %= n;
      }
      // Strictly sharper neighbors win; on a plateau the first point wins.
      if (a >= 0 && a !== i && ang[a] >= ang[i]) peak = false;
      if (b < n && b !== i && ang[b] > ang[i]) peak = false;
    }
    if (peak) corners.push(i);
  }
  return corners;
}

// ---- least-squares cubic fitting ----

function chordParams(px, py, a, b) {
  const u = new Float64Array(b - a + 1);
  for (let i = a + 1; i <= b; i++) u[i - a] = u[i - a - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]);
  const total = u[b - a] || 1;
  for (let i = 0; i < u.length; i++) u[i] /= total;
  return u;
}

function bezierFor(px, py, a, b, u, t1x, t1y, t2x, t2y) {
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  const sx = px[a];
  const sy = py[a];
  const ex = px[b];
  const ey = py[b];
  for (let i = 0; i <= b - a; i++) {
    const t = u[i];
    const mt = 1 - t;
    const b1 = 3 * t * mt * mt;
    const b2 = 3 * t * t * mt;
    const a1x = t1x * b1;
    const a1y = t1y * b1;
    const a2x = t2x * b2;
    const a2y = t2y * b2;
    c00 += a1x * a1x + a1y * a1y;
    c01 += a1x * a2x + a1y * a2y;
    c11 += a2x * a2x + a2y * a2y;
    const h0 = mt * mt * mt + b1;
    const h3 = b2 + t * t * t;
    const tx = px[a + i] - (sx * h0 + ex * h3);
    const ty = py[a + i] - (sy * h0 + ey * h3);
    x0 += a1x * tx + a1y * ty;
    x1 += a2x * tx + a2y * ty;
  }
  const det = c00 * c11 - c01 * c01;
  let al = det ? (x0 * c11 - x1 * c01) / det : 0;
  let ar = det ? (c00 * x1 - c01 * x0) / det : 0;
  const len = Math.hypot(ex - sx, ey - sy);
  // Degenerate or runaway solutions fall back to thirds of the chord.
  if (!(al > 1e-6 * len) || !(ar > 1e-6 * len) || al > len * 1.5 || ar > len * 1.5) al = ar = len / 3;
  return [sx, sy, sx + t1x * al, sy + t1y * al, ex + t2x * ar, ey + t2y * ar, ex, ey];
}

function evalBez(c, t, out) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const d = 3 * mt * t * t;
  const e = t * t * t;
  out[0] = a * c[0] + b * c[2] + d * c[4] + e * c[6];
  out[1] = a * c[1] + b * c[3] + d * c[5] + e * c[7];
  return out;
}

function maxError(px, py, a, b, c, u) {
  let worst = 0;
  let at = (a + b) >> 1;
  const p = [0, 0];
  for (let i = a + 1; i < b; i++) {
    evalBez(c, u[i - a], p);
    const d = (p[0] - px[i]) ** 2 + (p[1] - py[i]) ** 2;
    if (d >= worst) {
      worst = d;
      at = i;
    }
  }
  return [worst, at];
}

function newton(px, py, a, b, c, u) {
  const out = new Float64Array(u.length);
  const p = [0, 0];
  for (let i = 0; i <= b - a; i++) {
    const t = u[i];
    const mt = 1 - t;
    evalBez(c, t, p);
    const d1x = 3 * (mt * mt * (c[2] - c[0]) + 2 * mt * t * (c[4] - c[2]) + t * t * (c[6] - c[4]));
    const d1y = 3 * (mt * mt * (c[3] - c[1]) + 2 * mt * t * (c[5] - c[3]) + t * t * (c[7] - c[5]));
    const d2x = 6 * (mt * (c[4] - 2 * c[2] + c[0]) + t * (c[6] - 2 * c[4] + c[2]));
    const d2y = 6 * (mt * (c[5] - 2 * c[3] + c[1]) + t * (c[7] - 2 * c[5] + c[3]));
    const ex = p[0] - px[a + i];
    const ey = p[1] - py[a + i];
    const num = ex * d1x + ey * d1y;
    const den = d1x * d1x + d1y * d1y + ex * d2x + ey * d2y;
    out[i] = den ? Math.max(0, Math.min(1, t - num / den)) : t;
  }
  return out;
}

function unitVec(x, y) {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

/** Tangent leaving point `a` toward increasing (dir 1) or decreasing (dir -1) index. */
function endTangent(px, py, a, lo, hi, dir) {
  let sx = 0;
  let sy = 0;
  for (let j = 1; j <= 3; j++) {
    const i = a + dir * j;
    if (i < lo || i > hi) break;
    sx += px[i] - px[a];
    sy += py[i] - py[a];
  }
  return unitVec(sx, sy);
}

function fitCubics(px, py, a, b, t1, t2, err2, out, depth = 0) {
  if (b - a === 1) {
    const len = Math.hypot(px[b] - px[a], py[b] - py[a]) / 3;
    out.push([px[a] + t1[0] * len, py[a] + t1[1] * len, px[b] + t2[0] * len, py[b] + t2[1] * len, px[b], py[b]]);
    return;
  }
  let u = chordParams(px, py, a, b);
  let c = bezierFor(px, py, a, b, u, t1[0], t1[1], t2[0], t2[1]);
  let [e, split] = maxError(px, py, a, b, c, u);
  if (e < err2) {
    out.push(c.slice(2));
    return;
  }
  if (e < err2 * 9) {
    for (let it = 0; it < 6; it++) {
      u = newton(px, py, a, b, c, u);
      c = bezierFor(px, py, a, b, u, t1[0], t1[1], t2[0], t2[1]);
      [e, split] = maxError(px, py, a, b, c, u);
      if (e < err2) {
        out.push(c.slice(2));
        return;
      }
    }
  }
  if (depth > 40 || split <= a || split >= b) {
    out.push(c.slice(2));
    return;
  }
  const k = Math.max(1, Math.min(3, split - a, b - split));
  const tc = unitVec(px[split - k] - px[split + k], py[split - k] - py[split + k]);
  fitCubics(px, py, a, split, t1, tc, err2, out, depth + 1);
  fitCubics(px, py, split, b, [-tc[0], -tc[1]], t2, err2, out, depth + 1);
}

/** Largest distance of points a..b from the chord a-b. */
function chordDeviation(px, py, a, b) {
  const dx = px[b] - px[a];
  const dy = py[b] - py[a];
  const len = Math.hypot(dx, dy);
  let worst = 0;
  for (let i = a + 1; i < b; i++) {
    const d = len < 1e-9 ? Math.hypot(px[i] - px[a], py[i] - py[a]) : Math.abs((px[i] - px[a]) * dy - (py[i] - py[a]) * dx) / len;
    if (d > worst) worst = d;
  }
  return worst;
}

/** Turn nearly straight cubics into lines. */
function straighten(x0, y0, segs, tol) {
  let px = x0;
  let py = y0;
  return segs.map((s) => {
    if (s.length === 6) {
      const [c1x, c1y, c2x, c2y, x, y] = s;
      const dx = x - px;
      const dy = y - py;
      const len = Math.hypot(dx, dy);
      const dist = (qx, qy) => (len < 1e-9 ? Math.hypot(qx - px, qy - py) : Math.abs((qx - px) * dy - (qy - py) * dx) / len);
      const along = (qx, qy) => (len < 1e-9 ? 0 : ((qx - px) * dx + (qy - py) * dy) / (len * len));
      const t1 = along(c1x, c1y);
      const t2 = along(c2x, c2y);
      px = x;
      py = y;
      if (dist(c1x, c1y) <= tol && dist(c2x, c2y) <= tol && t1 >= -0.05 && t1 <= 1.05 && t2 >= -0.05 && t2 <= 1.05) return [x, y];
      return s;
    }
    px = s[0];
    py = s[1];
    return s;
  });
}

/** Normalized Gaussian weights for offsets -K..K. */
function gaussian(sigma) {
  const K = Math.max(1, Math.ceil(sigma * 2.5));
  const w = [];
  let sum = 0;
  for (let j = -K; j <= K; j++) {
    const v = Math.exp(-(j * j) / (2 * sigma * sigma));
    w.push(v);
    sum += v;
  }
  return { K, w: w.map((v) => v / sum) };
}

/**
 * Smoothed sample points for the lattice run a..b (indices into xs/ys,
 * wrapping by n): a Gaussian average along the run removes the pixel
 * staircase. The end points stay put; beyond them the run is mirrored
 * through the end point, so straight runs stay straight right up to a
 * corner. `loop` smooths a whole closed chain cyclically instead.
 */
function smoothRun(xs, ys, a, b, n, sigma, loop = false) {
  const m = b - a;
  const px = new Array(m + 1);
  const py = new Array(m + 1);
  for (let i = 0; i <= m; i++) {
    px[i] = xs[(a + i) % n];
    py[i] = ys[(a + i) % n];
  }
  if (m < 3 || sigma <= 0) return { px, py };
  const { K, w } = gaussian(sigma);
  const sx = new Array(m + 1);
  const sy = new Array(m + 1);
  const ref = (j) => (j < 0 ? Math.min(-j, m) : j > m ? Math.max(2 * m - j, 0) : j);
  for (let i = 0; i <= m; i++) {
    if (!loop && (i === 0 || i === m)) {
      sx[i] = px[i];
      sy[i] = py[i];
      continue;
    }
    let x = 0;
    let y = 0;
    for (let k = -K; k <= K; k++) {
      const j = i + k;
      let qx;
      let qy;
      if (loop) {
        const c = ((j % m) + m) % m;
        qx = px[c];
        qy = py[c];
      } else if (j < 0 || j > m) {
        const e = j < 0 ? 0 : m;
        qx = 2 * px[e] - px[ref(j)];
        qy = 2 * py[e] - py[ref(j)];
      } else {
        qx = px[j];
        qy = py[j];
      }
      x += w[k + K] * qx;
      y += w[k + K] * qy;
    }
    sx[i] = x;
    sy[i] = y;
  }
  if (loop) {
    sx[m] = sx[0];
    sy[m] = sy[0];
  }
  return { px: sx, py: sy };
}

/**
 * Fit one chain. `pts` is a flat [x0, y0, x1, y1, ...] list of lattice
 * points; for closed chains the last point repeats the first. opts:
 *   tolerance    allowed distance from the pixel boundary (pixels)
 *   cornerAngle  turning angle (degrees) above which a point is a corner
 *   lineTolerance  cubics whose handles stay this close to the chord become lines
 *   forced       Set of point indices that must be corners (image corners)
 *   smoothing    Gaussian sigma (in points) that removes the pixel staircase
 *   reach        points on each side used to measure turning (corners)
 * End points of open chains stay exactly where `pts` puts them (they may be
 * off the lattice: junctions are relaxed before fitting).
 */
export function fitChain(pts, closed, { tolerance = 1, cornerAngle = 70, lineTolerance = 0.15, forced = null, smoothing = 1.5, reach = 4 } = {}) {
  let n = pts.length / 2;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i * 2];
    ys[i] = pts[i * 2 + 1];
  }
  if (closed) n--; // drop the repeated start point
  const X = closed ? xs.subarray(0, n) : xs;
  const Y = closed ? ys.subarray(0, n) : ys;
  const err2 = tolerance * tolerance;
  const lineTol = Math.max(lineTolerance, 0.05);
  let breaks = findCorners(X, Y, closed, cornerAngle, forced, reach);
  if (!closed) breaks = [0, ...breaks.filter((i) => i > 0 && i < n - 1), n - 1];
  const segs = [];
  let x0;
  let y0;
  if (closed && !breaks.length) {
    // A smooth loop: start anywhere and keep the seam smooth with a shared tangent.
    const { px, py } = smoothRun(X, Y, 0, n, n, smoothing, true);
    const m = px.length - 1;
    const k = Math.max(1, Math.min(3, m >> 3));
    const tan = unitVec(px[k] - px[m - k], py[k] - py[m - k]);
    x0 = px[0];
    y0 = py[0];
    if (m < 4) {
      for (let i = 1; i <= m; i++) segs.push([px[i], py[i]]);
    } else {
      // Split in two halves so a single cubic never has to close on itself.
      const half = m >> 1;
      const tm = unitVec(px[half + k] - px[half - k], py[half + k] - py[half - k]);
      fitCubics(px, py, 0, half, tan, [-tm[0], -tm[1]], err2, segs);
      fitCubics(px, py, half, m, tm, [-tan[0], -tan[1]], err2, segs);
    }
    return { x0, y0, segs: straighten(x0, y0, segs, lineTol) };
  }
  const runs = [];
  if (closed) {
    for (let i = 0; i < breaks.length; i++) {
      const a = breaks[i];
      const b = i + 1 < breaks.length ? breaks[i + 1] : breaks[0] + n;
      runs.push([a, b]);
    }
  } else for (let i = 0; i + 1 < breaks.length; i++) runs.push([breaks[i], breaks[i + 1]]);
  x0 = X[runs[0][0] % n];
  y0 = Y[runs[0][0] % n];
  for (const [a, b] of runs) {
    if (b - a === 1) {
      segs.push([X[b % n], Y[b % n]]);
      continue;
    }
    const { px, py } = smoothRun(X, Y, a, b, n, smoothing);
    const m = px.length - 1;
    if (chordDeviation(px, py, 0, m) <= Math.max(lineTol, Math.min(tolerance, 0.75) * 0.75)) {
      segs.push([px[m], py[m]]);
      continue;
    }
    const t1 = endTangent(px, py, 0, 0, m, 1);
    const t2 = endTangent(px, py, m, 0, m, -1);
    fitCubics(px, py, 0, m, t1, t2, err2, segs);
  }
  return { x0, y0, segs: straighten(x0, y0, segs, lineTol) };
}

/** The same geometry traversed backwards. */
export function reverseGeometry(g) {
  const pts = [[g.x0, g.y0]];
  for (const s of g.segs) pts.push(s.length === 2 ? s : [s[4], s[5]]);
  const segs = [];
  for (let i = g.segs.length - 1; i >= 0; i--) {
    const s = g.segs[i];
    const [px, py] = pts[i];
    segs.push(s.length === 2 ? [px, py] : [s[2], s[3], s[0], s[1], px, py]);
  }
  const last = pts[pts.length - 1];
  return { x0: last[0], y0: last[1], segs };
}

/**
 * Where chains meet at a junction, a boundary that runs straight through
 * (two chain ends pointing in nearly opposite directions) should stay
 * smooth: the two end handles are turned onto one shared line, keeping
 * their lengths. Anchors do not move, so shared boundaries stay gap-free.
 * `ends` lists { key, geom, start } for every chain end at a junction.
 */
export function smoothJunctions(ends, maxBend = 30) {
  const groups = new Map();
  for (const e of ends) {
    const g = e.geom;
    const s = e.start ? g.segs[0] : g.segs[g.segs.length - 1];
    if (!s || s.length !== 6) continue;
    const ax = e.start ? g.x0 : s[4];
    const ay = e.start ? g.y0 : s[5];
    const hx = e.start ? s[0] : s[2];
    const hy = e.start ? s[1] : s[3];
    const len = Math.hypot(hx - ax, hy - ay);
    if (len < 1e-6) continue;
    const item = { ...e, seg: s, ax, ay, ux: (hx - ax) / len, uy: (hy - ay) / len, len };
    let list = groups.get(e.key);
    if (!list) groups.set(e.key, (list = []));
    list.push(item);
  }
  const cosLimit = -Math.cos((maxBend * Math.PI) / 180);
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const pairs = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const d = list[i].ux * list[j].ux + list[i].uy * list[j].uy;
      if (d <= cosLimit) pairs.push([d, i, j]);
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const used = new Set();
    for (const [, i, j] of pairs) {
      if (used.has(i) || used.has(j)) continue;
      used.add(i);
      used.add(j);
      const a = list[i];
      const b = list[j];
      const [ux, uy] = unitVec(a.ux - b.ux, a.uy - b.uy);
      const set = (it, sx, sy) => {
        const x = it.ax + sx * it.len;
        const y = it.ay + sy * it.len;
        if (it.start) {
          it.seg[0] = x;
          it.seg[1] = y;
        } else {
          it.seg[2] = x;
          it.seg[3] = y;
        }
      };
      set(a, ux, uy);
      set(b, -ux, -uy);
    }
  }
}
