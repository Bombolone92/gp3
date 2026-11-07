import { describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { prepareImageOrientation, jpegOrientation } from '../src/core/image-orientation.js';
import { imagesToPdf } from '../src/core/image-pages.js';
import { crc32 } from '../src/core/split.js';
import { pngExif } from './fixtures/png-exif.js';

const colors = [
  [224, 0, 0],
  [0, 192, 0],
  [0, 0, 224],
  [224, 192, 0],
];
const order = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
  [3, 2, 1, 0],
  [2, 3, 0, 1],
  [0, 2, 1, 3],
  [2, 0, 3, 1],
  [3, 1, 2, 0],
  [1, 3, 0, 2],
];
const canvas = createCanvas(200, 100);
const context = canvas.getContext('2d');
colors.forEach((color, i) => {
  context.fillStyle = `rgb(${color.join(',')})`;
  context.fillRect((i % 2) * 100, Math.floor(i / 2) * 50, 100, 50);
});
const png = canvas.toBuffer('image/png');

describe('PNG EXIF orientation', () => {
  for (const little of [false, true]) {
    for (let orientation = 1; orientation <= 8; orientation++) {
      it(`preserves source pixels and metadata for orientation ${orientation}, little endian ${little}`, () => {
        const source = pngExif(png, orientation, little);
        const before = Buffer.from(source);
        const prepared = prepareImageOrientation(source);
        expect(prepared.orientation).toBe(orientation);
        expect(source).toEqual(before);
        expect(jpegOrientation(source)).toBe(1);
        // The whole output must match a freshly encoded chunk with orientation 1, including CRC.
        expect(Buffer.from(prepared.bytes)).toEqual(pngExif(png, 1, little));
        expect(prepareImageOrientation(prepared.bytes).orientation).toBe(1);
        if (orientation === 1) expect(prepared.bytes).toBe(source);
      });
    }
  }
  for (let orientation = 1; orientation <= 8; orientation++) {
    it(`prints orientation ${orientation} upright on a correctly oriented page`, async () => {
      const bytes = await imagesToPdf([pngExif(png, orientation)]);
      const doc = await PDFDocument.load(bytes);
      const { width, height } = doc.getPage(0).getSize();
      expect(width < height).toBe(orientation >= 5);
      const task = pdfjs.getDocument({ data: bytes.slice() });
      try {
        const page = await (await task.promise).getPage(1);
        const viewport = page.getViewport({ scale: 0.5 });
        const output = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
        const ctx = output.getContext('2d');
        await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
        // Samples around the center stay within the fitted picture in either page orientation.
        for (let i = 0; i < 4; i++) {
          const x = output.width * (i % 2 ? 0.6 : 0.4);
          const y = output.height * (i < 2 ? 0.4 : 0.6);
          expect(Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3)).toEqual(
            colors[order[orientation - 1][i]],
          );
        }
      } finally {
        await task.destroy();
      }
    });
  }
  it('walks chunks by their lengths and ignores orientation after image data', () => {
    const tagged = pngExif(png, 6);
    // Out-of-order eXIf must not change the orientation shown by browser decoders.
    const late = Buffer.concat([png.subarray(0, -12), tagged.subarray(33, 71), png.subarray(-12)]);
    expect(prepareImageOrientation(late)).toEqual({ bytes: late, orientation: 1 });
    const trailing = Buffer.concat([png, tagged.subarray(33, 71)]);
    expect(prepareImageOrientation(trailing)).toEqual({ bytes: trailing, orientation: 1 });
    const oversized = Buffer.from(tagged);
    oversized.writeUInt32BE(0xffffffff, 33);
    expect(prepareImageOrientation(oversized)).toEqual({ bytes: oversized, orientation: 1 });
    const unrelated = Buffer.from(tagged);
    unrelated.write('tEXt', 37);
    unrelated.writeUInt32BE(crc32(unrelated.subarray(37, 67)), 67);
    expect(prepareImageOrientation(unrelated)).toEqual({ bytes: unrelated, orientation: 1 });
  });
  it('ignores invalid, truncated, or corrupt metadata without changing the original image', () => {
    const invalid = [png, pngExif(png, 0), pngExif(png, 9)];
    const corrupt = pngExif(png, 6);
    corrupt[59] = 8; // Leave the checksum inconsistent.
    invalid.push(corrupt);
    for (const length of [8, 35, 40, 50, 70]) invalid.push(pngExif(png, 6).subarray(0, length));
    for (const [offset, value] of [
      [41, 0],
      [43, 0],
      [45, 255],
      [49, 0],
      [53, 4],
      [55, 2],
    ]) {
      const bytes = pngExif(png, 6);
      bytes[offset] = value;
      bytes.writeUInt32BE(crc32(bytes.subarray(37, 67)), 67);
      invalid.push(bytes);
    }
    for (const bytes of invalid)
      expect(prepareImageOrientation(bytes)).toEqual({ bytes, orientation: 1 });
  });
});
