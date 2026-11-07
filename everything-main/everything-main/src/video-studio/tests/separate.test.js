import { describe, it, expect } from 'vitest';
import { Separator, centerWeight, ClipChain } from '../src/media/audio-fx.js';
import { normalizeAudioFx, chainSettings, ensureAudioFx, defaultAudioFx } from '../src/model/audio.js';

const SR = 48000;

/** A centered 440 Hz "voice" and a 1300 Hz "guitar" only on the left. */
function mix(n) {
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = 0.3 * Math.sin((2 * Math.PI * 440 * i) / SR);
    L[i] = v + 0.3 * Math.sin((2 * Math.PI * 1300 * i) / SR);
    R[i] = v;
  }
  return [L, R];
}

function level(x, f, from) {
  let re = 0;
  let im = 0;
  for (let i = from; i < x.length; i++) {
    re += x[i] * Math.cos((2 * Math.PI * f * i) / SR);
    im += x[i] * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return (Math.hypot(re, im) / (x.length - from)) * 2;
}

function run(mode, amount = 100) {
  const n = SR;
  const [L, R] = mix(n);
  const s = new Separator(SR, { mode, amount });
  for (let i = 0; i < n; i += 128) s.process(L.subarray(i, i + 128), R.subarray(i, i + 128), 128);
  return { voice: level(L, 440, n / 2), guitar: level(L, 1300, n / 2) };
}

describe('voice and music separation', () => {
  it('weighs centered, voice-range bins high and others low', () => {
    expect(centerWeight(1, 0, 1, 0, 1000)).toBeCloseTo(1, 2);
    expect(centerWeight(1, 0, 0, 0, 1000)).toBe(0);
    expect(centerWeight(1, 0, -1, 0, 1000)).toBeLessThan(0.01); // opposite phase
    expect(centerWeight(1, 0, 1, 0, 40)).toBe(0); // bass
    expect(centerWeight(1, 0, 1, 0, 14000)).toBe(0); // cymbals
    expect(centerWeight(0, 0, 0, 0, 1000)).toBe(0);
  });

  it('keeps the voice or the music of a stereo mix', () => {
    const v = run('voice');
    expect(v.voice).toBeGreaterThan(0.27);
    expect(v.guitar).toBeLessThan(0.02);
    const m = run('music');
    expect(m.voice).toBeLessThan(0.02);
    expect(m.guitar).toBeGreaterThan(0.27);
    const half = run('voice', 50);
    expect(half.guitar).toBeGreaterThan(0.1);
    expect(half.guitar).toBeLessThan(0.2);
  });

  it('is stored, normalized and turned into chain settings', () => {
    expect(normalizeAudioFx({ separate: { on: true, mode: 'odd', amount: 150 } }).separate).toEqual({ on: true, mode: 'voice', amount: 100 });
    const clip = { type: 'audio', audioFx: normalizeAudioFx({ separate: { on: true, mode: 'music', amount: 70 } }) };
    expect(chainSettings(clip).separate).toEqual({ mode: 'music', amount: 70 });
    const chain = new ClipChain(chainSettings(clip), SR);
    expect(chain.latency).toBeGreaterThan(0);
    const old = { audioFx: { normalize: defaultAudioFx().normalize } };
    expect(ensureAudioFx(old).separate).toEqual(defaultAudioFx().separate);
  });
});
