import { describe, expect, it } from 'vitest';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { deflate } from 'pako';
import {
  buildPng,
  embedPngMetadata,
  insertPngChunks,
  makeItxtChunk,
  makeTextChunk,
  readPngChunks,
  readPngDpi,
  readPngIcc,
  readPngInfo,
  readPngText,
  verifyPngCrcs,
  makeSrgbChunk,
} from '../src/imaging/codecs/png-chunks';
import {
  ICC_CHUNK_SIZE,
  insertJpegIcc,
  readJpegDensity,
  readJpegExifOrientation,
  readJpegIcc,
  readJpegInfo,
  readJpegSegments,
  setJpegDensity,
  setJpegExifOrientation,
} from '../src/imaging/codecs/jpeg-markers';
import { buildSvg, cssBlendMode } from '../src/imaging/codecs/svg';
import { codecForExtension, codecForMime, codecs, sniffImageFormat } from '../src/imaging/codecs/sniff';
import { applyOrientation } from '../src/imaging/codecs/orientation';
import { encodeBmp } from '../src/imaging/codecs/bmp';
import { encodeTiff } from '../src/imaging/codecs/tiff';
import { encodeGif } from '../src/imaging/codecs/gif';
import { encodeIco } from '../src/imaging/codecs/ico';
import { encodeTga } from '../src/imaging/codecs/tga';
import { encodeNetpbm } from '../src/imaging/codecs/netpbm';
import { pseudoRandom } from './codecs-builders';

// Minimal real PNG: 3x2 RGBA, filter 0 rows, zlib via pako, CRCs via node:zlib.
function tinyPng(): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, zlibCrc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 3);
  new DataView(ihdr.buffer).setUint32(4, 2);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(2 * (1 + 12)).map((_, i) => (i % 13 === 0 ? 0 : i * 9));
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('sRGB', new Uint8Array([0])), chunk('IDAT', deflate(raw)), chunk('IEND', new Uint8Array(0))];
  return new Uint8Array(parts.flatMap((p) => Array.from(p)));
}
// Independent CRC check of every chunk using node:zlib.
function crcsValid(png: Uint8Array) {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p < png.length) {
    const len = dv.getUint32(p);
    if (zlibCrc32(png.subarray(p + 4, p + 8 + len)) !== dv.getUint32(p + 8 + len)) return false;
    p += 12 + len;
  }
  return p === png.length;
}

describe('PNG chunks', () => {
  it('inserts iCCP, pHYs and text with valid CRCs in spec order', () => {
    const png = tinyPng();
    expect(crcsValid(png)).toBe(true);
    const icc = new Uint8Array(5000).map((_, i) => (i * 31) & 255);
    const out = embedPngMetadata(png, { icc, iccName: 'Display P3', dpi: 300, text: { Software: 'Photo Studio', Title: 'Café ☕' } });
    expect(crcsValid(out)).toBe(true);
    expect(verifyPngCrcs(out)).toBe(true);
    const types = readPngChunks(out).map((c) => c.type);
    // iCCP replaces sRGB and sits right after IHDR; pHYs and text precede IDAT.
    expect(types).toEqual(['IHDR', 'iCCP', 'pHYs', 'tEXt', 'iTXt', 'IDAT', 'IEND']);
    const got = readPngIcc(out)!;
    expect(got.name).toBe('Display P3');
    expect(Array.from(got.profile)).toEqual(Array.from(icc));
    expect(readPngDpi(out)).toEqual({ x: 300, y: 300 });
    expect(readPngText(out)).toEqual({ Software: 'Photo Studio', Title: 'Café ☕' });
    expect(readPngInfo(out)).toEqual({ width: 3, height: 2, bitDepth: 8, colorType: 6, interlaced: false });
    // The image data is untouched.
    const idat = (b: Uint8Array) => Array.from(readPngChunks(b).find((c) => c.type === 'IDAT')!.data);
    expect(idat(out)).toEqual(idat(png));
  });

  it('replaces chunks instead of duplicating them and detects corruption', () => {
    const once = embedPngMetadata(tinyPng(), { dpi: 72, text: { A: '1' } });
    const twice = insertPngChunks(once, [readPngChunks(embedPngMetadata(tinyPng(), { dpi: 144 })).find((c) => c.type === 'pHYs')!, makeTextChunk('A', '2'), makeSrgbChunk(1)]);
    const types = readPngChunks(twice).map((c) => c.type);
    expect(types.filter((t) => t === 'pHYs').length).toBe(1);
    expect(types.filter((t) => t === 'sRGB').length).toBe(1);
    expect(readPngDpi(twice)).toEqual({ x: 144, y: 144 });
    expect(readPngText(twice)).toEqual({ A: '2' });
    const bad = twice.slice();
    bad[40] ^= 1;
    expect(verifyPngCrcs(bad)).toBe(false);
    expect(() => readPngChunks(new Uint8Array(10))).toThrow();
  });

  it('writes compressed iTXt and round trips through buildPng', () => {
    const c = makeItxtChunk('Description', 'x'.repeat(1000), { compress: true, language: 'en' });
    expect(c.data.length).toBeLessThan(100);
    const chunks = readPngChunks(tinyPng()).map((k) => ({ type: k.type, data: k.data }));
    chunks.splice(1, 0, c);
    const png = buildPng(chunks);
    expect(crcsValid(png)).toBe(true);
    expect(readPngText(png).Description).toBe('x'.repeat(1000));
  });
});

// Structurally valid baseline JPEG skeleton (marker functions never decode pixels).
function tinyJpeg(opts: { exif?: Uint8Array; jfif?: boolean } = {}): Uint8Array {
  const seg = (m: number, d: number[] | Uint8Array) => [0xff, m, (d.length + 2) >> 8, (d.length + 2) & 255, ...d];
  const out = [0xff, 0xd8];
  if (opts.jfif !== false) out.push(...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (opts.exif) out.push(...seg(0xe1, opts.exif));
  out.push(...seg(0xdb, [0, ...new Array(64).fill(1)]));
  out.push(...seg(0xc0, [8, 0, 16, 0, 24, 1, 1, 0x11, 0]));
  out.push(...seg(0xc4, [0, ...new Array(16).fill(0)]));
  out.push(...seg(0xda, [1, 1, 0, 0, 63, 0]));
  out.push(0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9);
  return new Uint8Array(out);
}
function exifBlock(orientation: number, le: boolean): Uint8Array {
  const u16 = (v: number) => (le ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v: number) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  return new Uint8Array([
    ...[0x45, 0x78, 0x69, 0x66, 0, 0],
    ...(le ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(2),
    // ImageWidth (LONG) first, then Orientation (SHORT).
    ...u16(0x0100), ...u16(4), ...u32(1), ...u32(24),
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0,
    ...u32(0),
  ]);
}

describe('JPEG markers', () => {
  it('splits a profile larger than 64 KB into numbered APP2 chunks after APP0/APP1', () => {
    const rnd = pseudoRandom(4);
    const profile = new Uint8Array(150000).map(() => Math.floor(rnd() * 256));
    const src = tinyJpeg({ exif: exifBlock(1, true) });
    const out = insertJpegIcc(src, profile);
    const { segments } = readJpegSegments(out);
    const app2 = segments.filter((s) => s.marker === 0xe2);
    expect(app2.length).toBe(3);
    expect(app2.map((s) => [s.data[12], s.data[13]])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(app2.map((s) => s.data.length - 14)).toEqual([ICC_CHUNK_SIZE, ICC_CHUNK_SIZE, 150000 - 2 * ICC_CHUNK_SIZE]);
    for (const s of app2) expect(s.data.length + 2).toBeLessThanOrEqual(65535);
    expect(segments.map((s) => s.marker).slice(0, 6)).toEqual([0xd8, 0xe0, 0xe1, 0xe2, 0xe2, 0xe2]);
    expect(Array.from(readJpegIcc(out)!)).toEqual(Array.from(profile));
    // Re-inserting replaces the old profile; entropy data is preserved byte for byte.
    const again = insertJpegIcc(out, new Uint8Array(10).fill(7));
    expect(readJpegSegments(again).segments.filter((s) => s.marker === 0xe2).length).toBe(1);
    expect(Array.from(readJpegIcc(again)!)).toEqual(new Array(10).fill(7));
    expect(Array.from(again.subarray(again.length - 7))).toEqual([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9]);
    expect(readJpegInfo(again)).toEqual({ bitsPerSample: 8, width: 24, height: 16, components: 1, progressive: false });
  });

  it('reads EXIF orientation in both byte orders and rewrites it', () => {
    for (const le of [true, false])
      for (const o of [1, 3, 6, 8]) {
        const j = tinyJpeg({ exif: exifBlock(o, le) });
        expect(readJpegExifOrientation(j)).toBe(o);
        expect(readJpegExifOrientation(setJpegExifOrientation(j, 1))).toBe(1);
      }
    expect(readJpegExifOrientation(tinyJpeg())).toBeUndefined();
  });

  it('sets JFIF density in place or adds a JFIF segment', () => {
    const a = setJpegDensity(tinyJpeg(), 300);
    expect(readJpegDensity(a)).toEqual({ x: 300, y: 300, unit: 'inch' });
    expect(a.length).toBe(tinyJpeg().length);
    const b = setJpegDensity(tinyJpeg({ jfif: false, exif: exifBlock(6, false) }), 96, 72);
    expect(readJpegDensity(b)).toEqual({ x: 96, y: 72, unit: 'inch' });
    expect(readJpegSegments(b).segments[1].marker).toBe(0xe0);
    expect(readJpegExifOrientation(b)).toBe(6);
  });
});

describe('SVG export', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 250, 251]);
  const svg = buildSvg({
    width: 640,
    height: 480.5,
    background: '#fff',
    title: 'Poster & "friends"',
    layers: [
      { kind: 'raster', name: 'Photo <1>', x: 10, y: 20, width: 300, height: 200, pngBytes: png, opacity: 0.75, blend: 'multiply', visible: true },
      { kind: 'path', name: 'Shape', d: 'M0 0L10 10Z', fill: '#f00', stroke: 'blue', strokeWidth: 2, opacity: 1, blend: 'colorDodge' },
      { kind: 'text', name: 'Caption', x: 5, y: 30, text: 'Line 1 & <b>\nLine "2"', font: 'Inter, sans-serif', size: 24, fill: '#000', opacity: 1 },
      { kind: 'path', name: 'Hidden', d: 'M1 1', opacity: 1, blend: 'normal', visible: false },
      { kind: 'path', name: 'Odd', d: 'M2 2', opacity: 0.5, blend: 'linearBurn' },
    ],
  });
  it('writes groups with opacity, blend modes and embedded base64 images', () => {
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('viewBox="0 0 640 480.5"');
    expect(svg).toContain(`xlink:href="data:image/png;base64,${Buffer.from(png).toString('base64')}"`);
    expect(svg).toContain('opacity="0.75" style="mix-blend-mode:multiply"');
    expect(svg).toContain('style="mix-blend-mode:color-dodge"');
    expect(svg).toContain('data-blend="linearBurn"');
    expect(svg).toContain('inkscape:label="Photo &lt;1&gt;"');
    expect(svg).toContain('<title>Poster &amp; &quot;friends&quot;</title>');
    expect(svg).toContain('<tspan x="5">Line 1 &amp; &lt;b&gt;</tspan><tspan x="5" dy="28.8">Line &quot;2&quot;</tspan>');
    expect(svg).not.toContain('Hidden');
    expect(svg).toContain('<rect width="100%" height="100%" fill="#fff"/>');
  });
  it('is well formed (balanced tags, no raw ampersands)', () => {
    const stack: string[] = [];
    for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
      if (m[1]) expect(stack.pop()).toBe(m[2]);
      else if (!m[3]) stack.push(m[2]);
    }
    expect(stack).toEqual([]);
    expect(/&(?!amp;|lt;|gt;|quot;|apos;)/.test(svg)).toBe(false);
  });
  it('maps blend names', () => {
    expect(cssBlendMode('Soft Light')).toBe('soft-light');
    expect(cssBlendMode('hard-light')).toBe('hard-light');
    expect(cssBlendMode('dissolve')).toBeNull();
    expect(cssBlendMode(undefined)).toBe('normal');
  });
});

describe('format sniffing and registry', () => {
  const rgba = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(200) };
  const ascii = (s: string) => new TextEncoder().encode(s);
  it('recognizes every signature', () => {
    const cases: [Uint8Array, string][] = [
      [tinyPng(), 'png'],
      [tinyJpeg(), 'jpeg'],
      [encodeGif(rgba), 'gif'],
      [encodeBmp(rgba), 'bmp'],
      [encodeTiff({ width: 2, height: 2, data: rgba.data, channels: 4 }, { compression: 'none' }), 'tiff'],
      [new Uint8Array([0x4d, 0x4d, 0, 0x2b, 0, 8, 0, 0]), 'bigtiff'],
      [new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]), 'tiff'],
      [encodeIco([{ rgba }]), 'ico'],
      [encodeIco([{ rgba }], { type: 'cur' }), 'cur'],
      [encodeTga(rgba), 'tga'],
      [encodeTga(rgba, { rle: true }).subarray(0, 40), 'tga'], // footer stripped: header heuristics
      [encodeNetpbm({ width: 2, height: 2, data: rgba.data, channels: 4 }), 'pnm'],
      [ascii('P6\n1 1\n255\nabc'), 'pnm'],
      [ascii('RIFF\x10\0\0\0WEBPVP8 '), 'webp'],
      [new Uint8Array([0, 0, 0, 0x1c, ...ascii('ftypavif'), 0, 0, 0, 0, ...ascii('avifmif1miaf')]), 'avif'],
      [new Uint8Array([0, 0, 0, 0x18, ...ascii('ftypmif1'), 0, 0, 0, 0, ...ascii('mif1heic')]), 'heic'],
      [new Uint8Array([0, 0, 0, 0x18, ...ascii('ftypheic'), 0, 0, 0, 0, ...ascii('mif1heic')]), 'heic'],
      [new Uint8Array([...ascii('8BPS'), 0, 1, 0, 0]), 'psd'],
      [new Uint8Array([...ascii('8BPS'), 0, 2, 0, 0]), 'psb'],
      [ascii('﻿  <?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="http://www.w3.org/2000/svg">'), 'svg'],
      [ascii('<svg width="1"></svg>'), 'svg'],
    ];
    for (const [bytes, fmt] of cases) expect([fmt, sniffImageFormat(bytes)]).toEqual([fmt, fmt]);
  });
  it('returns unknown for text, HTML and random bytes', () => {
    expect(sniffImageFormat(ascii('hello world, this is not an image at all'))).toBe('unknown');
    expect(sniffImageFormat(ascii('<html><body><svg></svg></body></html>'))).toBe('unknown');
    expect(sniffImageFormat(new Uint8Array(0))).toBe('unknown');
    const rnd = pseudoRandom(1);
    let hits = 0;
    for (let k = 0; k < 500; k++) {
      const b = new Uint8Array(2000).map(() => Math.floor(rnd() * 256));
      if (sniffImageFormat(b) !== 'unknown') hits++;
    }
    expect(hits).toBeLessThan(3);
  });
  it('describes formats by extension, MIME type and capability', () => {
    expect(codecForExtension('scan.TIF')?.format).toBe('tiff');
    expect(codecForExtension('photo.jpeg')?.write).toBe('browser');
    expect(codecForMime('image/x-icon')?.format).toBe('ico');
    expect(codecs.find((c) => c.format === 'gif')?.animation).toBe(true);
    for (const c of codecs) expect(c.extensions.length).toBeGreaterThan(0);
  });
});

describe('orientation', () => {
  // 3x2 image, pixel value = index + 1 in the red channel.
  const src = { width: 3, height: 2, data: new Uint8ClampedArray(24).map((_, i) => (i % 4 === 0 ? i / 4 + 1 : 255)) };
  const reds = (img: { data: Uint8ClampedArray }) => Array.from({ length: img.data.length / 4 }, (_, i) => img.data[i * 4]);
  it('rotates and flips per the TIFF orientation tag', () => {
    // Source rows: [1 2 3] [4 5 6].
    expect(reds(applyOrientation(src, 2))).toEqual([3, 2, 1, 6, 5, 4]);
    expect(reds(applyOrientation(src, 3))).toEqual([6, 5, 4, 3, 2, 1]);
    expect(reds(applyOrientation(src, 4))).toEqual([4, 5, 6, 1, 2, 3]);
    const r6 = applyOrientation(src, 6);
    expect([r6.width, r6.height]).toEqual([2, 3]);
    expect(reds(r6)).toEqual([4, 1, 5, 2, 6, 3]); // 90° clockwise
    expect(reds(applyOrientation(src, 8))).toEqual([3, 6, 2, 5, 1, 4]); // 90° counter-clockwise
    expect(reds(applyOrientation(src, 5))).toEqual([1, 4, 2, 5, 3, 6]);
    expect(reds(applyOrientation(src, 7))).toEqual([6, 3, 5, 2, 4, 1]);
    expect(applyOrientation(src, 1)).toBe(src);
  });
});
