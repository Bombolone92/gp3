import { expect, it } from 'vitest';
import { createDeflate } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { validatePdf } from '../src/core/document.js';
import { MAX_DECODED_STREAM_SIZE } from '../src/core/stream-limits.js';

/** Deflate `size` bytes of spaces without holding them in memory. */
async function deflatedSpaces(prefix, size) {
  const deflate = createDeflate({ level: 9 });
  const chunks = [];
  deflate.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => deflate.on('end', resolve));
  deflate.write(prefix);
  const block = Buffer.alloc(1024 * 1024, 0x20);
  for (let written = 0; written < size; written += block.length) {
    if (!deflate.write(block)) await new Promise((resolve) => deflate.once('drain', resolve));
  }
  deflate.end();
  await done;
  return Buffer.concat(chunks);
}

/** A one-page PDF whose catalog sits in an object stream that inflates past `size` bytes. */
async function objectStreamBomb(size) {
  const data = await deflatedSpaces(Buffer.from('1 0 <</Type/Catalog/Pages 2 0 R>>'), size);
  const parts = [
    Buffer.from(
      `%PDF-1.5\n3 0 obj\n<</Type/ObjStm/N 1/First 4/Filter/FlateDecode/Length ${data.length}>>\nstream\n`,
    ),
    data,
    Buffer.from(
      '\nendstream\nendobj\n2 0 obj\n<</Type/Pages/Kids[4 0 R]/Count 1>>\nendobj\n' +
        '4 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>\nendobj\n' +
        'trailer\n<</Root 1 0 R/Size 5>>\n%%EOF\n',
    ),
  ];
  return new Uint8Array(Buffer.concat(parts));
}

it('refuses a small PDF whose streams expand past the decoding limit', async () => {
  const bomb = await objectStreamBomb(MAX_DECODED_STREAM_SIZE + 16 * 1024 * 1024);
  expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
  await expect(validatePdf(bomb)).rejects.toThrow('could not be opened');
});

it('still opens object streams below the decoding limit', async () => {
  const doc = await validatePdf(await objectStreamBomb(8 * 1024 * 1024));
  expect(doc).toBeInstanceOf(PDFDocument);
  expect(doc.getPageCount()).toBe(1);
});
