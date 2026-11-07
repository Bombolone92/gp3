import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/media/segmenter.js', () => ({
  SEG_SIZE: 256,
  segment: () => null,
  ready: vi.fn(() => Promise.resolve(false)),
  segmenterState: () => 'idle',
  segmenterError: () => '',
  onSegmenterChange: () => () => {},
}));

import { BODY_EFFECTS, BODY_CATEGORY, isBodyEffect, clipUsesBodyEffect } from '../src/model/body-effects.js';
import { EFFECTS, EFFECT_CATEGORIES } from '../src/model/catalog.js';
import { effectDefaults } from '../src/model/effect-params.js';
import { effectShader } from '../src/engine/shaders.js';
import { effectPass } from '../src/engine/fx-render.js';
import { usesCutout } from '../src/engine/cutout.js';
import { createProject, makeClip } from '../src/model/project.js';
import { EditorStore } from '../src/model/store.js';
import { createActions } from '../src/ui/actions.js';
import { effectsTab } from '../src/ui/panels/effects.js';
import * as T from '../src/model/timeline.js';
import { US } from '../src/lib/time.js';

describe('body effects', () => {
  it('are in the catalog under their own category with shaders that read the matte', () => {
    expect(EFFECT_CATEGORIES).toContainEqual(BODY_CATEGORY);
    for (const e of BODY_EFFECTS) {
      expect(EFFECTS.find((x) => x.id === e.id)?.cat).toBe('body');
      expect(isBodyEffect(e.id)).toBe(true);
      expect(effectShader(e.id)).toMatch(/uniform sampler2D u_person/);
      expect(effectShader(e.id)).toMatch(/person(At|Edge|EdgeIn|Grow|Soft|Glow)\(/);
    }
    expect(isBodyEffect('blur')).toBe(false);
  });

  it('do nothing without a person matte (effect tracks)', () => {
    const comp = { gl: null };
    expect(effectPass(comp, 'body-outline', effectDefaults('body-outline'), {}, {})).toBe(false);
  });

  it('make the exporter load the model', () => {
    const p = createProject();
    p.assets.a = { id: 'a', kind: 'video', name: 'v.mp4', duration: 5 * US, width: 640, height: 360, fps: 30, hasVideo: true };
    const c = makeClip('video', { assetId: 'a', duration: 2 * US });
    T.mainTrack(p).clips.push(c);
    c.effects = [{ id: 'blur', params: effectDefaults('blur') }];
    expect(clipUsesBodyEffect(c)).toBe(false);
    expect(usesCutout(p)).toBe(false);
    c.effects.push({ id: 'body-aura', params: effectDefaults('body-aura') });
    expect(usesCutout(p)).toBe(true);
    c.effects[1].off = true;
    expect(usesCutout(p)).toBe(false);
  });
});

describe('adding body effects', () => {
  let env;
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
    const p = createProject();
    p.assets.a = { id: 'a', kind: 'video', name: 'v.mp4', duration: 5 * US, width: 640, height: 360, fps: 30, hasVideo: true, hasAudio: false };
    const v = makeClip('video', { assetId: 'a', duration: 2 * US });
    T.mainTrack(p).clips.push(v);
    const text = makeClip('text', { start: 0, duration: US, text: 'Hi' });
    T.addClip(p, text);
    const store = new EditorStore(p);
    const ctx = { store };
    ctx.actions = createActions(ctx);
    env = { store, ctx, v, text };
  });
  afterEach(() => document.body.replaceChildren());
  const clip = (id) => T.findClip(env.store.project, id).clip;

  it('go on video clips but not text clips', () => {
    expect(env.ctx.actions.addClipEffect(env.v.id, 'body-outline')).toBe(true);
    expect(clip(env.v.id).effects.map((e) => e.id)).toEqual(['body-outline']);
    expect(env.ctx.actions.addClipEffect(env.text.id, 'body-outline')).toBe(false);
    expect(clip(env.text.id).effects).toBeUndefined();
  });

  it('never become an effect track from the panel', () => {
    const tab = effectsTab(env.ctx);
    document.body.append(tab.el);
    [...tab.el.querySelectorAll('.asset-cat')].find((b) => b.textContent === 'Body').click();
    expect(tab.el.querySelector('.asset-hint').textContent).toMatch(/Select a video or image clip/);
    const tracks = env.store.project.tracks.length;
    const outline = tab.el.querySelector('button.tile[aria-label="Add Outline effect"]');
    expect(outline).toBeTruthy();
    outline.click();
    expect(env.store.project.tracks.length).toBe(tracks);
    expect(env.store.project.tracks.some((t) => t.clips.some((c) => c.type === 'effect'))).toBe(false);
    env.store.select(env.v.id);
    tab.shown();
    expect(tab.el.querySelector('.asset-hint').textContent).toMatch(/add it to the selected clip/);
    tab.dispose();
  });
});
