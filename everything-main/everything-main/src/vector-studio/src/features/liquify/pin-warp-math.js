/**
 * Pin warp deformation: a smooth, as-rigid-as-possible mapping of the plane
 * defined by pins that each move from a rest point p to a target q (moving
 * least squares with rigid transforms, Schaefer, McPhail and Warren 2006).
 * Nearby pins dominate, so artwork bends between pins while each region
 * keeps its shape. A pin can also be turned: it then carries two satellite
 * points around it so the area near the pin rotates with it.
 */

/**
 * Control point pairs for a pin list: each pin { p: {x, y}, q: {x, y},
 * angle (radians) } contributes its own point and, when turned, two
 * satellites at `radius`.
 */
export function controlPoints(pins, radius) {
  const out = [];
  for (const pin of pins) {
    out.push({ p: pin.p, q: pin.q, w: 1 });
    if (pin.angle) {
      for (const base of [0, Math.PI / 2]) {
        const px = pin.p.x + Math.cos(base) * radius;
        const py = pin.p.y + Math.sin(base) * radius;
        const a = base + pin.angle;
        out.push({ p: { x: px, y: py }, q: { x: pin.q.x + Math.cos(a) * radius, y: pin.q.y + Math.sin(a) * radius }, w: 0.6 });
      }
    }
  }
  return out;
}

/**
 * A deformation function (x, y) -> { x, y } for control point pairs. With
 * one pair the plane just moves; with none it stays put.
 */
export function rigidMLS(ctrl, alpha = 1) {
  if (!ctrl.length) return (x, y) => ({ x, y });
  if (ctrl.length === 1) {
    const dx = ctrl[0].q.x - ctrl[0].p.x;
    const dy = ctrl[0].q.y - ctrl[0].p.y;
    return (x, y) => ({ x: x + dx, y: y + dy });
  }
  const n = ctrl.length;
  const w = new Float64Array(n);
  return (x, y) => {
    let sw = 0;
    let px = 0;
    let py = 0;
    let qx = 0;
    let qy = 0;
    for (let i = 0; i < n; i++) {
      const c = ctrl[i];
      const d2 = (c.p.x - x) ** 2 + (c.p.y - y) ** 2;
      // A point on a pin goes exactly where the pin went.
      if (d2 < 1e-12) return { x: c.q.x, y: c.q.y };
      w[i] = c.w / Math.pow(d2, alpha);
      sw += w[i];
      px += w[i] * c.p.x;
      py += w[i] * c.p.y;
      qx += w[i] * c.q.x;
      qy += w[i] * c.q.y;
    }
    px /= sw;
    py /= sw;
    qx /= sw;
    qy /= sw;
    const vx = x - px;
    const vy = y - py;
    // f_r(v) = sum q^_i A_i, with A_i built from p^_i and (v - p*).
    let fx = 0;
    let fy = 0;
    for (let i = 0; i < n; i++) {
      const c = ctrl[i];
      const phx = c.p.x - px;
      const phy = c.p.y - py;
      const qhx = c.q.x - qx;
      const qhy = c.q.y - qy;
      // A_i = w_i [p^; -p^perp] [v; -v perp]^T, with perp(x, y) = (-y, x).
      const a11 = w[i] * (phx * vx + phy * vy);
      const a12 = w[i] * (phx * vy - phy * vx);
      const a21 = -a12;
      const a22 = a11;
      fx += qhx * a11 + qhy * a21;
      fy += qhx * a12 + qhy * a22;
    }
    const len = Math.hypot(fx, fy);
    const vl = Math.hypot(vx, vy);
    if (len < 1e-12) return { x: qx + vx, y: qy + vy };
    return { x: qx + (fx / len) * vl, y: qy + (fy / len) * vl };
  };
}

/** Apply a deformation to anchors: each anchor and handle maps as its own point. */
export function warpAnchors(anchors, f) {
  return anchors.map((a) => {
    const p = f(a.x, a.y);
    const i = f(a.ix, a.iy);
    const o = f(a.ox, a.oy);
    return { x: p.x, y: p.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y };
  });
}

/** Rest position for a new pin placed at a deformed point (inverse by fixed-point iteration). */
export function restPoint(f, x, y) {
  let px = x;
  let py = y;
  for (let k = 0; k < 20; k++) {
    const q = f(px, py);
    const ex = x - q.x;
    const ey = y - q.y;
    px += ex;
    py += ey;
    if (Math.abs(ex) + Math.abs(ey) < 1e-6) break;
  }
  return { x: px, y: py };
}
