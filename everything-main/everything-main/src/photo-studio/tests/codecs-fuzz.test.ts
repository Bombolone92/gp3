// Mutated fixtures must fail cleanly: no hangs, no runaway allocation.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeImage } from '../src/imaging/codecs/decode';
import { decodeTiff } from '../src/imaging/codecs/tiff';
import { readJpegExifOrientation, readJpegIcc, readJpegSegments } from '../src/imaging/codecs/jpeg-markers';
import { pseudoRandom } from './codecs-builders';

const dir = join(__dirname, 'fixtures', 'codecs');
const files = readdirSync(dir).filter((f) => /\.(tif|gif|bmp|ico|tga|ppm|pgm|pam|jpg)$/.test(f));

describe('decoder robustness', () => {
  it('survives random byte mutations and truncation of every fixture', () => {
    const rnd = pseudoRandom(2024);
    const errors = new Map<string, number>();
    for (const f of files) {
      const src = new Uint8Array(readFileSync(join(dir, f)));
      for (let k = 0; k < 150; k++) {
        const b = k % 5 === 4 ? src.slice(0, Math.floor(rnd() * src.length)) : src.slice();
        const flips = 1 + Math.floor(rnd() * 6);
        for (let j = 0; j < flips && b.length; j++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
        try {
          if (f.endsWith('.jpg')) readJpegSegments(b);
          else decodeImage(b, { decodePng: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) });
        } catch (e) {
          const name = e instanceof Error ? e.name : typeof e;
          if (name !== 'CodecError') console.log(f, e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : e);
          errors.set(name, (errors.get(name) ?? 0) + 1);
        }
      }
    }
    // Only our own error type may escape.
    expect([...errors.keys()]).toEqual(['CodecError']);
    expect(errors.get('CodecError')).toBeGreaterThan(100);
  }, 120000);

  it('rejects absurd dimensions before allocating', () => {
    // 1-bit TIFF claiming 100000 x 100000 pixels in a few bytes.
    const tiff = new Uint8Array(readFileSync(join(dir, 'pil-bilevel.tif')));
    const dv = new DataView(tiff.buffer);
    const ifd = dv.getUint32(4, true);
    const n = dv.getUint16(ifd, true);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      const tag = dv.getUint16(e, true);
      if (tag === 256 || tag === 257) {
        dv.setUint16(e + 2, 4, true);
        dv.setUint32(e + 8, 100000, true);
      }
    }
    expect(() => decodeTiff(tiff)).toThrow(/too large/);
  });

  it('keeps PNG and JPEG metadata readers safe on damaged input', () => {
    const rnd = pseudoRandom(77);
    const jpg = new Uint8Array(readFileSync(join(dir, 'pil-exif-icc.jpg')));
    for (let k = 0; k < 300; k++) {
      const b = jpg.slice(0, 400 + Math.floor(rnd() * (jpg.length - 400)));
      for (let j = 0; j < 4; j++) b[Math.floor(rnd() * 400)] = Math.floor(rnd() * 256);
      for (const fn of [readJpegExifOrientation, readJpegIcc]) {
        try {
          fn(b);
        } catch (e) {
          expect((e as Error).name).toBe('CodecError');
        }
      }
    }
  });
});
