import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeSmoothSlow, slowsDown, smoothSlowAt, framePosition, needsBetween, FRAME_SNAP } from '../src/model/slow-motion.js';
import { createProject, makeClip, normalizeClip } from '../src/model/project.js';
import { presetPoints } from '../src/model/speed-curve.js';
import { sourceTimeAt } from '../src/model/timeline.js';
import * as T from '../src/model/timeline.js';
import { clipLayer } from '../src/engine/scene.js';
import { captureAttributes, applyAttributes } from '../src/ui/organize-actions.js';
import * as F from '../src/engine/optical-flow.js';
import * as G from '../src/engine/slow-motion.js';
import { EditorStore } from '../src/model/store.js';
import { createActions } from '../src/ui/actions.js';
import { createInspector } from '../src/ui/inspector/index.js';
import { US } from '../src/lib/time.js';

const video = (fields = {}) => makeClip('video', { assetId: 'a1', duration: 4 * US, ...fields });

describe('smooth slow motion option', () => {
  it('stores only blend or flow', () => {
    expect(normalizeSmoothSlow('blend')).toBe('blend');
    expect(normalizeSmoothSlow('flow')).toBe('flow');
    for (const v of ['off', '', null, undefined, 3, 'FLOW']) expect(normalizeSmoothSlow(v)).toBe(null);
  });

  it('survives normalization on video clips only', () => {
    expect(normalizeClip(video({ smoothSlow: 'flow' })).smoothSlow).toBe('flow');
    expect('smoothSlow' in normalizeClip(video({ smoothSlow: 'sideways' }))).toBe(false);
    expect('smoothSlow' in normalizeClip(video({ smoothSlow: 'flow', freeze: true }))).toBe(false);
    expect('smoothSlow' in normalizeClip(makeClip('audio', { assetId: 'a1', smoothSlow: 'flow' }))).toBe(false);
    // Kept at 1x so the choice comes back when the clip is slowed again.
    expect(normalizeClip(video({ smoothSlow: 'blend', speed: 1 })).smoothSlow).toBe('blend');
  });

  it('is offered for video clips slower than 1x somewhere', () => {
    expect(slowsDown(video({ speed: 0.5 }))).toBe(true);
    expect(slowsDown(video({ speed: 1 }))).toBe(false);
    expect(slowsDown(video({ speed: 2 }))).toBe(false);
    expect(slowsDown(video({ speed: 0.5, freeze: true }))).toBe(false);
    expect(slowsDown(makeClip('image', { speed: 0.5 }))).toBe(false);
    expect(slowsDown(makeClip('audio', { speed: 0.5 }))).toBe(false);
    // Curves: one that dips below 1x qualifies, one that never does not.
    expect(slowsDown(normalizeClip(video({ speedCurve: presetPoints('slow-middle') })))).toBe(true);
    expect(slowsDown(normalizeClip(video({ speedCurve: [{ t: 0, v: 1 }, { t: 0.5, v: 3 }, { t: 1, v: 1.5 }] })))).toBe(false);
  });

  it('acts only where the speed is below 1x', () => {
    expect(smoothSlowAt(video({ speed: 0.5 }), 0)).toBe(null);
    expect(smoothSlowAt(video({ speed: 0.5, smoothSlow: 'flow' }), US)).toBe('flow');
    expect(smoothSlowAt(video({ speed: 1, smoothSlow: 'flow' }), US)).toBe(null);
    // Slow middle: 2x at the ends, 0.3x in the middle.
    const c = normalizeClip(video({ speedCurve: presetPoints('slow-middle'), smoothSlow: 'blend' }));
    expect(smoothSlowAt(c, 0)).toBe(null);
    expect(smoothSlowAt(c, c.duration / 2)).toBe('blend');
    expect(smoothSlowAt(c, c.duration)).toBe(null);
  });
});

describe('position between source frames', () => {
  it('is the fraction of the way from one frame time to the next', () => {
    expect(framePosition(1.0, 1.0, 1.04)).toBe(0);
    expect(framePosition(1.01, 1.0, 1.04)).toBeCloseTo(0.25, 12);
    expect(framePosition(1.03, 1.0, 1.04)).toBeCloseTo(0.75, 12);
    expect(framePosition(2, 1.0, 1.04)).toBe(1);
    expect(framePosition(0.5, 1.0, 1.04)).toBe(0);
    expect(framePosition(1, 1, 1)).toBe(0);
  });

  it('skips the in-between frame on or next to a source frame', () => {
    expect(needsBetween(0)).toBe(false);
    expect(needsBetween(FRAME_SNAP / 2)).toBe(false);
    expect(needsBetween(0.5)).toBe(true);
    expect(needsBetween(1 - FRAME_SNAP / 2)).toBe(false);
  });

  /** Positions of the timeline frames of a clip over a 30 fps source grid. */
  const positions = (clip, fps = 30) => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const sec = sourceTimeAt(clip, Math.round((i * US) / fps)) / US;
      // Timeline times are whole microseconds: a hair before a frame counts as on it (FRAME_SNAP).
      const k = Math.floor(sec * 30 + FRAME_SNAP);
      out.push(framePosition(sec, k / 30, (k + 1) / 30));
    }
    return out;
  };

  it('steps evenly through the source frames at a constant slow speed', () => {
    const p = positions(video({ speed: 0.25 }));
    p.forEach((x, i) => expect(x).toBeCloseTo([0, 0.25, 0.5, 0.75][i % 4], 4));
    positions(video({ speed: 0.5 }), 60).forEach((x, i) => expect(x).toBeCloseTo([0, 0.25, 0.5, 0.75][i % 4], 4));
  });

  it('follows a speed curve: small steps where it is slow', () => {
    const c = normalizeClip(video({ speedCurve: presetPoints('slow-middle') }));
    const mid = { ...c, start: -c.duration / 2 }; // frame 0 at the middle (0.3x)
    const p = positions(mid);
    for (let i = 1; i < p.length; i++) {
      const step = (p[i] - p[i - 1] + 1) % 1;
      // About 0.3 of a source frame per timeline frame (the curve eases out of 0.3x).
      expect(step).toBeGreaterThan(0.25);
      expect(step).toBeLessThan(0.45);
    }
  });
});

describe('scene and attributes', () => {
  it('marks the layer of a slowed clip with the mode', () => {
    const p = createProject();
    p.assets.a1 = { id: 'a1', kind: 'video', width: 1920, height: 1080, duration: 20 * US, fps: 30 };
    expect(clipLayer(p, video({ speed: 0.5, smoothSlow: 'flow' }), US, 0).smoothSlow).toBe('flow');
    expect(clipLayer(p, video({ speed: 0.5 }), US, 0).smoothSlow).toBeUndefined();
    expect(clipLayer(p, video({ speed: 1.5, smoothSlow: 'flow' }), US, 0).smoothSlow).toBeUndefined();
  });

  it('copies with the speed group, onto video clips only', () => {
    const src = video({ speed: 0.5, smoothSlow: 'flow' });
    const dst = video();
    const speed = applyAttributes(dst, captureAttributes(src), ['speed'], src.duration);
    expect(speed).toBe(0.5);
    expect(dst.smoothSlow).toBe('flow');
    const sound = makeClip('audio', { assetId: 'a1' });
    applyAttributes(sound, captureAttributes(src), ['speed'], src.duration);
    expect('smoothSlow' in sound).toBe(false);
  });
});

/* Optical flow (CPU reference of the GPU passes) ------------------------------- */

const hash = (i, j, s) => {
  let n = (i * 374761393 + j * 668265263 + s * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
/** Smooth value noise: a textured picture defined everywhere (sub-pixel shifts are exact). */
const noise = (x, y, cell, s) => {
  const fx = x / cell;
  const fy = y / cell;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  let u = fx - i;
  let v = fy - j;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  return (hash(i, j, s) * (1 - u) + hash(i + 1, j, s) * u) * (1 - v) + (hash(i, j + 1, s) * (1 - u) + hash(i + 1, j + 1, s) * u) * v;
};
const backdrop = (x, y) => 0.15 + 0.5 * noise(x, y, 7, 1) + 0.3 * noise(x, y, 3, 2);
const render = (w, h, fn) => {
  const im = F.image(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) im.data[y * w + x] = fn(x, y);
  return im;
};
/** Mean absolute difference away from the borders. */
const mae = (p, q, m = 6) => {
  let s = 0;
  let n = 0;
  for (let y = m; y < p.h - m; y++) {
    for (let x = m; x < p.w - m; x++) {
      s += Math.abs(p.data[y * p.w + x] - q.data[y * p.w + x]);
      n++;
    }
  }
  return s / n;
};

describe('optical flow reference', () => {
  it('builds a pyramid from the flow size down to a small level', () => {
    const hd = F.pyramidSizes(1920, 1080);
    expect(hd[0]).toEqual({ w: F.FLOW_SIZE, h: 360 });
    expect(hd.map((l) => l.w)).toEqual([640, 320, 160, 80, 40]);
    expect(Math.max(hd.at(-1).w, hd.at(-1).h)).toBeLessThanOrEqual(2 * F.COARSE_SIZE);
    // Never upscaled; portrait keeps its shape.
    expect(F.pyramidSizes(320, 240)[0]).toEqual({ w: 320, h: 240 });
    expect(F.pyramidSizes(1080, 1920)[0]).toEqual({ w: 360, h: 640 });
    expect(F.searchRadius(640, 360)).toBe(F.SEARCH);
    expect(F.searchRadius(160, 90)).toBe(F.SEARCH_WIDE);
  });

  it('samples bilinearly with pixel centers on integers, clamped at the edges', () => {
    const im = F.image(2, 2, new Float32Array([0, 1, 2, 3]));
    expect(F.sample(im, 0, 0)).toBe(0);
    expect(F.sample(im, 0.5, 0)).toBe(0.5);
    expect(F.sample(im, 0.5, 0.5)).toBe(1.5);
    expect(F.sample(im, -3, 9)).toBe(2);
    expect(F.downsample(F.image(4, 4, new Float32Array(16).fill(0.25))).data.every((v) => Math.abs(v - 0.25) < 1e-7)).toBe(true);
  });

  it('solves the damped Lucas-Kanade step and caps it at a pixel', () => {
    // H = diag(2, 1), b = (-1, 0.5): d = -(H + damping)^-1 b
    const [du, dv] = F.lkStep(2, 0, 1, -1, 0.5, 0);
    expect(du).toBeCloseTo(0.5, 12);
    expect(dv).toBeCloseTo(-0.5, 12);
    const [cu, cv] = F.lkStep(0.01, 0, 0.01, -1, 0, 0);
    expect(Math.hypot(cu, cv)).toBeCloseTo(1, 12);
    expect(F.lkStep(0, 0, 0, 1, 1, 0)).toEqual([0, 0]);
  });

  it('recovers a sub-pixel shift and a large one', () => {
    for (const [dx, dy] of [[3.4, -1.7], [13.3, 4.2]]) {
      const w = 128;
      const h = 80;
      const a = render(w, h, backdrop);
      const b = render(w, h, (x, y) => backdrop(x - dx, y - dy));
      const { fwd, bwd } = F.flowPair(a, b);
      let eu = 0;
      let n = 0;
      for (let y = 16; y < h - 16; y++) {
        for (let x = 20; x < w - 20; x++) {
          const k = y * w + x;
          eu += Math.hypot(fwd.u[k] - dx, fwd.v[k] - dy) + Math.hypot(bwd.u[k] + dx, bwd.v[k] + dy);
          n += 2;
        }
      }
      expect(eu / n).toBeLessThan(0.15);
    }
  });

  it('draws in-between frames closer to the truth than blending, also around a moving object', () => {
    const w = 128;
    const h = 80;
    const fg = (x, y) => 0.2 + 0.6 * noise(x, y, 4, 9);
    // A textured square moving 9 pixels over a still backdrop (it covers and uncovers it).
    const at = (t) => render(w, h, (x, y) => {
      const cx = 45 + 9 * t;
      return Math.abs(x - cx) < 14 && Math.abs(y - 40) < 14 ? fg(x - cx, y - 40) : backdrop(x, y);
    });
    const shifted = (t) => render(w, h, (x, y) => backdrop(x - 6.5 * t, y + 2 * t));
    for (const scene of [at, shifted]) {
      const a = scene(0);
      const b = scene(1);
      const flows = F.flowPair(a, b);
      for (const t of [0.25, 0.5]) {
        const truth = scene(t);
        const flow = mae(F.betweenImage(a, b, flows, t), truth);
        const blend = mae(F.blendImage(a, b, t), truth);
        expect(flow).toBeLessThan(blend * 0.5);
      }
      // The ends are the frames themselves.
      expect(mae(F.betweenImage(a, b, flows, 0), a)).toBeLessThan(0.01);
    }
  });

  it('places the motion through an in-between point by walking the flow', () => {
    // Uniform flow: every step of the walk is that flow.
    const f = { w: 8, h: 8, u: new Float32Array(64).fill(2), v: new Float32Array(64).fill(-1), cost: new Float32Array(64) };
    for (const m of F.walk(f, 4, 4, 0.5, false)) expect(m).toEqual([2, -1]);
    for (const m of F.walk(f, 4, 4, 0.5, true)) expect(m).toEqual([-2, 1]);
    expect(F.walk(f, 4, 4, 0.5, false)).toHaveLength(F.WALK_STEPS + 1);
  });
});

describe('slow motion shaders', () => {
  const sources = { BLEND_FRAMES_FS: G.BLEND_FRAMES_FS, LUMA_FS: G.LUMA_FS, DOWN_FS: G.DOWN_FS, MATCH_FS: G.MATCH_FS, REFINE_FS: G.REFINE_FS, SMOOTH_FS: G.SMOOTH_FS, PICK_FS: G.PICK_FS, WARP_FS: G.WARP_FS };
  it.each(Object.entries(sources))('%s is GLSL ES 3.00 with the shared constants filled in', (name, src) => {
    expect(src.startsWith('#version 300 es\n')).toBe(true);
    expect(src.match(/\bvoid\s+main\s*\(\s*\)/g)).toHaveLength(1);
    expect(src).not.toMatch(/undefined|NaN|\$\{/);
    // Float literals only where floats are compared (no bare integers in float math).
    expect(src).not.toMatch(/smoothstep\(\d+,|\/ \d+\)/);
  });
});

/* Inspector ------------------------------------------------------------------- */

describe('speed tab option', () => {
  let env;
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
    const p = createProject();
    p.assets.a1 = { id: 'a1', kind: 'video', name: 'clip.mp4', duration: 20 * US, width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true };
    const v1 = makeClip('video', { assetId: 'a1', start: 0, duration: 4 * US, speed: 1 });
    T.mainTrack(p).clips.push(v1);
    const store = new EditorStore(p);
    const ctx = { store };
    ctx.actions = createActions(ctx);
    const insp = createInspector(ctx);
    document.body.append(insp.el);
    env = { store, insp, el: insp.el, id: v1.id };
  });
  afterEach(() => {
    env.insp.dispose();
    env.el.remove();
  });

  const tab = (name) => [...env.el.querySelectorAll('[role=tab]')].find((t) => t.textContent === name);
  const choice = (label) => [...env.el.querySelectorAll('.speed-smooth button')].find((b) => b.textContent === label);
  const clip = () => T.findClip(env.store.project, env.id).clip;

  it('is off at 1x and turns on once the clip is slowed', () => {
    env.store.select(env.id);
    tab('Speed').click();
    expect(env.el.querySelector('.speed-smooth').textContent).toContain('Smooth slow motion');
    expect(choice('Optical flow').disabled).toBe(true);
    env.store.update('Slow', (p) => T.setSpeed(p, env.id, 0.5));
    expect(choice('Optical flow').disabled).toBe(false);
    choice('Optical flow').click();
    expect(clip().smoothSlow).toBe('flow');
    expect(choice('Optical flow').getAttribute('aria-checked')).toBe('true');
    choice('Off').click();
    expect('smoothSlow' in clip()).toBe(false);
    env.store.undo();
    expect(clip().smoothSlow).toBe('flow');
  });
});
