// Decodes files written by other encoders (ImageMagick 7, Pillow/libtiff);
// see tests/fixtures/codecs/generate.py for how each fixture was made.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeTiff } from '../src/imaging/codecs/tiff';
import { decodeGif } from '../src/imaging/codecs/gif';
import { decodeBmp } from '../src/imaging/codecs/bmp';
import { decodeIco } from '../src/imaging/codecs/ico';
import { decodeTga } from '../src/imaging/codecs/tga';
import { decodeNetpbm } from '../src/imaging/codecs/netpbm';
import { readJpegExifOrientation, readJpegIcc, readJpegInfo } from '../src/imaging/codecs/jpeg-markers';
import { sniffImageFormat } from '../src/imaging/codecs/sniff';
import { decodeImage } from '../src/imaging/codecs/decode';

const dir = join(__dirname, 'fixtures', 'codecs');
const load = (name: string) => new Uint8Array(readFileSync(join(dir, name)));
const W = 23;
const H = 17;
// Must match px() in generate.py.
const pattern = (x: number, y: number) => [(x * 16 + y * 3) & 255, (x * y * 5 + 40) & 255, ((x ^ y) * 9) & 255, Math.max(0, 255 - x * 7 - y * 3)];
const lo = (x: number, y: number) => (x * 13 + y * 7) & 255;
function expectPattern(data: Uint8ClampedArray, opts: { alpha?: boolean; tolerance?: (a: number) => number } = {}) {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const e = pattern(x, y);
      const o = (y * W + x) * 4;
      const a = opts.alpha === false ? 255 : e[3];
      expect(data[o + 3]).toBe(a);
      const tol = opts.tolerance ? opts.tolerance(a) : 0;
      for (let c = 0; c < 3; c++) if (Math.abs(data[o + c] - e[c]) > tol) throw new Error(`(${x},${y}) channel ${c}: ${data[o + c]} vs ${e[c]}`);
    }
}
const expectSame = (data: Uint8ClampedArray, ref: string) => expect(Buffer.from(data.buffer, data.byteOffset, data.length).equals(Buffer.from(load(ref)))).toBe(true);

describe('TIFF from libtiff writers', () => {
  it('16-bit big-endian RGB with LZW and predictor 2', () => {
    const p = decodeTiff(load('im-rgb16-be-lzw-pred.tif')).pages[0];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const e = pattern(x, y);
        const o = (y * W + x) * 4;
        expect([p.data16![o], p.data16![o + 1], p.data16![o + 2], p.data16![o + 3]]).toEqual([(e[0] << 8) | lo(x, y), (e[1] << 8) | lo(x, y), (e[2] << 8) | lo(x, y), 65535]);
      }
  });
  it('tiled planar RGBA with Deflate and predictor 2', () => {
    const p = decodeTiff(load('im-rgba-tiled-planar-zip.tif')).pages[0];
    expect([p.tiled, p.planar, p.alpha, p.predictor]).toEqual([true, true, 'unassociated', 2]);
    expectPattern(p.rgba8.data);
  });
  it('32-bit float with predictor 3', () => {
    const p = decodeTiff(load('im-gray-float-pred3.tif')).pages[0];
    expect([p.sampleFormat, p.predictor]).toEqual(['float', 3]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) expect(p.dataF32![(y * W + x) * 4]).toBe(Math.fround(pattern(x, y)[0] / 255));
  });
  it('BigTIFF', () => {
    const bytes = load('im-bigtiff.tif');
    expect(sniffImageFormat(bytes)).toBe('bigtiff');
    const res = decodeTiff(bytes);
    expect(res.bigTiff).toBe(true);
    expectPattern(res.pages[0].rgba8.data, { alpha: false });
  });
  it('CMYK, palette, bilevel and multi-page files from Pillow', () => {
    const cmyk = decodeTiff(load('pil-cmyk-packbits.tif')).pages[0];
    expect(cmyk.colorModel).toBe('cmyk');
    const n = W * H;
    for (let i = 0; i < n; i++) {
      const e = pattern(i % W, Math.floor(i / W));
      expect([cmyk.cmyk![i], cmyk.cmyk![n + i], cmyk.cmyk![2 * n + i], cmyk.cmyk![3 * n + i]]).toEqual([255 - e[0], 255 - e[1], 255 - e[2], 0]);
    }
    expectPattern(cmyk.rgba8.data, { alpha: false });
    const pal = decodeTiff(load('pil-palette-lzw.tif')).pages[0];
    expect(pal.colorModel).toBe('palette');
    expectSame(pal.rgba8.data, 'pil-palette-lzw.tif.rgba');
    const bil = decodeTiff(load('pil-bilevel.tif')).pages[0];
    expect(bil.colorModel).toBe('bilevel');
    expectSame(bil.rgba8.data, 'pil-bilevel.tif.rgba');
    const multi = decodeTiff(load('pil-multipage.tif'));
    expect(multi.pages.map((p) => p.colorModel)).toEqual(['rgb', 'gray']);
    expectPattern(multi.pages[0].rgba8.data, { alpha: false });
    const [r, g, b] = pattern(5, 3);
    expect(Math.abs(multi.pages[1].rgba8.data[(3 * W + 5) * 4] - (r * 299 + g * 587 + b * 114) / 1000)).toBeLessThanOrEqual(1);
  });
});

describe('GIF from ImageMagick and Pillow', () => {
  it('composites animation frames like ImageMagick -coalesce', () => {
    const res = decodeGif(load('im-anim.gif'));
    expect(res.frames.length).toBe(3);
    expect(res.frames.map((f) => f.delayMs)).toEqual([70, 120, 200]);
    expect(res.frames.map((f) => f.disposal)).toEqual([2, 3, 1]);
    // ImageMagick's -loop 2 (play twice) is stored as one repeat.
    expect(res.loopCount).toBe(1);
    const ref = load('im-anim.coalesced.rgba');
    res.frames.forEach((f, i) => {
      const exp = ref.subarray(i * W * H * 4, (i + 1) * W * H * 4);
      for (let p = 0; p < W * H; p++) {
        const a = f.rgba.data[p * 4 + 3];
        expect(a).toBe(exp[p * 4 + 3]);
        if (a) expect(Array.from(f.rgba.data.subarray(p * 4, p * 4 + 3))).toEqual(Array.from(exp.subarray(p * 4, p * 4 + 3)));
      }
    });
  });
  it('reads interlaced images', () => {
    const res = decodeGif(load('pil-interlaced.gif'));
    expect(res.frames[0].interlaced).toBe(true);
    expectSame(res.frames[0].rgba.data, 'pil-interlaced.gif.rgba');
  });
});

describe('BMP from ImageMagick and Pillow', () => {
  it('RLE8, RGB565, V5 alpha and 1-bit', () => {
    const rle = decodeBmp(load('im-rle8.bmp'));
    expect(rle.compression).toBe(1);
    expectSame(rle.rgba8.data, 'im-rle8.bmp.rgba');
    const r565 = decodeBmp(load('im-rgb565.bmp'));
    expect(r565.bitsPerPixel).toBe(16);
    // ImageMagick widens 5/6-bit fields by bit replication; we round exactly.
    const ref565 = load('im-rgb565.bmp.rgba');
    for (let i = 0; i < ref565.length; i++) expect(Math.abs(r565.rgba8.data[i] - ref565[i])).toBeLessThanOrEqual(1);
    const v5 = decodeBmp(load('im-v5-alpha.bmp'));
    expect([v5.headerSize, v5.hasAlpha]).toEqual([124, true]);
    expectPattern(v5.rgba8.data);
    const one = decodeBmp(load('pil-1bit.bmp'));
    expect(one.bitsPerPixel).toBe(1);
    expectSame(one.rgba8.data, 'pil-1bit.bmp.rgba');
  });
});

describe('ICO, TGA, Netpbm and JPEG from other encoders', () => {
  it('ICO with BMP entries (ImageMagick) and PNG entries (Pillow)', () => {
    const im = decodeIco(load('im-multi.ico'));
    expect(im.entries.map((e) => [e.format, e.width])).toEqual([
      ['bmp', 32],
      ['bmp', 16],
    ]);
    expectSame(im.entries[0].rgba!.data, 'im-multi.ico.0.rgba');
    const pil = decodeIco(load('pil-png.ico'));
    expect(pil.entries.every((e) => e.format === 'png' && e.png![1] === 0x50)).toBe(true);
    expect(pil.entries.map((e) => e.width).sort((a, b) => a - b)).toEqual([16, 32]);
  });
  it('TGA RLE and raw', () => {
    expectPattern(decodeTga(load('im-rle.tga')).rgba8.data);
    expectPattern(decodeTga(load('pil-rle.tga')).rgba8.data);
    const raw = decodeTga(load('pil-raw24.tga'));
    expect(raw.rle).toBe(false);
    expectPattern(raw.rgba8.data, { alpha: false });
  });
  it('Netpbm 16-bit PPM, plain PGM and PAM', () => {
    const ppm = decodeNetpbm(load('im-rgb16.ppm'));
    expect(ppm.maxval).toBe(65535);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const e = pattern(x, y);
        expect(ppm.data16![(y * W + x) * 4 + 1]).toBe((e[1] << 8) | lo(x, y));
      }
    const pgm = decodeNetpbm(load('im-plain.pgm'));
    expect(pgm.ascii).toBe(true);
    expectSame(pgm.rgba8.data, 'im-plain.pgm.rgba');
    expectPattern(decodeNetpbm(load('im-rgba.pam')).rgba8.data);
  });
  it('JPEG EXIF orientation and ICC profile written by Pillow', () => {
    const jpg = load('pil-exif-icc.jpg');
    expect(readJpegExifOrientation(jpg)).toBe(6);
    const icc = readJpegIcc(jpg)!;
    expect(icc.length).toBe(768);
    expect(Array.from(icc.subarray(250, 260))).toEqual([250, 251, 252, 253, 254, 255, 0, 1, 2, 3]);
    expect(readJpegInfo(jpg)).toMatchObject({ width: W, height: H, components: 3 });
  });
});

describe('decodeImage dispatcher', () => {
  it('routes each fixture to its codec and leaves browser formats alone', () => {
    const multi = decodeImage(load('pil-multipage.tif'))!;
    expect([multi.format, multi.width, multi.tiffPages?.length]).toEqual(['tiff', W, 2]);
    expect(multi.notes.join(' ')).toMatch(/2 pages/);
    const cmyk = decodeImage(load('pil-cmyk-packbits.tif'))!;
    expect(cmyk.notes.join(' ')).toMatch(/CMYK/);
    const gif = decodeImage(load('im-anim.gif'))!;
    expect(gif.gifFrames?.length).toBe(3);
    expect(decodeImage(load('im-rgb16-be-lzw-pred.tif'))!.data16).toBeDefined();
    expect(decodeImage(load('im-multi.ico'))!.width).toBe(32);
    expect(() => decodeImage(load('pil-png.ico'))).toThrow(/PNG/);
    expect(decodeImage(load('pil-png.ico'), { decodePng: () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) }) })!.width).toBe(1);
    for (const f of ['im-rle.tga', 'im-rgba.pam', 'im-v5-alpha.bmp']) expect(decodeImage(load(f))!.rgba8.data.length).toBe(W * H * 4);
    expect(decodeImage(load('pil-exif-icc.jpg'))).toBeNull();
  });
});
