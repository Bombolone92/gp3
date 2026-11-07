// Clip sound settings in the model and in the offline mixdown.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { US } from '../src/lib/time.js';
import { createProject, makeTrack, makeClip, normalizeClip, normalizeProject } from '../src/model/project.js';
import * as T from '../src/model/timeline.js';
import { loadDsp } from '../src/media/dsp.js';
import { renderAudio } from '../src/engine/audio-mix.js';
import { gainAt } from '../src/engine/scene.js';
import { defaultAudioFx, chainSettings, loudnessGain, needsStretch, beatTimes, normalizeAudioFx } from '../src/model/audio.js';
import { fixture, clip, onMain, s } from './helpers.js';

function synth(rate, seconds, fn, nch = 1) {
  const n = Math.round(rate * seconds);
  return {
    sampleRate: rate,
    async *read(startSec) {
      const block = 1000;
      let i = Math.max(0, Math.floor((startSec * rate) / block) * block);
      for (; i < n; i += block) {
        const len = Math.min(block, n - i);
        const channels = [];
        for (let c = 0; c < nch; c++) {
          const a = new Float32Array(len);
          for (let k = 0; k < len; k++) a[k] = fn(i + k, c);
          channels.push(a);
        }
        yield { timestamp: i / rate, sampleRate: rate, channels };
      }
    },
    close() {},
  };
}

function project(clips, sources) {
  const p = createProject();
  const audio = makeTrack('audio');
  for (const c of clips) {
    p.assets[c.assetId] ||= { id: c.assetId, kind: 'audio', name: c.assetId, hasAudio: true, duration: 60 * US };
    audio.clips.push(c);
  }
  p.tracks.push(audio);
  return { p, openSource: async (asset) => sources[asset.id] };
}

const SR = 16000;
const tone = (f, amp = 0.5) => (i) => amp * Math.sin((2 * Math.PI * f * i) / SR);

function freqOf(a, from = 0, to = a.length) {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = Math.max(1, from); i < to; i++) {
    if (a[i - 1] < 0 && a[i] >= 0) {
      const t = i - 1 + a[i - 1] / (a[i - 1] - a[i]);
      if (first < 0) first = t;
      else count++;
      last = t;
    }
  }
  return count ? (count * SR) / (last - first) : 0;
}

const rms = (a, from = 0, to = a.length) => {
  let x = 0;
  for (let i = from; i < to; i++) x += a[i] * a[i];
  return Math.sqrt(x / Math.max(1, to - from));
};

function withFx(fields, patch) {
  const fx = defaultAudioFx();
  for (const [k, v] of Object.entries(patch)) fx[k] = v && typeof v === 'object' && !Array.isArray(v) && fx[k] ? { ...fx[k], ...v } : v;
  return makeClip('audio', { assetId: 'a', start: 0, ...fields, audioFx: fx });
}

beforeAll(async () => {
  await loadDsp(readFileSync(resolve(__dirname, '../src/media/dsp.wasm')));
});

describe('mixdown with speed', () => {
  it('keeps pitch by default when the speed changes', async () => {
    const c = makeClip('audio', { assetId: 'a', start: 0, duration: 2 * US, speed: 2 });
    const { p, openSource } = project([c], { a: synth(SR, 10, tone(400)) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 1, openSource });
    expect(channels[0].length).toBe(2 * SR);
    expect(freqOf(channels[0], 2000, 2 * SR - 2000)).toBeCloseTo(400, -1);
    expect(rms(channels[0], 2000, 2 * SR - 2000)).toBeGreaterThan(0.3);
  });

  it('shifts pitch with speed when keepPitch is off', async () => {
    const c = makeClip('audio', { assetId: 'a', start: 0, duration: 2 * US, speed: 2, keepPitch: false });
    const { p, openSource } = project([c], { a: synth(SR, 10, tone(400)) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 1, openSource });
    expect(freqOf(channels[0], 2000, 2 * SR - 2000)).toBeCloseTo(800, -1);
  });

  it('slow motion keeps pitch too', async () => {
    const c = makeClip('audio', { assetId: 'a', start: 0, duration: 2 * US, speed: 0.5 });
    const { p, openSource } = project([c], { a: synth(SR, 10, tone(300)) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 2, openSource });
    expect(freqOf(channels[0], 2000, 2 * SR - 2000)).toBeCloseTo(300, -1);
  });

  it('stretched sound reads the source from the in point', async () => {
    // Source: 200 Hz for the first 5 s, 500 Hz after. Starting at 5 s at 2x hears only 500 Hz.
    const c = makeClip('audio', { assetId: 'a', start: 0, duration: US, in: 5 * US, speed: 2 });
    const { p, openSource } = project([c], { a: synth(SR, 10, (i) => 0.5 * Math.sin((2 * Math.PI * (i < 5 * SR ? 200 : 500) * i) / SR)) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 1, openSource });
    expect(freqOf(channels[0], 1000, SR - 1000)).toBeCloseTo(500, -1);
  });
});

describe('mixdown with effects', () => {
  it('pans hard right', async () => {
    const c = withFx({ duration: US }, { pan: { on: true, value: 100 } });
    const { p, openSource } = project([c], { a: synth(SR, 5, () => 0.5) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 2, openSource });
    expect(channels[0][SR / 2]).toBeCloseTo(0, 5);
    expect(channels[1][SR / 2]).toBeCloseTo(0.5, 5);
  });

  it('routes the left channel only', async () => {
    const c = withFx({ duration: US }, { channel: { on: true, mode: 'left' } });
    const { p, openSource } = project([c], { a: synth(SR, 5, (i, ch) => (ch === 0 ? 0.3 : 0.7), 2) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 2, openSource });
    expect(channels[0][100]).toBeCloseTo(0.3, 5);
    expect(channels[1][100]).toBeCloseTo(0.3, 5);
  });

  it('ignores disabled settings (no change to the sound)', async () => {
    const c = withFx({ duration: US }, { pan: { on: false, value: 100 }, enhance: { on: false, amount: 100 } });
    expect(chainSettings(c)).toBeNull();
    const { p, openSource } = project([c], { a: synth(SR, 5, () => 0.5) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 2, openSource });
    expect(channels[0][SR / 2]).toBeCloseTo(0.5, 5);
  });

  it('applies a voice preset with finite output of the right length', async () => {
    const c = withFx({ duration: 2 * US, start: US / 3 }, { voice: { id: 'android', params: { tone: 60, mix: 100 } } });
    const { p, openSource } = project([c], { a: synth(SR, 5, tone(300)) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 2, openSource });
    expect(channels[0].length).toBe(Math.round((2 + 1 / 3) * SR));
    expect(channels[0].every(Number.isFinite)).toBe(true);
    expect(channels[0][100]).toBe(0); // before the clip
    // Ring modulation moves energy away from 300 Hz: the waveform differs from the dry tone.
    let diff = 0;
    for (let i = SR; i < 2 * SR; i++) diff += Math.abs(channels[0][i] - tone(300)(i - Math.round(SR / 3)));
    expect(diff / SR).toBeGreaterThan(0.05);
  });

  it('compensates the noise reducer latency (sound stays in place)', async () => {
    const profile = new Array(32).fill(-200);
    const c = withFx({ duration: 2 * US }, { denoise: { on: true, amount: 10, profile } });
    const { p, openSource } = project([c], { a: synth(SR, 5, tone(1000)) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 1, openSource });
    for (let i = SR / 2; i < SR; i += 37) expect(channels[0][i]).toBeCloseTo(tone(1000)(i), 1);
  });

  it('gives the same sound for any chunk size', async () => {
    const make = () => withFx({ duration: 2 * US, start: 0.21 * US, speed: 1.3 }, { voice: { id: 'canyon', params: {} }, enhance: { on: true, amount: 70 } });
    const a = project([make()], { a: synth(SR, 9, tone(220)) });
    const b = project([make()], { a: synth(SR, 9, tone(220)) });
    const { mixChunks } = await import('../src/engine/audio-mix.js');
    const collect = async ({ p, openSource }, chunkSeconds) => {
      const out = [];
      for await (const ch of mixChunks(p, null, { sampleRate: SR, channels: 1, openSource, chunkSeconds })) out.push(...ch.channels[0]);
      return out;
    };
    const x = await collect(a, 1);
    const y = await collect(b, 0.37);
    expect(x.length).toBe(y.length);
    for (let i = 0; i < x.length; i += 53) expect(x[i]).toBeCloseTo(y[i], 4);
  });

  it('normalizes loudness as extra gain', async () => {
    const c = withFx({ duration: US }, { normalize: { on: true, target: -14, loudness: -20 } });
    expect(loudnessGain(c)).toBeCloseTo(10 ** (6 / 20), 6);
    expect(gainAt(c, US / 2)).toBeCloseTo(10 ** (6 / 20), 6);
    const { p, openSource } = project([c], { a: synth(SR, 5, () => 0.1) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 1, openSource });
    expect(channels[0][SR / 2]).toBeCloseTo(0.1 * 10 ** (6 / 20), 4);
  });
});

describe('model', () => {
  it('older clips load without sound settings', () => {
    const c = normalizeClip({ type: 'audio', id: 'x', start: 0, duration: US, assetId: 'a' });
    expect(c.audioFx).toBeUndefined();
    expect(c.keepPitch).toBeUndefined();
    expect(c.beats).toBeUndefined();
    expect(needsStretch({ ...c, speed: 2 })).toBe(true);
    expect(chainSettings(c)).toBeNull();
    expect(loudnessGain(c)).toBe(1);
  });

  it('validates sound settings', () => {
    const c = normalizeClip({
      type: 'video',
      id: 'v',
      duration: US,
      assetId: 'a',
      keepPitch: false,
      beats: [3, 'x', -1, 1],
      audioFx: {
        normalize: { on: true, target: -400, loudness: 'loud' },
        denoise: { on: 1, amount: 400, profile: [1, 2] },
        pan: { on: true, value: -300 },
        channel: { on: true, mode: 'sideways' },
        voice: { id: 'hall', params: { mix: 1000, junk: 4 } },
      },
    });
    expect(c.keepPitch).toBe(false);
    expect(c.beats).toEqual([1, 3]);
    expect(c.audioFx.normalize).toEqual({ on: true, target: -40, loudness: null });
    expect(c.audioFx.denoise).toEqual({ on: true, amount: 100, profile: null });
    expect(c.audioFx.pan.value).toBe(-100);
    expect(c.audioFx.channel.mode).toBe('stereo');
    expect(c.audioFx.voice).toEqual({ id: 'hall', params: { mix: 100, size: 80 } });
    expect(normalizeAudioFx({ voice: { id: 'nope' } }).voice).toBeNull();
    // Images never carry sound settings.
    expect(normalizeClip({ type: 'image', duration: US, audioFx: { pan: { on: true, value: 3 } } }).audioFx).toBeUndefined();
  });

  it('survives a project round trip', () => {
    const p = fixture();
    const a = clip('audio', 0, 4, { audioFx: { ...defaultAudioFx(), voice: { id: 'canyon', params: { time: 200, feedback: 30 } } }, keepPitch: false, beats: [s(1), s(2)] });
    p.tracks.push(makeTrack('audio', { clips: [a] }));
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    const b = back.tracks.find((t) => t.kind === 'audio').clips[0];
    expect(b.audioFx.voice).toEqual({ id: 'canyon', params: { time: 200, feedback: 30 } });
    expect(b.keepPitch).toBe(false);
    expect(b.beats).toEqual([s(1), s(2)]);
  });

  it('split, duplicate, paste and detach keep the settings', () => {
    const p = fixture();
    const fx = { ...defaultAudioFx(), enhance: { on: true, amount: 40 } };
    const [v] = onMain(p, clip('video', 0, 6, { audioFx: structuredClone(fx), keepPitch: false }));
    const right = T.splitClip(p, v.id, s(3));
    expect(right.audioFx).toEqual(fx);
    expect(right.keepPitch).toBe(false);
    right.audioFx.enhance.amount = 90;
    expect(v.audioFx.enhance.amount).toBe(40); // independent copies
    const dup = T.duplicateClip(p, v.id);
    expect(dup.audioFx).toEqual(fx);
    const [pasted] = T.pasteClips(p, [v], s(20));
    expect(pasted.audioFx).toEqual(fx);
    const audio = T.detachAudio(p, v.id);
    expect(audio.audioFx).toEqual(fx);
    expect(audio.keepPitch).toBe(false);
    expect(audio.audioFx).not.toBe(v.audioFx);
  });

  it('beats follow trims, splits and speed changes', () => {
    const p = fixture();
    const a = clip('audio', 2, 4, { in: s(1), beats: [s(1.5), s(2), s(3), s(10)] });
    p.tracks.push(makeTrack('audio', { clips: [a] }));
    expect(beatTimes(a)).toEqual([s(2.5), s(3), s(4)]);
    const right = T.splitClip(p, a.id, s(3.5));
    expect(beatTimes(a)).toEqual([s(2.5), s(3)]);
    expect(beatTimes(right)).toEqual([s(4)]);
    T.setSpeed(p, right.id, 2);
    // Right half: starts at 3.5 s, in = 2.5 s of source; the beat at source 3 s now comes 0.25 s in.
    expect(beatTimes(right)).toEqual([s(3.75)]);
    T.setSpeed(p, a.id, 2);
    expect(beatTimes(a)).toEqual([s(2.25), s(2.5)]);
  });

  it('beats are snap points but not edit points', () => {
    const p = fixture();
    const a = clip('audio', 0, 4, { beats: [s(1.25)] });
    p.tracks.push(makeTrack('audio', { clips: [a] }));
    expect(T.snapPoints(p)).toContain(s(1.25));
    expect(T.snapPoints(p, { beats: false })).not.toContain(s(1.25));
    expect(T.editPoint(p, 0, 1)).toBe(s(4));
  });
});
