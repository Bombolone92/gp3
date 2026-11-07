import { afterEach, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { imagesToPdf, addImagePages } from '../src/core/image-pages.js';
import { MAX_FILE_SIZE, MAX_IMAGE_SIZE, PdfSession, blankPdf } from '../src/core/document.js';
import { jpegMetadata, pngMetadata } from './fixtures/image-metadata.js';

async function picture(format) {
  const canvas = createCanvas(4, 3);
  const context = canvas.getContext('2d');
  context.fillStyle = '#d02020';
  context.fillRect(0, 0, 4, 3);
  return new Uint8Array(await canvas.encode(format));
}
afterEach(() => vi.restoreAllMocks());

it('stops an impossible JPEG batch before serialization or reading its remaining sources', async () => {
  const bytes = jpegMetadata(await picture('jpeg'), 14 * 1024 * 1024);
  expect(bytes.length).toBeLessThan(MAX_IMAGE_SIZE);
  const read = vi.fn(async () => bytes);
  const save = vi.spyOn(PDFDocument.prototype, 'save').mockImplementation(async () => {
    throw new Error('Oversized batch reached serialization');
  });
  await expect(imagesToPdf(Array.from({ length: 12 }, () => read))).rejects.toThrow(
    'These pictures would exceed the 100 MB PDF limit.',
  );
  expect(read).toHaveBeenCalledTimes(8);
  expect(save).not.toHaveBeenCalled();
});

it('rejects an oversized picture insertion without changing the working copy or its history', async () => {
  const session = new PdfSession(await blankPdf());
  await session.change((doc) => doc.addPage());
  session.markSaved();
  const original = session.bytes.slice();
  const past = [...session.past];
  const revision = session.revision;
  const image = jpegMetadata(await picture('jpeg'), 14 * 1024 * 1024);
  const read = vi.fn(async () => image);
  const save = vi.spyOn(PDFDocument.prototype, 'save').mockImplementation(async () => {
    throw new Error('Oversized batch reached serialization');
  });
  await expect(
    session.change((doc) =>
      addImagePages(
        doc,
        Array.from({ length: 12 }, () => read),
      ),
    ),
  ).rejects.toThrow('These pictures would exceed the 100 MB PDF limit.');
  expect(read).toHaveBeenCalledTimes(8);
  expect(save).not.toHaveBeenCalled();
  expect(session.bytes).toEqual(original);
  expect(session.past).toEqual(past);
  expect(session.revision).toBe(revision);
  expect(session.dirty).toBe(false);
});

it('accepts picture inputs larger than the PDF limit when their encoded PDF fits', async () => {
  const image = pngMetadata(await picture('png'), 14 * 1024 * 1024);
  expect(image.length).toBeLessThan(MAX_IMAGE_SIZE);
  expect(image.length * 8).toBeGreaterThan(MAX_FILE_SIZE);
  const bytes = await imagesToPdf(Array.from({ length: 8 }, () => image));
  expect(bytes.length).toBeLessThan(100 * 1024);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(8);
});
