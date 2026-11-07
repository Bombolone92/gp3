// Offline mixdown of clips with a speed curve: length, time mapping, pitch.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { US } from '../src/lib/time.js';
import { createProject, makeTrack, makeClip } from '../src/model/project.js';
import * as T from '../src/model/timeline.js';
import { loadDsp } from '../src/media/dsp.js';
import { renderAudio } from '../src/engine/audio-mix.js';
import { defaultAudioFx } from '../src/model/audio.js';
import { presetPoints, curveDuration, localAtSource } from '../src/model/speed-curve.js';

const SR = 16000;

function synth(rate, seconds, fn) {
  const n = Math.round(rate * seconds);
  return {
    sampleRate: rate,
    async *read(startSec) {
      const block = 1000;
      let i = Math.max(0, Math.floor((startSec * rate) / block) * block);
      for (; i < n; i += block) {
        const len = Math.min(block, n - i);
        const a = new Float32Array(len);
        for (let k = 0; k < len; k++) a[k] = fn(i + k);
        yield { timestamp: i / rate, sampleRate: rate, channels: [a] };
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

/** A clip playing span seconds of source from inSec under a preset curve. */
function curved(preset, inSec, span, fields = {}) {
  const speedCurve = presetPoints(preset);
  return makeClip('audio', { assetId: 'a', start: 0, in: inSec * US, speedCurve, duration: Math.round(curveDuration(speedCurve, span * US)), ...fields });
}

function freqOf(a, from, to) {
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

// Source "ramp": each sample holds its own time (seconds / 100), so the mix shows where it read.
const ramp = () => synth(SR, 20, (i) => i / SR / 100);

beforeAll(async () => {
  await loadDsp(readFileSync(resolve(__dirname, '../src/media/dsp.wasm')));
});

describe('mixdown with a speed curve', () => {
  it('is as long as the curved clip and reads the source where the curve says', async () => {
    for (const preset of ['ramp-up', 'slow-middle', 'smash-cut']) {
      const c = curved(preset, 1, 4, { keepPitch: false });
      const { p, openSource } = project([c], { a: ramp() });
      const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 1, openSource });
      expect(channels[0].length).toBe(Math.round((c.duration * SR) / US));
      for (let k = 1; k < 20; k++) {
        const i = Math.floor((channels[0].length * k) / 20);
        const want = T.sourceTimeAt(c, (i * US) / SR) / US / 100;
        expect(channels[0][i]).toBeCloseTo(want, 5);
      }
    }
  });

  it('matches when the mix starts in the middle of the clip (range export)', async () => {
    const c = curved('pulse', 2, 4, { keepPitch: false });
    const { p, openSource } = project([c], { a: ramp() });
    const full = await renderAudio(p, null, { sampleRate: SR, channels: 1, openSource });
    const from = Math.round(c.duration * 0.4);
    const part = await renderAudio(p, null, { sampleRate: SR, channels: 1, start: from, openSource });
    const off = Math.round((from * SR) / US);
    for (const i of [10, 500, 3000, part.channels[0].length - 10]) expect(part.channels[0][i]).toBeCloseTo(full.channels[0][off + i], 4);
  });

  it('follows the curve through the effects stream too', async () => {
    const fx = defaultAudioFx();
    fx.pan = { on: true, value: 30 };
    const c = curved('ease', 1, 3, { keepPitch: false, audioFx: fx });
    const { p, openSource } = project([c], { a: ramp() });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 2, openSource });
    const ref = { ...c, id: 'ref' };
    delete ref.audioFx;
    const plain = project([ref], { a: ramp() });
    const flat = await renderAudio(plain.p, null, { sampleRate: SR, channels: 2, openSource: plain.openSource });
    // Panning is a fixed gain per side, so the panned mix is the plain one scaled: same read positions.
    const ratio = (i) => channels[0][i] / flat.channels[0][i];
    const r0 = ratio(Math.floor(channels[0].length / 8));
    expect(r0).toBeGreaterThan(0.3);
    for (const k of [3, 5, 8, 11, 13, 15]) expect(ratio(Math.floor((channels[0].length * k) / 16))).toBeCloseTo(r0, 3);
  });

  it('keeps the pitch while the speed changes', async () => {
    const c = curved('ramp-up', 1, 6);
    const { p, openSource } = project([c], { a: synth(SR, 20, (i) => 0.5 * Math.sin((2 * Math.PI * 400 * i) / SR)) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 1, openSource });
    const n = channels[0].length;
    // Slow start and fast end both sound at 400 Hz.
    expect(freqOf(channels[0], Math.round(n * 0.05), Math.round(n * 0.25))).toBeCloseTo(400, -1);
    expect(freqOf(channels[0], Math.round(n * 0.75), Math.round(n * 0.95))).toBeCloseTo(400, -1);
  });

  it('pitch-kept mix reaches a source moment when the curve does', async () => {
    // 200 Hz before source second 3, 500 Hz after; the switch lands where the curve reaches second 3.
    const c = curved('slow-middle', 1, 4);
    const { p, openSource } = project([c], { a: synth(SR, 20, (i) => 0.5 * Math.sin((2 * Math.PI * (i < 3 * SR ? 200 : 500) * i) / SR)) });
    const { channels } = await renderAudio(p, null, { sampleRate: SR, channels: 1, openSource });
    const at = Math.round((localAtSource(c, 2 * US) * SR) / US);
    const win = Math.round(0.15 * SR);
    expect(freqOf(channels[0], at - 2 * win, at - win / 2)).toBeCloseTo(200, -1);
    expect(freqOf(channels[0], at + win / 2, at + 2 * win)).toBeCloseTo(500, -1);
  });
});
