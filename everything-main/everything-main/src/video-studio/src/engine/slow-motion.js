/**
 * Smooth slow motion on the GPU (model/slow-motion.js has the clip option).
 *
 * A resolved source can carry between = { mode, frac, next }: next is the
 * texture info of the source frame after the shown one and frac the wanted
 * position between the two (0..1). Compositor._texture hands such a source
 * to betweenTexture, which draws the in-between frame into a pooled buffer
 * of the source's size and returns it in place of the plain upload, so
 * everything after (crop, color, masks, effects, transitions) sees one
 * ordinary picture.
 *   blend: cross-fade of the two frames.
 *   flow:  motion-compensated; the passes are the GPU form of the method
 *          in engine/optical-flow.js (same constants, same steps), run on
 *          half-float buffers. Without float render targets it blends.
 * Results are cached per source and position, so the several draws of one
 * layer in a frame (canvas fill, motion blur samples) compute it once.
 */
import { FULL_VS } from './shaders.js';
import { poolTarget } from './fx-render.js';
import {
  pyramidSizes, searchRadius, PATCH, SEARCH_WIDE, MOTION_PENALTY, LK_DAMPING, SMOOTH_RADIUS, SMOOTH_SIGMA,
  SMOOTH_LUMA, COST_FLOOR, WALK_STEPS, OCCLUSION, FALLBACK,
} from './optical-flow.js';

const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));

const HEAD = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
`;

/** Level sampling in pixel coordinates (centers on integers); R holds frame A, G frame B (u_swap flips them). */
const LEVEL = `
uniform sampler2D u_lum;
uniform vec2 u_size;
uniform int u_swap;
float la(vec2 p) { vec2 v = texture(u_lum, (p + 0.5) / u_size).rg; return u_swap == 1 ? v.y : v.x; }
float lb(vec2 p) { vec2 v = texture(u_lum, (p + 0.5) / u_size).rg; return u_swap == 1 ? v.x : v.y; }
`;

/** Cross-fade of the two frames. */
export const BLEND_FRAMES_FS = `${HEAD}
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_t;
void main() { outColor = mix(texture(u_a, v_uv), texture(u_b, v_uv), u_t); }`;

/** Luma of both frames at the flow size (four taps over each output pixel's footprint). */
export const LUMA_FS = `${HEAD}
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform vec2 u_texel;
const vec3 Y = vec3(0.2126, 0.7152, 0.0722);
vec2 tap(vec2 uv) { return vec2(dot(texture(u_a, uv).rgb, Y), dot(texture(u_b, uv).rgb, Y)); }
void main() {
  vec2 d = 0.25 * u_texel;
  vec2 s = tap(v_uv - d) + tap(v_uv + d) + tap(v_uv + vec2(d.x, -d.y)) + tap(v_uv + vec2(-d.x, d.y));
  outColor = vec4(0.25 * s, 0.0, 1.0);
}`;

/** Half-size pyramid level (see downsample in optical-flow.js). */
export const DOWN_FS = `${HEAD}
uniform sampler2D u_tex;
uniform vec2 u_srcTexel;
void main() {
  vec2 d = 0.5 * u_srcTexel;
  outColor = 0.25 * (texture(u_tex, v_uv - d) + texture(u_tex, v_uv + d) + texture(u_tex, v_uv + vec2(d.x, -d.y)) + texture(u_tex, v_uv + vec2(-d.x, d.y)));
}`;

const N = (2 * PATCH + 1) ** 2;

/** Match pass: best predicted candidate, then a window search (see match). */
export const MATCH_FS = `${HEAD}${LEVEL}
uniform sampler2D u_coarse;
uniform vec2 u_coarseSize;
uniform int u_hasCoarse;
uniform int u_radius;
float A[${N}];
float cost(vec2 p, vec2 m) {
  float s = 0.0;
  int k = 0;
  for (int oy = -${PATCH}; oy <= ${PATCH}; oy++) {
    for (int ox = -${PATCH}; ox <= ${PATCH}; ox++) {
      s += abs(A[k] - lb(p + vec2(float(ox), float(oy)) + m));
      k++;
    }
  }
  return s / ${f(N)};
}
vec2 coarseAt(vec2 q, vec2 r) { return texture(u_coarse, (q + 0.5) / u_coarseSize).rg * r; }
void main() {
  vec2 p = gl_FragCoord.xy - 0.5;
  int k = 0;
  for (int oy = -${PATCH}; oy <= ${PATCH}; oy++) {
    for (int ox = -${PATCH}; ox <= ${PATCH}; ox++) {
      A[k] = la(p + vec2(float(ox), float(oy)));
      k++;
    }
  }
  vec2 pred = vec2(0.0);
  vec2 best = pred;
  float bestC = cost(p, pred);
  float bestS = bestC;
  if (u_hasCoarse == 1) {
    vec2 r = u_size / u_coarseSize;
    vec2 c = (p + 0.5) / r - 0.5;
    pred = coarseAt(c, r);
    best = pred;
    bestC = cost(p, pred);
    bestS = bestC;
    vec2 nb[4] = vec2[4](vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0));
    for (int i = 0; i < 4; i++) {
      vec2 m = coarseAt(c + nb[i], r);
      float cc = cost(p, m);
      float s = cc + ${f(MOTION_PENALTY)} * length(m - pred);
      if (s < bestS) { best = m; bestC = cc; bestS = s; }
    }
  }
  vec2 base = best;
  for (int dy = -${SEARCH_WIDE}; dy <= ${SEARCH_WIDE}; dy++) {
    for (int dx = -${SEARCH_WIDE}; dx <= ${SEARCH_WIDE}; dx++) {
      if (abs(dx) > u_radius || abs(dy) > u_radius || (dx == 0 && dy == 0)) continue;
      vec2 m = base + vec2(float(dx), float(dy));
      float cc = cost(p, m);
      float s = cc + ${f(MOTION_PENALTY)} * length(m - pred);
      if (s < bestS) { best = m; bestC = cc; bestS = s; }
    }
  }
  outColor = vec4(best, bestC, 1.0);
}`;

/** Damped Lucas-Kanade step with the cost re-measured (see refine and lkStep). */
export const REFINE_FS = `${HEAD}${LEVEL}
uniform sampler2D u_flow;
void main() {
  vec2 p = gl_FragCoord.xy - 0.5;
  vec2 u = texture(u_flow, (p + 0.5) / u_size).rg;
  float hxx = 0.0, hxy = 0.0, hyy = 0.0, bx = 0.0, by = 0.0;
  vec2 ex = vec2(1.0, 0.0);
  vec2 ey = vec2(0.0, 1.0);
  for (int oy = -${PATCH}; oy <= ${PATCH}; oy++) {
    for (int ox = -${PATCH}; ox <= ${PATCH}; ox++) {
      vec2 q = p + vec2(float(ox), float(oy));
      float e = lb(q + u) - la(q);
      float gx = 0.25 * (la(q + ex) - la(q - ex) + lb(q + u + ex) - lb(q + u - ex));
      float gy = 0.25 * (la(q + ey) - la(q - ey) + lb(q + u + ey) - lb(q + u - ey));
      hxx += gx * gx;
      hxy += gx * gy;
      hyy += gy * gy;
      bx += gx * e;
      by += gy * e;
    }
  }
  float a = hxx + ${f(LK_DAMPING)};
  float c = hyy + ${f(LK_DAMPING)};
  float det = a * c - hxy * hxy;
  vec2 d = det > 1e-12 ? vec2(-(c * bx - hxy * by), -(a * by - hxy * bx)) / det : vec2(0.0);
  float len = length(d);
  if (len > 1.0) d /= len;
  u += d;
  float s = 0.0;
  for (int oy = -${PATCH}; oy <= ${PATCH}; oy++) {
    for (int ox = -${PATCH}; ox <= ${PATCH}; ox++) {
      vec2 q = p + vec2(float(ox), float(oy));
      s += abs(la(q) - lb(q + u));
    }
  }
  outColor = vec4(u, s / ${f(N)}, 1.0);
}`;

/** Edge-aware smoothing of the flow (see smooth). */
export const SMOOTH_FS = `${HEAD}${LEVEL}
uniform sampler2D u_flow;
float lumAt(ivec2 q) { vec2 v = texelFetch(u_lum, q, 0).rg; return u_swap == 1 ? v.y : v.x; }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = ivec2(u_size) - 1;
  float l0 = lumAt(p);
  vec3 acc = vec3(0.0);
  float sw = 0.0;
  for (int oy = -${SMOOTH_RADIUS}; oy <= ${SMOOTH_RADIUS}; oy++) {
    for (int ox = -${SMOOTH_RADIUS}; ox <= ${SMOOTH_RADIUS}; ox++) {
      ivec2 n = clamp(p + ivec2(ox, oy), ivec2(0), hi);
      vec3 fl = texelFetch(u_flow, n, 0).rgb;
      float dl = lumAt(n) - l0;
      float w = exp(-float(ox * ox + oy * oy) / ${f(2 * SMOOTH_SIGMA ** 2)} - dl * dl / ${f(2 * SMOOTH_LUMA ** 2)}) / (fl.b + ${f(COST_FLOOR)});
      acc += w * fl;
      sw += w;
    }
  }
  outColor = vec4(acc / sw, 1.0);
}`;

/** Motion through each in-between pixel and how to use it (see pickMotion). */
export const PICK_FS = `${HEAD}${LEVEL}
uniform sampler2D u_fwd;
uniform sampler2D u_bwd;
uniform float u_t;
vec2 F(vec2 q) { return texture(u_fwd, (q + 0.5) / u_size).rg; }
vec2 G(vec2 q) { return texture(u_bwd, (q + 0.5) / u_size).rg; }
float endError(vec2 p, vec2 m) {
  vec2 pa = p - u_t * m;
  vec2 pb = p + (1.0 - u_t) * m;
  float s = 0.0;
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 o = vec2(float(ox), float(oy));
      s += abs(la(pa + o) - lb(pb + o));
    }
  }
  return s / 9.0;
}
void main() {
  vec2 p = gl_FragCoord.xy - 0.5;
  float t = u_t;
  vec2 best = vec2(0.0);
  float err = 1e9;
  vec2 m = F(p);
  for (int i = 0; i <= ${WALK_STEPS}; i++) {
    if (i > 0) m = F(p - t * m);
    float e = endError(p, m);
    if (e < err) { err = e; best = m; }
  }
  m = -G(p);
  for (int i = 0; i <= ${WALK_STEPS}; i++) {
    if (i > 0) m = -G(p + (1.0 - t) * m);
    float e = endError(p, m);
    if (e < err) { err = e; best = m; }
  }
  vec2 pa = p - t * best;
  vec2 pb = p + (1.0 - t) * best;
  vec2 fa = F(pa);
  float occA = smoothstep(${f(OCCLUSION[0])}, ${f(OCCLUSION[1])}, length(fa + G(pa + fa)));
  vec2 gb = G(pb);
  float occB = smoothstep(${f(OCCLUSION[0])}, ${f(OCCLUSION[1])}, length(gb + F(pb + gb)));
  float wa = (1.0 - t) * (1.0 - occB);
  float wb = t * (1.0 - occA);
  if (wa + wb < 1e-4) { wa = 1.0 - t; wb = t; }
  float fallback = smoothstep(${f(FALLBACK[0])}, ${f(FALLBACK[1])}, err) * (1.0 - abs(occA - occB));
  outColor = vec4(best, wa / (wa + wb), fallback);
}`;

/** The in-between frame at the source's size along the picked motion (see betweenPixel). */
export const WARP_FS = `${HEAD}
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform sampler2D u_pick;
uniform vec2 u_flowSize;
uniform float u_t;
void main() {
  vec4 pk = texture(u_pick, v_uv);
  vec2 m = pk.rg / u_flowSize;
  vec4 warped = mix(texture(u_b, v_uv + (1.0 - u_t) * m), texture(u_a, v_uv - u_t * m), pk.b);
  vec4 plain = mix(texture(u_a, v_uv), texture(u_b, v_uv), u_t);
  outColor = mix(warped, plain, pk.a);
}`;

/** Whether half-float buffers can be rendered to (the flow needs them). */
function floatTargets(comp) {
  return Boolean(comp.gl.getExtension('EXT_color_buffer_float'));
}

function pass(comp, key, fs, target, uniforms, textures) {
  const p = comp._use(comp._program(key, FULL_VS, fs));
  comp._into(target);
  textures.forEach(([name, tex], i) => {
    comp._bindTex(i, tex);
    comp._seti(p, name, i);
  });
  for (const [name, v] of Object.entries(uniforms)) {
    if (typeof v === 'number' && name.startsWith('i:')) comp._seti(p, name.slice(2), v);
    else if (Array.isArray(v)) comp._set(p, name, v[0], v[1]);
    else comp._set(p, name, v);
  }
  comp._fullPass(p);
}

/** Flow from frame A to B (u_swap 0) or B to A (1) at every level; returns the finest. */
function estimateFlow(comp, levels, pyr, swap) {
  let coarse = null;
  for (let L = levels.length - 1; L >= 0; L--) {
    const { w, h } = levels[L];
    const size = [w, h];
    const lum = pyr[L].tex;
    let cur = poolTarget(comp, 'slowmo-t0', w, h, true);
    let other = poolTarget(comp, 'slowmo-t1', w, h, true);
    pass(comp, 'slowmo-match', MATCH_FS, cur, {
      u_size: size, 'i:u_swap': swap, 'i:u_hasCoarse': coarse ? 1 : 0, 'i:u_radius': searchRadius(w, h),
      u_coarseSize: coarse ? [coarse.w, coarse.h] : [1, 1],
    }, [['u_lum', lum], ['u_coarse', coarse ? coarse.tex : lum]]);
    for (let i = 0; i < (L === 0 ? 2 : 1); i++) {
      pass(comp, 'slowmo-refine', REFINE_FS, other, { u_size: size, 'i:u_swap': swap }, [['u_lum', lum], ['u_flow', cur.tex]]);
      [cur, other] = [other, cur];
    }
    const out = poolTarget(comp, `slowmo-f${L}-${swap}`, w, h, true);
    pass(comp, 'slowmo-smooth', SMOOTH_FS, out, { u_size: size, 'i:u_swap': swap }, [['u_lum', lum], ['u_flow', cur.tex]]);
    coarse = out;
  }
  return coarse;
}

/** Draw the flow-based in-between of textures a and b (w x h) at t into out. */
function drawFlow(comp, a, b, w, h, t, out) {
  const levels = pyramidSizes(w, h);
  const pyr = levels.map((l, i) => poolTarget(comp, `slowmo-l${i}`, l.w, l.h, true));
  pass(comp, 'slowmo-luma', LUMA_FS, pyr[0], { u_texel: [1 / levels[0].w, 1 / levels[0].h] }, [['u_a', a], ['u_b', b]]);
  for (let i = 1; i < levels.length; i++) {
    pass(comp, 'slowmo-down', DOWN_FS, pyr[i], { u_srcTexel: [1 / levels[i - 1].w, 1 / levels[i - 1].h] }, [['u_tex', pyr[i - 1].tex]]);
  }
  const fwd = estimateFlow(comp, levels, pyr, 0);
  const bwd = estimateFlow(comp, levels, pyr, 1);
  const { w: fw, h: fh } = levels[0];
  const pick = poolTarget(comp, 'slowmo-pick', fw, fh, true);
  pass(comp, 'slowmo-pick', PICK_FS, pick, { u_size: [fw, fh], 'i:u_swap': 0, u_t: t }, [['u_lum', pyr[0].tex], ['u_fwd', fwd.tex], ['u_bwd', bwd.tex]]);
  pass(comp, 'slowmo-warp', WARP_FS, out, { u_flowSize: [fw, fh], u_t: t }, [['u_a', a], ['u_b', b], ['u_pick', pick.tex]]);
}

/**
 * Texture entry ({ tex, w, h }) of the in-between frame for a resolved
 * source with between = { mode, frac, next }. Leaves the caller's target,
 * blending and active texture unit as they were, with the result bound on
 * that unit (as Compositor._texture does). Falls back to the plain frame
 * when the two frames cannot be paired.
 */
export function betweenTexture(comp, info) {
  const { mode, frac, next } = info.between;
  const ea = comp._texture({ ...info, between: null });
  if (!ea) return null;
  const gl = comp.gl;
  const unit = gl.getParameter(gl.ACTIVE_TEXTURE);
  const eb = comp._texture(next);
  if (!eb || eb.w !== ea.w || eb.h !== ea.h || !(ea.w > 1 && ea.h > 1)) {
    gl.bindTexture(gl.TEXTURE_2D, ea.tex);
    return ea;
  }
  const w = ea.w;
  const h = ea.h;
  const flow = mode === 'flow' && floatTargets(comp);
  const out = poolTarget(comp, `slowmo-out:${info.key}`, w, h);
  const sig = `${flow ? 'flow' : 'blend'}|${frac}|${ea.version}|${eb.version}`;
  const cache = (comp.slowmoCache ||= new Map());
  const hit = cache.get(info.key);
  if (!hit || hit.target !== out || hit.sig !== sig) {
    const back = comp._bound || null;
    const blendOn = gl.isEnabled(gl.BLEND);
    gl.disable(gl.BLEND);
    if (flow) drawFlow(comp, ea.tex, eb.tex, w, h, frac, out);
    else pass(comp, 'slowmo-blend', BLEND_FRAMES_FS, out, { u_t: frac }, [['u_a', ea.tex], ['u_b', eb.tex]]);
    comp._into(back);
    if (blendOn) gl.enable(gl.BLEND);
    cache.set(info.key, { target: out, sig });
    // Forget sources that left (their buffers leave the pool on their own).
    if (cache.size > 16) for (const k of [...cache.keys()].slice(0, cache.size - 16)) cache.delete(k);
  }
  gl.activeTexture(unit);
  gl.bindTexture(gl.TEXTURE_2D, out.tex);
  return { tex: out.tex, w, h, version: sig, ok: true, used: comp.frame };
}
