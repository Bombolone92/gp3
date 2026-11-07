import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { addImagePages } from '../../src/core/image-pages.js';

const canvas = createCanvas(1024, 1024);
const context = canvas.getContext('2d');
context.fillStyle = 'rgba(0,100,200,0.5)';
context.fillRect(0, 0, canvas.width, canvas.height);
const png = new Uint8Array(await canvas.encode('png'));
const doc = await PDFDocument.create();
const collect = () => {
  globalThis.gc();
  globalThis.gc();
};
collect();
const before = process.memoryUsage().arrayBuffers;
let peakRetainedBytes = 0;
const embedPng = doc.embedPng.bind(doc);
doc.embedPng = async (data) => {
  collect();
  peakRetainedBytes = Math.max(peakRetainedBytes, process.memoryUsage().arrayBuffers - before);
  return embedPng(data);
};
await addImagePages(
  doc,
  Array.from({ length: 12 }, () => png),
);
collect();
const retainedBytes = process.memoryUsage().arrayBuffers - before;
const bytes = await doc.save();
const reopened = await PDFDocument.load(bytes);
process.stdout.write(
  JSON.stringify({
    peakRetainedBytes,
    retainedBytes,
    pages: reopened.getPageCount(),
    pdfBytes: bytes.length,
  }),
);
