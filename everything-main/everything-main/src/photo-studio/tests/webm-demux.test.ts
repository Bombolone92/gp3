import { describe, expect, it } from 'vitest';
import { muxWebm, vint } from '../src/imaging/codecs/webm';
import { demuxWebm, webCodecsCodec, webmFrameRate } from '../src/imaging/codecs/webm-demux';

const frame = (n: number, key: boolean, t: number) => ({ data: new Uint8Array([n, n + 1, n + 2]), timestampMs: t, key });

function idBytes(id: number) {
  const out: number[] = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255);
  return out;
}
const cat = (...parts: (Uint8Array | number[])[]) => {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};
const el = (id: number, ...body: (Uint8Array | number[])[]) => {
  const data = cat(...body);
  return cat(idBytes(id), vint(data.length), data);
};
const unknown = (id: number, ...body: (Uint8Array | number[])[]) => cat(idBytes(id), [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], ...body);

describe('WebM demuxer', () => {
  it('reads back what the muxer writes', () => {
    const frames = [frame(1, true, 0), frame(4, false, 40), frame(7, false, 80), frame(10, true, 120), frame(13, false, 160)];
    const file = demuxWebm(muxWebm(frames, { width: 64, height: 48, codec: 'V_VP9', frameRate: 25 }));
    expect(file.track).toMatchObject({ number: 1, codec: 'V_VP9', width: 64, height: 48, defaultDuration: 40_000_000 });
    expect(file.durationMs).toBeCloseTo(200);
    expect(file.frames.map((f) => [f.timestampMs, f.key, Array.from(f.data)])).toEqual(frames.map((f) => [f.timestampMs, f.key, Array.from(f.data)]));
    expect(webmFrameRate(file)).toBeCloseTo(25);
  });

  it('reads live recordings: unknown sizes, block groups, other tracks', () => {
    const block = (track: number, rel: number, flags: number, payload: number[]) => cat(vint(track), [(rel >> 8) & 255, rel & 255, flags], payload);
    const header = el(0x1a45dfa3, el(0x4282, new TextEncoder().encode('webm')));
    const tracks = el(
      0x1654ae6b,
      el(0xae, el(0xd7, [1]), el(0x83, [2]), el(0x86, new TextEncoder().encode('A_OPUS'))),
      el(0xae, el(0xd7, [2]), el(0x83, [1]), el(0x86, new TextEncoder().encode('V_VP8')), el(0xe0, el(0xb0, [0, 32]), el(0xba, [0, 16]), el(0x53c0, [1]))),
    );
    const info = el(0x1549a966, el(0x2ad7b1, [0x0f, 0x42, 0x40]));
    // Two clusters of unknown size; 1 ms timestamp scale.
    const c1 = unknown(0x1f43b675, el(0xe7, [0]), el(0xa3, block(2, 0, 0x80, [1])), el(0xa3, block(1, 0, 0x80, [99])), el(0xa0, el(0xa1, block(2, 33, 0, [2])), el(0xfb, [0x80])));
    const c2 = unknown(0x1f43b675, el(0xe7, [0, 66]), el(0xa0, el(0xa1, block(2, 0, 0, [3]))), el(0xa3, block(2, 33, 0, [4])));
    const bytes = cat(header, unknown(0x18538067, info, tracks, c1, c2));
    const file = demuxWebm(bytes);
    expect(file.track).toMatchObject({ number: 2, codec: 'V_VP8', width: 32, height: 16, alphaMode: 1 });
    expect(file.durationMs).toBeUndefined();
    expect(file.frames.map((f) => [f.timestampMs, f.key, f.data[0]])).toEqual([[0, true, 1], [33, false, 2], [66, true, 3], [99, false, 4]]);
    expect(webmFrameRate(file)).toBeCloseTo(1000 / 33);
  });

  it('rejects other files and maps codecs', () => {
    expect(() => demuxWebm(new Uint8Array([1, 2, 3, 4]))).toThrow();
    expect(() => demuxWebm(el(0x1a45dfa3, []))).toThrow();
    expect(webCodecsCodec('V_VP8')).toBe('vp8');
    expect(webCodecsCodec('V_MPEG4/ISO/AVC')).toBeUndefined();
  });
});
