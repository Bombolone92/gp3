import { expect, it } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { normalizeJpegPadding } from '../src/core/jpeg.js';
import { embedImage } from '../src/core/document.js';
import { imagesToPdf } from '../src/core/image-pages.js';
import { prepareImageOrientation, jpegOrientation } from '../src/core/image-orientation.js';
import { padJpegHeaders, jpegExif, jpegTem } from './fixtures/jpeg-padding.js';

const canvas = createCanvas(200, 100),
  ctx = canvas.getContext('2d');
const colors = [
  [224, 0, 0],
  [0, 192, 0],
  [0, 0, 224],
  [224, 192, 0],
];
colors.forEach((color, i) => {
  ctx.fillStyle = `rgb(${color.join(',')})`;
  ctx.fillRect((i % 2) * 100, Math.floor(i / 2) * 50, 100, 50);
});
const jpeg = canvas.toBuffer('image/jpeg');
const orders = [
  [0, 1, 2, 3],
  [1, 0, 3, 2],
  [3, 2, 1, 0],
  [2, 3, 0, 1],
  [0, 2, 1, 3],
  [2, 0, 3, 1],
  [3, 1, 2, 0],
  [1, 3, 0, 2],
];

it.each([0, 1, 3])(
  'imports a JPEG with a TEM marker and %i fill bytes without reencoding',
  async (fill) => {
    const source = jpegTem(jpegTem(jpeg), fill);
    const before = Buffer.from(source);
    const decoded = await loadImage(source);
    expect([decoded.width, decoded.height]).toEqual([200, 100]);
    const doc = await PDFDocument.create();
    const image = await embedImage(doc, source);
    expect([image.width, image.height]).toEqual([200, 100]);
    await image.embed();
    expect(Buffer.from(doc.context.lookup(image.ref).getContents())).toEqual(jpeg);
    expect(source).toEqual(before);
  },
);

for (const count of [1, 2, 17])
  it(`imports JPEGs with ${count} fill bytes before each header marker without reencoding`, async () => {
    const source = padJpegHeaders(jpeg, count),
      before = Buffer.from(source);
    const doc = await PDFDocument.create();
    const image = await embedImage(doc, source);
    expect([image.width, image.height]).toEqual([200, 100]);
    await image.embed();
    expect(Buffer.from(doc.context.lookup(image.ref).getContents())).toEqual(jpeg);
    expect(source).toEqual(before);
  });

for (const tem of [false, true])
  for (const little of [false, true])
    for (let orientation = 1; orientation <= 8; orientation++)
      it(`preserves padded JPEG orientation ${orientation}, little endian ${little}, TEM ${tem}`, async () => {
        const padded = padJpegHeaders(jpegExif(jpeg, orientation, little));
        const source = tem ? jpegTem(padded, 2) : padded;
        const before = Buffer.from(source);
        expect(jpegOrientation(source)).toBe(orientation);
        expect(prepareImageOrientation(source).orientation).toBe(orientation);
        const bytes = await imagesToPdf([source]);
        expect(source).toEqual(before);
        const task = pdfjs.getDocument({ data: bytes.slice() });
        try {
          const page = await (await task.promise).getPage(1);
          const viewport = page.getViewport({ scale: 0.5 });
          expect(viewport.width < viewport.height).toBe(orientation >= 5);
          const output = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
          const context = output.getContext('2d');
          await page.render({ canvasContext: context, viewport, intent: 'print' }).promise;
          for (let i = 0; i < 4; i++) {
            const pixel = context.getImageData(
              output.width * (i % 2 ? 0.6 : 0.4),
              output.height * (i < 2 ? 0.4 : 0.6),
              1,
              1,
            ).data;
            colors[orders[orientation - 1][i]].forEach((value, channel) =>
              expect(Math.abs(pixel[channel] - value)).toBeLessThan(12),
            );
          }
        } finally {
          await task.destroy();
        }
      });

it('leaves ordinary JPEGs and other formats untouched', () => {
  for (const bytes of [jpeg, canvas.toBuffer('image/png'), new Uint8Array()])
    expect(normalizeJpegPadding(bytes)).toBe(bytes);
});

it('only removes marker fill, preserving marker-like metadata, compressed data, and trailing bytes', () => {
  const comment = Buffer.from([0xff, 0xfe, 0, 8, 0xff, 0xff, 0xe1, 0xff, 0, 0xff]);
  const original = Buffer.concat([
    jpeg.subarray(0, 2),
    comment,
    jpeg.subarray(2),
    Buffer.from([0xff, 0xff, 0xe1]),
  ]);
  for (const marker of [0xfe, 0xe0, 0xc0, 0xda]) {
    const padded = padJpegHeaders(original, 3, (value) => value === marker);
    // Offset views must not expose bytes belonging to the containing buffer.
    const container = Buffer.concat([Buffer.alloc(7), padded, Buffer.alloc(7)]);
    expect(Buffer.from(normalizeJpegPadding(container.subarray(7, -7)))).toEqual(original);
  }
});

it('removes TEM only at header marker boundaries, leaving metadata and scan bytes intact', () => {
  const comment = Buffer.from([0xff, 0xfe, 0, 6, 0xff, 1, 0xff, 1]);
  const original = Buffer.concat([
    jpeg.subarray(0, 2),
    comment,
    jpeg.subarray(2),
    Buffer.from([0xff, 1]),
  ]);
  const source = jpegTem(padJpegHeaders(original), 3);
  const container = Buffer.concat([Buffer.alloc(7), source, Buffer.alloc(7)]);
  expect(Buffer.from(normalizeJpegPadding(container.subarray(7, -7)))).toEqual(original);
});

it('rejects truncated and malformed padded JPEG headers without changing the source', async () => {
  const source = padJpegHeaders(jpegExif(jpeg, 6));
  const invalid = [
    ...[3, 4, 5, 7, 15, 30].map((length) => Uint8Array.from(source.subarray(0, length))),
    Uint8Array.from([255, 216, 255, 255, 225, 0, 1]),
    Uint8Array.from([255, 216, 255, 255, 0]),
    Uint8Array.from([255, 216, 255, 1]),
    Uint8Array.from([255, 216, 255, 1, 255]),
    Uint8Array.from([255, 216, 255, 1, 255, 225, 0, 1]),
  ];
  for (const bytes of invalid) {
    const before = bytes.slice();
    expect(() => prepareImageOrientation(bytes)).not.toThrow();
    await expect(embedImage(await PDFDocument.create(), bytes)).rejects.toThrow(
      'valid PNG or JPEG',
    );
    expect(bytes).toEqual(before);
  }
});
