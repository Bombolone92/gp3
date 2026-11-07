import { describe, it, expect } from 'vitest';
import { fitBox, rotatedHalf, alignPosition, motionSamples, layerExtras, normalizeClipExtras, EXTRA_DEFAULTS } from '../src/model/clip-extras.js';
import { Compositor } from '../src/engine/compositor.js';
import { gradientDir } from '../src/engine/layer-extras.js';
import { createProject, makeClip } from '../src/model/project.js';
import { evaluate, motionStateAt } from '../src/engine/scene.js';
import * as T from '../src/model/timeline.js';
import { captureAttributes, applyAttributes } from '../src/ui/organize-actions.js';
import { US } from '../src/lib/time.js';

const layerBox = (layer, info, W = 1920, H = 1080) => Compositor.prototype.layerBox.call({ projW: W, projH: H }, layer, info);

describe('scale X / Y boxes', () => {
  it('stretches the layer box per axis', () => {
    const base = { kind: 'media', x: 0, y: 0, scale: 1, width: 1920, height: 1080, crop: null };
    expect(layerBox(base, { width: 1920, height: 1080 })).toEqual({ cx: 960, cy: 540, w: 1920, h: 1080 });
    expect(layerBox({ ...base, sx: 0.5, sy: 2, scale: 0.5 }, { width: 1920, height: 1080 })).toEqual({ cx: 960, cy: 540, w: 480, h: 1080 });
    // Text boxes stretch the same way.
    expect(layerBox({ kind: 'text', x: 0.25, y: 0, scale: 1, sx: 2 }, { projW: 100, projH: 40 })).toEqual({ cx: 1440, cy: 540, w: 200, h: 40 });
  });

  it('matches the compositor fit for media boxes', () => {
    const crop = { l: 0.25, t: 0, r: 0.25, b: 0 };
    const b = layerBox({ kind: 'media', x: 0, y: 0, scale: 1, crop }, { width: 1920, height: 1080 });
    expect(fitBox(1920, 1080, crop, 1920, 1080)).toEqual({ w: b.w, h: b.h });
    expect(fitBox(1080, 1920, null, 1920, 1080)).toEqual({ w: 607.5, h: 1080 });
  });
});

describe('align to frame', () => {
  it('puts the box edge on the frame edge', () => {
    // Half-size box: 960 x 540 in a 1920 x 1080 frame.
    expect(alignPosition('left', 960, 540, 0, 1920, 1080)).toEqual({ x: -0.25 });
    expect(alignPosition('right', 960, 540, 0, 1920, 1080)).toEqual({ x: 0.25 });
    expect(alignPosition('top', 960, 540, 0, 1920, 1080)).toEqual({ y: -0.25 });
    expect(alignPosition('bottom', 960, 540, 0, 1920, 1080)).toEqual({ y: 0.25 });
    expect(alignPosition('hcenter', 960, 540, 33, 1920, 1080)).toEqual({ x: 0 });
    expect(alignPosition('vcenter', 960, 540, 33, 1920, 1080)).toEqual({ y: 0 });
    expect(alignPosition('nope', 1, 1, 0, 1, 1)).toEqual({});
  });

  it('uses the rotated bounding box', () => {
    const { hw, hh } = rotatedHalf(400, 200, 90);
    expect(hw).toBeCloseTo(100);
    expect(hh).toBeCloseTo(200);
    const r45 = rotatedHalf(200, 200, 45);
    expect(r45.hw).toBeCloseTo(Math.SQRT2 * 100);
    const { x } = alignPosition('left', 400, 200, 90, 1920, 1080);
    // The rotated box is 200 wide, so its center sits 100 px from the left edge.
    expect(x * 1920 + 960).toBeCloseTo(100);
    const { y } = alignPosition('bottom', 400, 200, 90, 1920, 1080);
    expect(y * 1080 + 540).toBeCloseTo(1080 - 200);
  });
});

describe('motion blur samples', () => {
  const moving = (t) => ({ x: t / US, y: 0, scale: 1, rotation: 0, sx: 1, sy: 1 });
  const still = () => ({ x: 0.1, y: 0, scale: 1, rotation: 0, sx: 1, sy: 1 });

  it('samples the transform across the shutter, centered on the frame', () => {
    const s = motionSamples(moving, US, 30, 100);
    expect(s).toHaveLength(16);
    const span = (2 * US) / 30;
    expect(s[0].x).toBeCloseTo(1 - span / 2 / US);
    expect(s.at(-1).x).toBeCloseTo(1 + span / 2 / US);
    const mid = s.reduce((a, q) => a + q.x, 0) / s.length;
    expect(mid).toBeCloseTo(1);
    expect(motionSamples(moving, US, 30, 20)).toHaveLength(8);
  });

  it('skips clips that do not move or have no blur', () => {
    expect(motionSamples(still, US, 30, 80)).toBeNull();
    expect(motionSamples(moving, US, 30, 0)).toBeNull();
  });

  it('follows keyframes and animations through the scene', () => {
    const p = createProject();
    p.assets.a1 = { id: 'a1', kind: 'video', duration: 20 * US, width: 1920, height: 1080, hasAudio: false, hasVideo: true };
    const c = makeClip('video', { assetId: 'a1', start: 0, duration: 4 * US });
    c.keyframes.x = [{ t: 0, v: -0.5, ease: 'linear' }, { t: 4 * US, v: 0.5, ease: 'linear' }];
    c.motionBlur = { on: true, amount: 50 };
    T.mainTrack(p).clips.push(c);
    const [layer] = evaluate(p, 2 * US);
    expect(layer.extras.motion.length).toBeGreaterThan(4);
    expect(layer.extras.motion[0].x).toBeLessThan(layer.x);
    expect(layer.extras.motion.at(-1).x).toBeGreaterThan(layer.x);
    expect(motionStateAt(c, 2 * US).x).toBeCloseTo(layer.x);
    c.motionBlur.on = false;
    expect(evaluate(p, 2 * US)[0].extras).toBeNull();
  });
});

describe('picture extras', () => {
  it('normalizes only what was used', () => {
    expect(normalizeClipExtras({}, {})).toEqual({});
    const out = normalizeClipExtras({ canvas: { type: 'blur', blur: 500, color2: '#ABCDEF' }, relight: { on: false } }, {});
    expect(out.canvas).toMatchObject({ on: true, type: 'blur', blur: 100, color2: '#abcdef' });
    expect(out.relight).toEqual({ ...EXTRA_DEFAULTS.relight, on: false });
  });

  it('passes enabled extras to the layer, relight keyframed', () => {
    const clip = {
      keyframes: { 'relight.intensity': [{ t: 0, v: 0, ease: 'linear' }, { t: US, v: 100, ease: 'linear' }] },
      denoise: { on: true, strength: 50 },
      relight: { on: true, angle: 90, intensity: 40, temperature: 50 },
      canvas: { on: true, type: 'color', color: '#ff0000', color2: '#000000', angle: 0, blur: 50 },
    };
    const ex = layerExtras(clip, US / 2, 30, () => ({ x: 0, y: 0, scale: 1, rotation: 0 }));
    expect(ex.denoise).toBe(0.5);
    expect(ex.relight).toEqual({ angle: 90, intensity: 0.5, temperature: 0.5 });
    expect(ex.canvas).toMatchObject({ type: 'color', color: '#ff0000', blur: 0.5 });
    expect(ex.motion).toBeUndefined();
    expect(layerExtras(clip, 0, 30, () => ({})).relight).toBeUndefined();
    expect(layerExtras({}, 0, 30, () => ({}))).toBeNull();
  });

  it('copies picture settings and mask keys with paste attributes', () => {
    const src = makeClip('video', { assetId: 'a', duration: 2 * US });
    src.canvas = { ...EXTRA_DEFAULTS.canvas };
    src.masks = [{ type: 'ellipse', mode: 'add', x: 0, y: 0, w: 0.5, h: 0.5, rotation: 0, feather: 0, opacity: 1, invert: false }];
    src.keyframes['mask0.x'] = [{ t: 0, v: 0, ease: 'linear' }, { t: 2 * US, v: 1, ease: 'linear' }];
    const dst = makeClip('video', { assetId: 'a', duration: 4 * US });
    applyAttributes(dst, captureAttributes(src), ['mask', 'picture'], src.duration);
    expect(dst.canvas).toEqual(src.canvas);
    expect(dst.masks).toEqual(src.masks);
    expect(dst.keyframes['mask0.x'][1].t).toBe(4 * US);
  });

  it('turns gradient angles into directions', () => {
    const [x0, y0] = gradientDir(0);
    expect(x0).toBeCloseTo(0);
    expect(y0).toBeCloseTo(1);
    const [x1, y1] = gradientDir(90);
    expect(x1).toBeCloseTo(1);
    expect(y1).toBeCloseTo(0);
    const [x2, y2] = gradientDir(45);
    expect(Math.abs(x2) + Math.abs(y2)).toBeCloseTo(1);
  });
});
