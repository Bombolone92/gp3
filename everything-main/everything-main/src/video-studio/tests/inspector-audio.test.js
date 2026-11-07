// Details panel: sound sections, Voice tab and the pitch option.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EditorStore } from '../src/model/store.js';
import { createProject, makeClip } from '../src/model/project.js';
import { createActions } from '../src/ui/actions.js';
import { createInspector } from '../src/ui/inspector/index.js';
import { duckKeys } from '../src/ui/inspector/audio-fx.js';
import { soundClips, voiceGlyph } from '../src/ui/inspector/voice.js';
import { VOICE_PRESETS } from '../src/model/audio.js';
import * as T from '../src/model/timeline.js';
import { US } from '../src/lib/time.js';

HTMLCanvasElement.prototype.getContext = () => null;

let env;

function setup() {
  const p = createProject();
  p.assets.a1 = { id: 'a1', kind: 'video', name: 'clip.mp4', duration: 20 * US, width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true };
  p.assets.a3 = { id: 'a3', kind: 'audio', name: 'music.mp3', duration: 30 * US, width: 0, height: 0, fps: 0, hasAudio: true, hasVideo: false };
  const v1 = makeClip('video', { assetId: 'a1', start: 0, duration: 5 * US, name: 'One' });
  const v2 = makeClip('video', { assetId: 'a1', start: 5 * US, duration: 5 * US, name: 'Two' });
  T.mainTrack(p).clips.push(v1, v2);
  const aud = makeClip('audio', { assetId: 'a3', start: 0, duration: 8 * US });
  T.addClip(p, aud);
  const store = new EditorStore(p);
  let played = 0;
  const ctx = { store, player: { playing: false, play: () => played++, pause() {} } };
  ctx.actions = createActions(ctx);
  const insp = createInspector(ctx);
  document.body.append(insp.el);
  return { p, store, ctx, insp, el: insp.el, v1, v2, aud, played: () => played };
}

const clip = (id) => T.findClip(env.store.project, id).clip;
const field = (label) => [...env.el.querySelectorAll('.field')].find((f) => f.querySelector('.field-label')?.textContent === label);
const range = (label) => field(label).querySelector('input[type=range]');
const tab = (name) => [...env.el.querySelectorAll('[role=tab]')].find((t) => t.textContent === name);
const sw = (label) => env.el.querySelector(`[role=switch][aria-label="${label}"]`);
const button = (text) => [...env.el.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const tile = (label) => [...env.el.querySelectorAll('.voice-grid .choice')].find((b) => b.textContent === label);

function drag(input, values) {
  for (const v of values) {
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  env = setup();
});

afterEach(() => {
  env.insp.dispose();
  env.el.remove();
});

describe('audio clip tabs', () => {
  it('reads Basic, Voice and Speed', () => {
    env.store.select(env.aud.id);
    expect([...env.el.querySelectorAll('.top-tabs [role=tab]')].map((t) => t.textContent)).toEqual(['Basic', 'Voice', 'Speed']);
    expect(sw('Normalize loudness')).toBeTruthy();
    expect(sw('Reduce noise')).toBeTruthy();
    expect(sw('Enhance voice')).toBeTruthy();
    expect(button('Detect beats')).toBeTruthy();
    expect(button('Lower under speech')).toBeTruthy();
  });

  it('video clips get Basic and Voice sub-tabs under Audio', () => {
    env.store.select(env.v1.id);
    tab('Audio').click();
    expect([...env.el.querySelectorAll('.audio-tab .subtabs [role=tab]')].map((t) => t.textContent)).toEqual(['Basic', 'Voice']);
    expect(button('Lower under speech')).toBeUndefined(); // music-only tools stay on audio clips
    tab('Voice').click();
    expect(env.el.querySelectorAll('.voice-grid .choice')).toHaveLength(VOICE_PRESETS.length + 1);
  });
});

describe('sound sections', () => {
  it('pan: the switch turns it on and the slider sets it', () => {
    env.store.select(env.aud.id);
    sw('Pan').click();
    expect(clip(env.aud.id).audioFx.pan.on).toBe(true);
    sw('Pan').click();
    expect(clip(env.aud.id).audioFx.pan.on).toBe(false);
    drag(range('Pan'), [-20, -40]);
    expect(clip(env.aud.id).audioFx.pan).toEqual({ on: true, value: -40 });
    expect(sw('Pan').getAttribute('aria-checked')).toBe('true');
    env.store.undo();
    expect(clip(env.aud.id).audioFx.pan.on).toBe(false);
  });

  it('channels', () => {
    env.store.select(env.aud.id);
    const left = [...env.el.querySelectorAll('.fx-channels button')].find((b) => b.textContent === 'Left only');
    left.click();
    expect(clip(env.aud.id).audioFx.channel).toEqual({ on: true, mode: 'left' });
  });

  it('enhance amount and reset', () => {
    env.store.select(env.aud.id);
    drag(range('Amount'), [70, 80]);
    expect(clip(env.aud.id).audioFx.enhance).toEqual({ on: true, amount: 80 });
    env.el.querySelector('[aria-label="Reset Enhance voice"]').click();
    expect(clip(env.aud.id).audioFx.enhance).toEqual({ on: false, amount: 50 });
  });

  it('volume keyframes still work next to the new sections', () => {
    env.store.select(env.aud.id);
    env.store.seek(US);
    field('Volume').querySelector('.kf-btn').click();
    env.store.seek(3 * US);
    drag(range('Volume'), [-6]);
    const keys = clip(env.aud.id).keyframes.volume;
    expect(keys.map((k) => k.t)).toEqual([US, 3 * US]);
    expect(keys[1].v).toBeCloseTo(0.501, 2);
    expect(clip(env.aud.id).volume).toBe(1);
  });

  it('beats clear', () => {
    env.store.update('beats', (p) => {
      T.findClip(p, env.aud.id).clip.beats = [US, 2 * US, 3 * US];
    });
    env.store.select(env.aud.id);
    expect(env.el.textContent).toContain('3 beats');
    button('Clear').click();
    expect(clip(env.aud.id).beats).toBeUndefined();
  });
});

describe('voice tab', () => {
  it('picks an effect with a preview, adjusts it and undoes in steps', () => {
    env.store.select(env.aud.id);
    tab('Voice').click();
    tile('Android').click();
    expect(clip(env.aud.id).audioFx.voice).toEqual({ id: 'android', params: { tone: 80, mix: 80 } });
    expect(env.played()).toBe(1);
    expect(tile('Android').getAttribute('aria-checked')).toBe('true');
    drag(range('Tone'), [90, 120]);
    expect(clip(env.aud.id).audioFx.voice.params.tone).toBe(120);
    env.store.undo();
    expect(clip(env.aud.id).audioFx.voice.params.tone).toBe(80);
    env.store.undo();
    expect(clip(env.aud.id).audioFx?.voice ?? null).toBeNull();
    tile('Canyon').click();
    tile('Original').click();
    expect(clip(env.aud.id).audioFx.voice).toBeNull();
  });

  it('applies to all sound clips in one undo step', () => {
    env.store.select(env.aud.id);
    tab('Voice').click();
    tile('Concert Hall').click();
    button('Apply to all audio clips').click();
    for (const c of [env.aud, env.v1, env.v2]) expect(clip(c.id).audioFx.voice.id).toBe('hall');
    env.store.undo();
    expect(clip(env.v1.id).audioFx?.voice ?? null).toBeNull();
    expect(clip(env.aud.id).audioFx.voice.id).toBe('hall');
  });

  it('only sound clips get voices; glyphs render', () => {
    env.store.update('detach', (p) => {
      T.findClip(p, env.v2.id).clip.audioDetached = true;
    });
    expect(soundClips(env.store.project).map((c) => c.id).sort()).toEqual([env.aud.id, env.v1.id].sort());
    for (const p of VOICE_PRESETS) expect(voiceGlyph(p.id).querySelector('polyline').getAttribute('points')).not.toMatch(/NaN/);
  });
});

describe('speed pitch option', () => {
  it('toggles keepPitch', () => {
    env.store.select(env.aud.id);
    tab('Speed').click();
    const s = sw('Keep original pitch') || [...env.el.querySelectorAll('[role=switch]')].find((x) => x.closest('.field')?.textContent.includes('Keep original pitch'));
    expect(s.getAttribute('aria-checked')).toBe('true');
    s.click();
    expect(clip(env.aud.id).keepPitch).toBe(false);
    s.click();
    expect('keepPitch' in clip(env.aud.id)).toBe(false);
  });
});

describe('ducking keys', () => {
  it('multiplies the existing volume by the duck curve', () => {
    const c = makeClip('audio', { duration: 6 * US, volume: 0.5, keyframes: { volume: [{ t: 0, v: 1, ease: 'linear' }, { t: 6 * US, v: 1, ease: 'linear' }] } });
    const curve = [{ t: 0, g: 1 }, { t: 1, g: 1 }, { t: 1.25, g: 0.25 }, { t: 3, g: 0.25 }, { t: 3.6, g: 1 }, { t: 6, g: 1 }];
    const keys = duckKeys(c, curve);
    const at = (t) => keys.find((k) => k.t === t * US)?.v;
    expect(at(0)).toBe(1);
    expect(at(1.25)).toBeCloseTo(0.25, 6);
    expect(at(3)).toBeCloseTo(0.25, 6);
    expect(at(6)).toBe(1);
    // Without keys the base volume is used.
    const plain = duckKeys(makeClip('audio', { duration: 6 * US, volume: 0.5 }), curve);
    expect(plain.find((k) => k.t === 2 * US)).toBeUndefined();
    expect(plain.find((k) => k.t === 3 * US).v).toBeCloseTo(0.125, 6);
  });
});
