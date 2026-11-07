import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { normalizeImageFiles } from '../../src/image-codec.js';
import { addImagePages } from '../../src/core/image-pages.js';
import { crc32 } from '../../src/lib/crc32.js';

const canvas = createCanvas(32, 24);
const context = canvas.getContext('2d');
context.fillStyle = '#d02020';
context.fillRect(0, 0, canvas.width, canvas.height);
const png = new Uint8Array(await canvas.encode('png'));
// A legal, private ancillary chunk that does not affect any pixels. The picture's
// source bytes can be much larger than its PDF image stream, so total input size
// alone cannot justify rejecting a batch that makes a small, valid PDF.
const extra = new Uint8Array(2 * 1024 * 1024 + 12);
const view = new DataView(extra.buffer);
view.setUint32(0, extra.length - 12);
extra.set(new TextEncoder().encode('raNd'), 4);
view.setUint32(extra.length - 4, crc32(extra.subarray(4, extra.length - 4)));
const picture = new Uint8Array(png.length + extra.length);
picture.set(png.subarray(0, 33));
picture.set(extra, 33);
picture.set(png.subarray(33), 33 + extra.length);
const doc = await PDFDocument.create();
const controller = new AbortController();
const collect = () => {
  globalThis.gc();
  globalThis.gc();
};
collect();
const before = process.memoryUsage().arrayBuffers;
let peakRetainedBytes = 0;
const measure = () => {
  collect();
  peakRetainedBytes = Math.max(peakRetainedBytes, process.memoryUsage().arrayBuffers - before);
};
const file = {
  size: picture.length,
  arrayBuffer: async () => {
    measure();
    return picture.slice().buffer;
  },
};
const embed = doc.embedPng.bind(doc);
doc.embedPng = async (bytes) => {
  measure();
  return embed(bytes);
};
const images = await normalizeImageFiles(
  Array.from({ length: 12 }, () => file),
  { lazy: true, signal: controller.signal },
);
await addImagePages(doc, images, { signal: controller.signal });
measure();
const saved = await doc.save();
const reopened = await PDFDocument.load(saved);
const [, ref] = reopened.getPage(0).node.Resources().lookup(PDFName.of('XObject')).entries()[0];
const pixel = Array.from(decodePDFRawStream(reopened.context.lookup(ref)).decode().subarray(0, 3));
process.stdout.write(
  JSON.stringify({
    peakRetainedBytes,
    pages: reopened.getPageCount(),
    pdfBytes: saved.length,
    pixel,
  }),
);
