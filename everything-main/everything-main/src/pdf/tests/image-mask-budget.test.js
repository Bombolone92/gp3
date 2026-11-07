import { expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { addImagePages } from '../src/core/image-pages.js';
import { embedOrientedImage } from '../src/core/document.js';

// Scale the byte budget down for a real PNG mask so this resource test needs
// only a tiny picture rather than allocating over 100 MB of noisy alpha data.
vi.mock('../src/core/document.js', async (importOriginal) => ({
  ...(await importOriginal()),
  MAX_FILE_SIZE: 512,
}));

it('includes encoded PNG transparency masks in the image payload budget', async () => {
  const canvas = createCanvas(16, 16);
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(16, 16);
  for (let i = 0; i < 256; i++) pixels.data[i * 4 + 3] = (i * 73 + Math.floor(i / 16) * 19) & 255;
  context.putImageData(pixels, 0, 0);
  const png = new Uint8Array(await canvas.encode('png'));
  const control = await PDFDocument.create();
  const image = await embedOrientedImage(control, png);
  await image.image.embed();
  const stream = control.context.lookup(image.image.ref);
  expect(stream.getContentsSize() * 20).toBeLessThan(512);
  expect(stream.dict.lookup(PDFName.of('SMask')).getContentsSize()).toBeGreaterThan(0);
  const doc = await PDFDocument.create();
  const read = vi.fn(async () => png);
  await expect(
    addImagePages(
      doc,
      Array.from({ length: 20 }, () => read),
    ),
  ).rejects.toThrow('These pictures would exceed');
  expect(read.mock.calls.length).toBeLessThan(20);
});
