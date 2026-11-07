import { describe, it, expect, beforeEach } from 'vitest';
import { clipPresets, presetsFor, makePreset, saveClipPreset, applyClipPreset, deleteClipPreset, presetMenu } from '../src/ui/clip-presets.js';
import { createProject, makeClip } from '../src/model/project.js';
import { EditorStore } from '../src/model/store.js';
import { createActions } from '../src/ui/actions.js';
import { effectDefaults } from '../src/model/effect-params.js';
import { setPref } from '../src/ui/prefs.js';
import * as T from '../src/model/timeline.js';
import { US } from '../src/lib/time.js';

let env;
beforeEach(() => {
  localStorage.clear();
  setPref('clipPresets', []);
  document.body.replaceChildren();
  const p = createProject();
  p.assets.a = { id: 'a', kind: 'video', name: 'v.mp4', duration: 9 * US, width: 640, height: 360, fps: 30, hasVideo: true, hasAudio: false };
  const src = makeClip('video', { assetId: 'a', duration: 2 * US });
  src.effects = [{ id: 'blur', params: effectDefaults('blur') }];
  src.adjust = { ...src.adjust, saturation: 40 };
  src.cutout = { feather: 10, shrink: 0, smooth: 40 };
  const dst = makeClip('video', { assetId: 'a', start: 2 * US, duration: 4 * US });
  T.mainTrack(p).clips.push(src, dst);
  const store = new EditorStore(p);
  const ctx = { store };
  ctx.actions = createActions(ctx);
  env = { store, ctx, src, dst };
});
const clip = (id) => T.findClip(env.store.project, id).clip;

describe('clip presets', () => {
  it('saves chosen settings through the dialog and applies them to other clips', () => {
    saveClipPreset(env.ctx, env.src.id);
    const d = document.querySelector('dialog[open]');
    const rows = [...d.querySelectorAll('.check-row')];
    for (const r of rows) {
      const box = r.querySelector('input');
      box.checked = ['Clip effects', 'Color adjustments'].includes(r.textContent);
    }
    d.querySelector('#preset-name').value = 'Dreamy';
    [...d.querySelectorAll('button')].find((b) => b.textContent === 'Save').click();
    const [p] = clipPresets();
    expect(p.name).toBe('Dreamy');
    expect(Object.keys(p.groups).sort()).toEqual(['color', 'effects']);
    env.store.select(env.dst.id);
    expect(applyClipPreset(env.ctx, p.id)).toBe(true);
    expect(clip(env.dst.id).effects.map((e) => e.id)).toEqual(['blur']);
    expect(clip(env.dst.id).adjust.saturation).toBe(40);
    expect(clip(env.dst.id).cutout).toBeUndefined();
    env.store.undo();
    expect(clip(env.dst.id).effects).toBeUndefined();
  });

  it('lists presets by clip type and removes them', () => {
    const p = makePreset(env.src, 'All of it');
    setPref('clipPresets', [p]);
    expect(presetsFor('video').map((x) => x.name)).toEqual(['All of it']);
    expect(presetsFor('effect')).toEqual([]);
    expect(presetMenu(env.ctx, env.dst)[0].label).toBe('All of it');
    deleteClipPreset(p.id);
    expect(clipPresets()).toEqual([]);
    expect(presetMenu(env.ctx, env.dst)[0].disabled).toBe(true);
  });
});
