import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/media/segmenter.js', () => ({
  SEG_SIZE: 256,
  segment: () => null,
  ready: vi.fn(() => Promise.resolve(false)),
  segmenterState: () => 'idle',
  segmenterError: () => '',
  onSegmenterChange: () => () => {},
}));

import { normalizeClip, makeClip, createProject } from '../src/model/project.js';
import { usesCutout } from '../src/engine/cutout.js';
import { evaluate } from '../src/engine/scene.js';
import { LAYER_FS } from '../src/engine/shaders.js';
import { captureAttributes, applyAttributes } from '../src/ui/organize-actions.js';
import { EditorStore } from '../src/model/store.js';
import { createActions } from '../src/ui/actions.js';
import { createInspector } from '../src/ui/inspector/index.js';
import * as T from '../src/model/timeline.js';
import { US } from '../src/lib/time.js';

describe('color region', () => {
  it('keeps only known values', () => {
    const base = makeClip('video', { assetId: 'a', duration: US });
    expect(normalizeClip({ ...base, colorTarget: 'person', maskUse: 'color' })).toMatchObject({ colorTarget: 'person', maskUse: 'color' });
    const odd = normalizeClip({ ...base, colorTarget: 'sky', maskUse: 'other' });
    expect('colorTarget' in odd).toBe(false);
    expect('maskUse' in odd).toBe(false);
  });

  it('reaches the layer, needs the matte for people, and copies with color and masks', () => {
    const p = createProject();
    p.assets.a = { id: 'a', kind: 'video', name: 'v.mp4', duration: 5 * US, width: 640, height: 360, fps: 30, hasVideo: true };
    const c = makeClip('video', { assetId: 'a', duration: 2 * US });
    T.mainTrack(p).clips.push(c);
    expect(usesCutout(p)).toBe(false);
    c.colorTarget = 'background';
    c.maskUse = 'color';
    expect(usesCutout(p)).toBe(true);
    const layer = evaluate(p, US / 2).find((l) => l.clip?.id === c.id);
    expect(layer).toMatchObject({ colorTarget: 'background', maskUse: 'color' });
    const d = makeClip('image', { assetId: 'b', duration: US });
    applyAttributes(d, captureAttributes(c), ['color', 'mask'], c.duration);
    expect(d).toMatchObject({ colorTarget: 'background', maskUse: 'color' });
  });

  it('blends graded and original color by region in the shader', () => {
    expect(LAYER_FS).toMatch(/mix\(before, grade\(c\.rgb, v_quad, u_texel\), region\)/);
    expect(LAYER_FS).toMatch(/u_maskColor == 1 \? 1\.0 : mk/);
  });
});

describe('color region controls', () => {
  let env;
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
    const p = createProject();
    p.assets.a = { id: 'a', kind: 'video', name: 'v.mp4', duration: 5 * US, width: 640, height: 360, fps: 30, hasVideo: true, hasAudio: false };
    const c = makeClip('video', { assetId: 'a', duration: 2 * US });
    T.mainTrack(p).clips.push(c);
    const store = new EditorStore(p);
    const ctx = { store };
    ctx.actions = createActions(ctx);
    const insp = createInspector(ctx);
    document.body.append(insp.el);
    store.select(c.id);
    env = { store, el: insp.el, id: c.id, insp };
  });
  afterEach(() => env.el.remove());
  const clip = () => T.findClip(env.store.project, env.id).clip;
  const radio = (label) => [...env.el.querySelectorAll('[role=radio]')].find((b) => b.textContent === label);

  it('sets where color applies and how masks are used', () => {
    env.insp.showTab('adjust');
    radio('Background').click();
    expect(clip().colorTarget).toBe('background');
    radio('Whole clip').click();
    expect(clip().colorTarget).toBeUndefined();
    env.insp.showVideoSub('mask');
    radio('Limit color').click();
    expect(clip().maskUse).toBe('color');
    radio('Show part').click();
    expect(clip().maskUse).toBeUndefined();
    env.store.undo();
    expect(clip().maskUse).toBe('color');
  });
});
