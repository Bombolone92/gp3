/**
 * Optical flow for smooth slow motion: the motion between two neighbouring
 * source frames, used to draw the frames in between (engine/slow-motion.js
 * runs it on the GPU). This file holds the shared constants, the pyramid
 * sizes and a plain-JS version of every pass, step for step the same math
 * as the shaders, so the method is unit-tested on synthetic images.
 *
 * Method, on luma at a reduced working size (FLOW_SIZE on the long side):
 *  1. A pyramid of each frame, halving until the coarsest level is small.
 *  2. Coarse to fine, for each level:
 *     match:  pick the best of the flow predicted from the coarser level
 *             (at the pixel and its four neighbours, so motion edges can
 *             snap to the right side), then search a small window around
 *             it; the coarsest level searches a wider window from zero.
 *             Cost: mean absolute difference over a 5x5 patch.
 *     refine: Lucas-Kanade steps on a 5x5 window for sub-pixel accuracy
 *             (damped, so flat areas keep their prediction).
 *     smooth: edge-aware average of the flow; neighbours with a poor match
 *             or a different brightness count less.
 *  3. The same both ways: forward (A to B) and backward (B to A).
 *  4. In-between at position t: the motion through each output pixel is
 *     found by a fixed-point walk on each flow; of all the steps of both
 *     walks, the one whose two ends match best wins (at the flow size).
 *     Both frames are sampled along it; a forward /
 *     backward mismatch marks a side as occluded and the other side is
 *     used alone; where the match stays poor without a clear occlusion the
 *     result fades toward a plain cross-fade.
 *
 * Images here are { w, h, data: Float32Array } with one channel; pixel
 * centers sit at integer coordinates and sampling clamps at the edges, as
 * GPU texture sampling does.
 */

/** Long side of the finest flow level (pixels). */
export const FLOW_SIZE = 640;
/** The pyramid stops once a level's long side is at most twice this. */
export const COARSE_SIZE = 24;
/** Patch and Lucas-Kanade window radius (5x5). */
export const PATCH = 2;
/**
 * Search radius around the prediction: wide on small levels (long side up
 * to WIDE_LEVEL), so small fast objects the coarsest level blurs away are
 * still found, then one pixel on the large ones.
 */
export const SEARCH_WIDE = 4;
export const SEARCH = 1;
export const WIDE_LEVEL = 160;
/** Extra match cost per pixel of distance from the predicted flow. */
export const MOTION_PENALTY = 0.002;
/** Damping of the Lucas-Kanade step (added to the structure tensor). */
export const LK_DAMPING = 0.004;
/** Smoothing: radius, spatial sigma, brightness sigma, cost floor. */
export const SMOOTH_RADIUS = 2;
export const SMOOTH_SIGMA = 1.5;
export const SMOOTH_LUMA = 0.08;
export const COST_FLOOR = 0.01;
/** Fixed-point steps that place the motion through an in-between pixel. */
export const WALK_STEPS = 3;
/** Forward/backward mismatch (level-0 pixels) from fully visible to occluded. */
export const OCCLUSION = [0.5, 2];
/** Match error of the two ends (mean luma difference) from trusted to cross-faded. */
export const FALLBACK = [0.04, 0.12];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Level sizes for a source of w x h: [{ w, h }] finest first. */
export function pyramidSizes(w, h, maxSize = FLOW_SIZE) {
  const s = Math.min(1, maxSize / Math.max(w, h));
  let lw = Math.max(8, Math.round(w * s));
  let lh = Math.max(8, Math.round(h * s));
  const out = [{ w: lw, h: lh }];
  while (Math.max(lw, lh) > 2 * COARSE_SIZE) {
    lw = Math.ceil(lw / 2);
    lh = Math.ceil(lh / 2);
    out.push({ w: lw, h: lh });
  }
  return out;
}

/** Search radius on a level of w x h. */
export const searchRadius = (w, h) => (Math.max(w, h) <= WIDE_LEVEL ? SEARCH_WIDE : SEARCH);

export const image = (w, h, data = new Float32Array(w * h)) => ({ w, h, data });

/** Bilinear sample at pixel coordinates (centers on integers), clamped to the edges. */
export function sample(img, x, y) {
  const { w, h, data } = img;
  x = clamp(x, 0, w - 1);
  y = clamp(y, 0, h - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
  const bot = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

/** Half-size level: four bilinear taps around each output pixel's footprint. */
export function downsample(img) {
  const w2 = Math.ceil(img.w / 2);
  const h2 = Math.ceil(img.h / 2);
  const out = image(w2, h2);
  const rx = img.w / w2;
  const ry = img.h / h2;
  for (let j = 0; j < h2; j++) {
    for (let i = 0; i < w2; i++) {
      const x = (i + 0.5) * rx - 0.5;
      const y = (j + 0.5) * ry - 0.5;
      out.data[j * w2 + i] = 0.25 * (sample(img, x - 0.5, y - 0.5) + sample(img, x + 0.5, y - 0.5) + sample(img, x - 0.5, y + 0.5) + sample(img, x + 0.5, y + 0.5));
    }
  }
  return out;
}

export function pyramid(img, levels) {
  const out = [img];
  while (out.length < levels) out.push(downsample(out.at(-1)));
  return out;
}

/** Flow field: { w, h, u, v, cost } (pixels of its level). */
const field = (w, h) => ({ w, h, u: new Float32Array(w * h), v: new Float32Array(w * h), cost: new Float32Array(w * h) });

const flowAt = (f, x, y) => [sample({ w: f.w, h: f.h, data: f.u }, x, y), sample({ w: f.w, h: f.h, data: f.v }, x, y)];

/** Mean absolute difference of a's patch at (x, y) and b's patch displaced by (u, v). */
export function patchCost(a, b, x, y, u, v) {
  let s = 0;
  for (let oy = -PATCH; oy <= PATCH; oy++) {
    for (let ox = -PATCH; ox <= PATCH; ox++) s += Math.abs(sample(a, x + ox, y + oy) - sample(b, x + ox + u, y + oy + v));
  }
  return s / (2 * PATCH + 1) ** 2;
}

/** Match pass: best predicted candidate, then a window search around it. */
export function match(a, b, coarse) {
  const out = field(a.w, a.h);
  const radius = searchRadius(a.w, a.h);
  const rx = coarse ? a.w / coarse.w : 1;
  const ry = coarse ? a.h / coarse.h : 1;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      const cands = [];
      if (coarse) {
        const cx = (x + 0.5) / rx - 0.5;
        const cy = (y + 0.5) / ry - 0.5;
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const [u, v] = flowAt(coarse, cx + dx, cy + dy);
          cands.push([u * rx, v * ry]);
        }
      } else cands.push([0, 0]);
      const [pu, pv] = cands[0];
      const score = (u, v) => {
        const c = patchCost(a, b, x, y, u, v);
        return { c, s: c + MOTION_PENALTY * Math.hypot(u - pu, v - pv) };
      };
      let best = { u: pu, v: pv, ...score(pu, pv) };
      for (const [u, v] of cands.slice(1)) {
        const r = score(u, v);
        if (r.s < best.s) best = { u, v, ...r };
      }
      const [bu, bv] = [best.u, best.v];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (!dx && !dy) continue;
          const r = score(bu + dx, bv + dy);
          if (r.s < best.s) best = { u: bu + dx, v: bv + dy, ...r };
        }
      }
      const k = y * a.w + x;
      out.u[k] = best.u;
      out.v[k] = best.v;
      out.cost[k] = best.c;
    }
  }
  return out;
}

/**
 * Damped Lucas-Kanade update for a 2x2 structure tensor (hxx, hxy, hyy) and
 * mismatch vector (bx, by): solves (H + damping I) d = -b, then caps the
 * step at one pixel.
 */
export function lkStep(hxx, hxy, hyy, bx, by, damping = LK_DAMPING) {
  const a = hxx + damping;
  const c = hyy + damping;
  const det = a * c - hxy * hxy;
  if (!(det > 1e-12)) return [0, 0];
  let du = -(c * bx - hxy * by) / det;
  let dv = -(a * by - hxy * bx) / det;
  const len = Math.hypot(du, dv);
  if (len > 1) {
    du /= len;
    dv /= len;
  }
  return [du, dv];
}

/** One Lucas-Kanade refinement of every flow vector, with the cost re-measured. */
export function refine(a, b, f) {
  const out = field(f.w, f.h);
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const k = y * f.w + x;
      let u = f.u[k];
      let v = f.v[k];
      let hxx = 0;
      let hxy = 0;
      let hyy = 0;
      let bx = 0;
      let by = 0;
      for (let oy = -PATCH; oy <= PATCH; oy++) {
        for (let ox = -PATCH; ox <= PATCH; ox++) {
          const qx = x + ox;
          const qy = y + oy;
          const e = sample(b, qx + u, qy + v) - sample(a, qx, qy);
          const gx = 0.25 * (sample(a, qx + 1, qy) - sample(a, qx - 1, qy) + sample(b, qx + u + 1, qy + v) - sample(b, qx + u - 1, qy + v));
          const gy = 0.25 * (sample(a, qx, qy + 1) - sample(a, qx, qy - 1) + sample(b, qx + u, qy + v + 1) - sample(b, qx + u, qy + v - 1));
          hxx += gx * gx;
          hxy += gx * gy;
          hyy += gy * gy;
          bx += gx * e;
          by += gy * e;
        }
      }
      const [du, dv] = lkStep(hxx, hxy, hyy, bx, by);
      u += du;
      v += dv;
      out.u[k] = u;
      out.v[k] = v;
      out.cost[k] = patchCost(a, b, x, y, u, v);
    }
  }
  return out;
}

/** Edge-aware smoothing of a flow field (weights: distance, brightness, match cost). */
export function smooth(a, f) {
  const out = field(f.w, f.h);
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const l0 = a.data[y * a.w + x];
      let su = 0;
      let sv = 0;
      let sc = 0;
      let sw = 0;
      for (let oy = -SMOOTH_RADIUS; oy <= SMOOTH_RADIUS; oy++) {
        for (let ox = -SMOOTH_RADIUS; ox <= SMOOTH_RADIUS; ox++) {
          const nx = clamp(x + ox, 0, f.w - 1);
          const ny = clamp(y + oy, 0, f.h - 1);
          const n = ny * f.w + nx;
          const dl = a.data[n] - l0;
          const wgt = Math.exp(-(ox * ox + oy * oy) / (2 * SMOOTH_SIGMA ** 2) - (dl * dl) / (2 * SMOOTH_LUMA ** 2)) / (f.cost[n] + COST_FLOOR);
          su += wgt * f.u[n];
          sv += wgt * f.v[n];
          sc += wgt * f.cost[n];
          sw += wgt;
        }
      }
      const k = y * f.w + x;
      out.u[k] = su / sw;
      out.v[k] = sv / sw;
      out.cost[k] = sc / sw;
    }
  }
  return out;
}

/** Flow from a to b (pyramids, finest first), coarse to fine. */
export function estimateFlow(pa, pb) {
  let flow = null;
  for (let L = pa.length - 1; L >= 0; L--) {
    let f = match(pa[L], pb[L], flow);
    for (let i = 0; i < (L === 0 ? 2 : 1); i++) f = refine(pa[L], pb[L], f);
    flow = smooth(pa[L], f);
  }
  return flow;
}

/** Forward and backward flow between two same-size luma images. */
export function flowPair(a, b) {
  const levels = pyramidSizes(a.w, a.h, Math.max(a.w, a.h)).length;
  const pa = pyramid(a, levels);
  const pb = pyramid(b, levels);
  return { fwd: estimateFlow(pa, pb), bwd: estimateFlow(pb, pa) };
}

/**
 * Motions (A to B) through in-between point (x, y) at position t: the steps
 * of a fixed-point walk m = F(p - t m) on the forward flow, or
 * m = -G(p + (1 - t) m) on the backward flow. Near motion edges the walk
 * can swing between the two sides, so every step is a candidate.
 */
export function walk(f, x, y, t, backward) {
  let [u, v] = flowAt(f, x, y);
  if (backward) [u, v] = [-u, -v];
  const out = [[u, v]];
  for (let i = 0; i < WALK_STEPS; i++) {
    const [fu, fv] = backward ? flowAt(f, x + (1 - t) * u, y + (1 - t) * v) : flowAt(f, x - t * u, y - t * v);
    [u, v] = backward ? [-fu, -fv] : [fu, fv];
    out.push([u, v]);
  }
  return out;
}

/** Mean luma difference of the two 3x3 ends of a motion through (x, y). */
function endError(a, b, x, y, t, u, v) {
  let s = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) s += Math.abs(sample(a, x - t * u + ox, y - t * v + oy) - sample(b, x + (1 - t) * u + ox, y + (1 - t) * v + oy));
  }
  return s / 9;
}

/** How occluded a point is: its flow and the opposite flow at its target fail to cancel. */
function occlusion(f, g, x, y) {
  const [fu, fv] = flowAt(f, x, y);
  const [gu, gv] = flowAt(g, x + fu, y + fv);
  return smoothstep(OCCLUSION[0], OCCLUSION[1], Math.hypot(fu + gu, fv + gv));
}

/**
 * The motion through in-between pixel (x, y) at position t and how to use
 * it: { u, v } (A to B), wa (share of frame A in the warped color; the
 * rest is B) and fallback (how far to fade toward the plain cross-fade).
 * a and b are the frames' luma at the flow size.
 */
export function pickMotion(a, b, fwd, bwd, x, y, t) {
  // The candidate whose two ends look most alike.
  let u = 0;
  let v = 0;
  let err = Infinity;
  for (const [cu, cv] of [...walk(fwd, x, y, t, false), ...walk(bwd, x, y, t, true)]) {
    const e = endError(a, b, x, y, t, cu, cv);
    if (e < err) [u, v, err] = [cu, cv, e];
  }
  // A's point hidden in B: B's sample shows the wrong thing (and the other way round).
  const occA = occlusion(fwd, bwd, x - t * u, y - t * v);
  const occB = occlusion(bwd, fwd, x + (1 - t) * u, y + (1 - t) * v);
  let wa = (1 - t) * (1 - occB);
  let wb = t * (1 - occA);
  if (wa + wb < 1e-4) {
    wa = 1 - t;
    wb = t;
  }
  const fallback = smoothstep(FALLBACK[0], FALLBACK[1], err) * (1 - Math.abs(occA - occB));
  return { u, v, wa: wa / (wa + wb), fallback };
}

/** One in-between pixel from frames a and b (luma here) along a picked motion. */
export function betweenPixel(a, b, fwd, bwd, x, y, t) {
  const m = pickMotion(a, b, fwd, bwd, x, y, t);
  const warped = m.wa * sample(a, x - t * m.u, y - t * m.v) + (1 - m.wa) * sample(b, x + (1 - t) * m.u, y + (1 - t) * m.v);
  const plain = (1 - t) * sample(a, x, y) + t * sample(b, x, y);
  return warped + (plain - warped) * m.fallback;
}

/** Whole in-between image (the CPU reference of the GPU's final pass). */
export function betweenImage(a, b, flows, t) {
  const out = image(a.w, a.h);
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) out.data[y * a.w + x] = betweenPixel(a, b, flows.fwd, flows.bwd, x, y, t);
  return out;
}

/** Plain cross-fade (frame blending). */
export function blendImage(a, b, t) {
  const out = image(a.w, a.h);
  for (let i = 0; i < out.data.length; i++) out.data[i] = (1 - t) * a.data[i] + t * b.data[i];
  return out;
}
