import { describe, it, expect } from 'vitest';
import { wavBytes, encodeWav, readWav } from '../src/media/wav.js';

const text = (v, off) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(off + i)));

describe('wavBytes', () => {
  it('writes a canonical 16-bit PCM header', () => {
    const buf = wavBytes([new Float32Array(10), new Float32Array(10)], 44100);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 10 * 2 * 2);
    expect(text(v, 0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
    expect(text(v, 8)).toBe('WAVE');
    expect(text(v, 12)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(44100 * 4);
    expect(v.getUint16(32, true)).toBe(4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(text(v, 36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(40);
  });

  it('interleaves channels and scales and clamps samples', () => {
    const l = Float32Array.from([0, 1, -1, 0.5, 2, NaN]);
    const r = Float32Array.from([-0.5, 0, 0, -2, 0.25, 0]);
    const v = new DataView(wavBytes([l, r], 8000));
    const s = (i) => v.getInt16(44 + i * 2, true);
    expect([s(0), s(1)]).toEqual([0, -16384]);
    expect([s(2), s(3)]).toEqual([32767, 0]);
    expect([s(4), s(5)]).toEqual([-32768, 0]);
    expect([s(6), s(7)]).toEqual([16384, -32768]);
    expect([s(8), s(9)]).toEqual([32767, 8192]);
    expect(s(10)).toBe(0);
  });

  it('accepts a single Float32Array and an AudioBuffer-like object', () => {
    const mono = Float32Array.from([0.1, -0.1, 0.2]);
    expect(new DataView(wavBytes(mono, 16000)).getUint16(22, true)).toBe(1);
    const fake = { numberOfChannels: 1, sampleRate: 22050, getChannelData: () => mono };
    const v = new DataView(wavBytes(fake));
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint32(40, true)).toBe(6);
  });

  it('round trips through readWav within 16-bit precision', () => {
    const src = Float32Array.from({ length: 64 }, (_, i) => Math.sin(i / 5) * 0.8);
    const { sampleRate, channels } = readWav(wavBytes([src], 16000));
    expect(sampleRate).toBe(16000);
    expect(channels[0].length).toBe(64);
    for (let i = 0; i < 64; i++) expect(Math.abs(channels[0][i] - src[i])).toBeLessThan(1 / 32000);
  });

  it('encodeWav returns an audio/wav Blob', () => {
    const blob = encodeWav([new Float32Array(4)], 44100);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(52);
  });

  it('rejects empty input', () => {
    expect(() => wavBytes([], 44100)).toThrow();
  });
});
