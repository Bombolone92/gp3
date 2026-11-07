// Animated WebP container writer and reader, from the WebP container
// specification (RIFF "WEBP" with VP8X, ANIM and ANMF chunks). Frames are
// still WebP images (from the browser's encoder); their bitstream chunks
// (ALPH plus VP8 or VP8L) are copied into ANMF frames unchanged.
import { ByteWriter, CodecError, asciiAt } from './bytes';

export type RiffChunk = { fourcc: string; data: Uint8Array };

/** Top-level chunks of a RIFF/WEBP file. */
export function readWebpChunks(bytes: Uint8Array): RiffChunk[] {
  if (bytes.length < 12 || asciiAt(bytes, 0, 4) !== 'RIFF' || asciiAt(bytes, 8, 4) !== 'WEBP') throw new CodecError('Not a WebP file.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = Math.min(bytes.length, 8 + dv.getUint32(4, true));
  const out: RiffChunk[] = [];
  let p = 12;
  while (p + 8 <= end) {
    const size = dv.getUint32(p + 4, true);
    if (p + 8 + size > end) throw new CodecError('Truncated WebP chunk.');
    out.push({ fourcc: asciiAt(bytes, p, 4), data: bytes.subarray(p + 8, p + 8 + size) });
    p += 8 + size + (size & 1);
  }
  return out;
}

/** The image bitstream chunks of a still WebP (ALPH, VP8 or VP8L). */
export function stillBitstream(bytes: Uint8Array): RiffChunk[] {
  const chunks = readWebpChunks(bytes);
  if (chunks.some((c) => c.fourcc === 'ANIM' || c.fourcc === 'ANMF')) throw new CodecError('Expected a still WebP image.');
  const picked = chunks.filter((c) => c.fourcc === 'ALPH' || c.fourcc === 'VP8 ' || c.fourcc === 'VP8L');
  if (!picked.some((c) => c.fourcc !== 'ALPH')) throw new CodecError('The WebP image has no bitstream.');
  return picked;
}

function writeChunk(w: ByteWriter, fourcc: string, data: Uint8Array) {
  w.ascii(fourcc);
  w.u32le(data.length);
  w.bytes(data);
  if (data.length & 1) w.u8(0);
}
function u24(w: ByteWriter, v: number) {
  w.u8(v & 255);
  w.u8((v >> 8) & 255);
  w.u8((v >> 16) & 255);
}

export type WebpAnimFrame = {
  // A still WebP file holding this frame's pixels.
  webp: Uint8Array;
  // Frame placement on the canvas; X and Y must be even.
  x?: number;
  y?: number;
  width: number;
  height: number;
  delayMs: number;
  // Composite over the previous canvas (true) or replace the rectangle.
  blend?: boolean;
  // Clear the rectangle to the background after display.
  dispose?: boolean;
};
export type WebpAnimOptions = {
  width: number;
  height: number;
  // Number of plays; 0 repeats forever.
  plays?: number;
  // Background as [r, g, b, a]; viewers may ignore it.
  background?: [number, number, number, number];
};

export function muxAnimatedWebp(frames: WebpAnimFrame[], opts: WebpAnimOptions): Uint8Array {
  if (!frames.length) throw new CodecError('No frames to encode.');
  const { width, height } = opts;
  if (width < 1 || height < 1 || width > 16384 || height > 16384) throw new CodecError('WebP dimensions must be 1-16384.');
  const bodies = frames.map((f) => stillBitstream(f.webp));
  const alpha = bodies.some((b) => b.some((c) => c.fourcc === 'ALPH' || (c.fourcc === 'VP8L' && (c.data[4] & 0x10) !== 0)));
  const w = new ByteWriter(64 + frames.reduce((n, f) => n + f.webp.length + 32, 0));
  w.ascii('RIFF');
  w.u32le(0);
  w.ascii('WEBP');
  const vp8x = new ByteWriter(10);
  vp8x.u8(0x02 | (alpha ? 0x10 : 0));
  vp8x.pad(3);
  u24(vp8x, width - 1);
  u24(vp8x, height - 1);
  writeChunk(w, 'VP8X', vp8x.result());
  const anim = new ByteWriter(6);
  const [r, g, b, a] = opts.background ?? [0, 0, 0, 0];
  // Byte order blue, green, red, alpha.
  anim.u8(b);
  anim.u8(g);
  anim.u8(r);
  anim.u8(a);
  anim.u16le(Math.max(0, Math.min(65535, opts.plays ?? 0)));
  writeChunk(w, 'ANIM', anim.result());
  frames.forEach((f, i) => {
    const x = f.x ?? 0,
      y = f.y ?? 0;
    if (x & 1 || y & 1) throw new CodecError('WebP frame offsets must be even.');
    if (x + f.width > width || y + f.height > height) throw new CodecError('A WebP frame lies outside the canvas.');
    const body = new ByteWriter(f.webp.length + 16);
    u24(body, x / 2);
    u24(body, y / 2);
    u24(body, f.width - 1);
    u24(body, f.height - 1);
    u24(body, Math.max(0, Math.min(0xffffff, Math.round(f.delayMs))));
    body.u8((f.blend === false ? 0x02 : 0) | (f.dispose ? 0x01 : 0));
    for (const c of bodies[i]) writeChunk(body, c.fourcc, c.data);
    writeChunk(w, 'ANMF', body.result());
  });
  const out = w.result();
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

export type WebpAnimInfo = {
  width: number;
  height: number;
  plays: number;
  background: [number, number, number, number];
  frames: { x: number; y: number; width: number; height: number; delayMs: number; blend: boolean; dispose: boolean; chunks: string[] }[];
};
/** Read the structure of an animated WebP (not its pixels). */
export function readAnimatedWebp(bytes: Uint8Array): WebpAnimInfo {
  const chunks = readWebpChunks(bytes);
  const vp8x = chunks.find((c) => c.fourcc === 'VP8X');
  const anim = chunks.find((c) => c.fourcc === 'ANIM');
  if (!vp8x || vp8x.data.length < 10 || !(vp8x.data[0] & 0x02) || !anim || anim.data.length < 6) throw new CodecError('Not an animated WebP.');
  const r24 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16);
  const frames = chunks
    .filter((c) => c.fourcc === 'ANMF')
    .map((c) => {
      const d = c.data;
      const inner: string[] = [];
      let p = 16;
      while (p + 8 <= d.length) {
        const size = d[p + 4] | (d[p + 5] << 8) | (d[p + 6] << 16) | (d[p + 7] << 24);
        inner.push(asciiAt(d, p, 4));
        p += 8 + size + (size & 1);
      }
      return { x: r24(d, 0) * 2, y: r24(d, 3) * 2, width: r24(d, 6) + 1, height: r24(d, 9) + 1, delayMs: r24(d, 12), blend: !(d[15] & 0x02), dispose: !!(d[15] & 0x01), chunks: inner };
    });
  const a = anim.data;
  return { width: r24(vp8x.data, 4) + 1, height: r24(vp8x.data, 7) + 1, plays: a[4] | (a[5] << 8), background: [a[2], a[1], a[0], a[3]], frames };
}
