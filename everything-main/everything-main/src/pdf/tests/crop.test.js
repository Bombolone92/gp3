import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, degrees, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { MIN_CROP_SIDE, cropMargins, cropPages, resetCrop } from '../src/core/crop.js';

/** A 400 by 300 page with a differently colored quarter in each corner (PDF space). */
async function quarters(rotation = 0) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.setRotation(degrees(rotation));
  page.drawRectangle({ x: 0, y: 0, width: 200, height: 150, color: rgb(1, 0, 0) });
  page.drawRectangle({ x: 200, y: 0, width: 200, height: 150, color: rgb(0, 1, 0) });
  page.drawRectangle({ x: 0, y: 150, width: 200, height: 150, color: rgb(0, 0, 1) });
  page.drawRectangle({ x: 200, y: 150, width: 200, height: 150, color: rgb(1, 1, 0) });
  return PDFDocument.load(await doc.save());
}
async function view(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    const center = context.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
    return {
      width: canvas.width,
      height: canvas.height,
      center: Array.from(center.subarray(0, 3)),
    };
  } finally {
    await task.destroy();
  }
}
const quarter = { left: 0, bottom: 0, right: 0, top: 0 };

describe('cropping pages', () => {
  it('keeps the bottom-left quarter as the reader sees it on every rotation', async () => {
    const expected = { 0: [255, 0, 0], 90: [0, 255, 0], 180: [255, 255, 0], 270: [0, 0, 255] };
    for (const rotation of [0, 90, 180, 270]) {
      const doc = await quarters(rotation);
      const sideways = rotation % 180 !== 0;
      const [width, height] = sideways ? [300, 400] : [400, 300];
      cropPages(doc, [0], { ...quarter, right: width / 2, top: height / 2 });
      const seen = await view(await doc.save());
      expect([seen.width, seen.height]).toEqual([width / 2, height / 2]);
      expect(seen.center).toEqual(expected[rotation]);
    }
  });
  it('turns a rectangle on the page into reader-frame margins, clamped to the page', async () => {
    const doc = await quarters(0);
    expect(cropMargins(doc, 0, { x: 50, y: 40, width: 100, height: 60 })).toEqual({
      left: 50,
      bottom: 40,
      right: 250,
      top: 200,
    });
    expect(cropMargins(doc, 0, { x: -50, y: -40, width: 500, height: 400 })).toEqual({
      left: 0,
      bottom: 0,
      right: 0,
      top: 0,
    });
    const turned = await quarters(90);
    // The displayed bottom-left of a page turned clockwise is the PDF's bottom-right corner.
    expect(cropMargins(turned, 0, { x: 300, y: 0, width: 100, height: 150 })).toEqual({
      left: 0,
      bottom: 0,
      right: 150,
      top: 300,
    });
    cropPages(turned, [0], cropMargins(turned, 0, { x: 300, y: 0, width: 100, height: 150 }));
    expect((await view(await turned.save())).center).toEqual([0, 255, 0]);
  });
  it('crops within an earlier crop and removes crops again', async () => {
    const doc = await quarters(0);
    cropPages(doc, [0], { ...quarter, right: 200, top: 150 });
    cropPages(doc, [0], { ...quarter, right: 100, top: 75 });
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 0, y: 0, width: 100, height: 75 });
    expect(resetCrop(doc, [0])).toBe(true);
    expect(doc.getPage(0).node.has(PDFName.of('CropBox'))).toBe(false);
    expect((await view(await doc.save())).width).toBe(400);
    expect(resetCrop(doc, [0])).toBe(false);
  });
  it('removes a crop box the page inherits from the page tree as well', async () => {
    let doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.catalog.Pages().set(PDFName.of('CropBox'), doc.context.obj([50, 50, 562, 742]));
    doc = await PDFDocument.load(await doc.save());
    expect(doc.getPage(0).node.has(PDFName.of('CropBox'))).toBe(false);
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 50, y: 50, width: 512, height: 692 });
    cropPages(doc, [0], { top: 10, right: 10, bottom: 10, left: 10 });
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 60, y: 60, width: 492, height: 672 });
    expect(resetCrop(doc, [0])).toBe(true);
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
    // Once the full page shows, there is nothing more to remove.
    expect(resetCrop(doc, [0])).toBe(false);
    // The reopened file shows the full page too.
    const reopened = await PDFDocument.load(await doc.save());
    expect(reopened.getPage(0).getCropBox()).toEqual({ x: 0, y: 0, width: 612, height: 792 });
  });
  it('keeps half an inch of smaller pages when several are cropped, and refuses it for one', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    doc.addPage([60, 60]);
    cropPages(doc, [0, 1], { left: 100, right: 100, top: 100, bottom: 100 });
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    const small = doc.getPage(1).getCropBox();
    expect(small.width).toBeCloseTo(MIN_CROP_SIDE, 5);
    expect(small.height).toBeCloseTo(MIN_CROP_SIDE, 5);
    expect(small.x).toBeCloseTo(12, 5);
    const single = await quarters(0);
    expect(() => cropPages(single, [0], { left: 200, right: 190, top: 0, bottom: 0 })).toThrow(
      'half an inch',
    );
    expect(single.getPage(0).node.has(PDFName.of('CropBox'))).toBe(false);
  });
  it.each([0.5, 2])(
    'uses physical points for crop margins and minimum size with UserUnit %s',
    async (unit) => {
      for (const rotation of [0, 90, 180, 270]) {
        const doc = await quarters(rotation);
        const page = doc.getPage(0);
        page.node.set(PDFName.of('UserUnit'), PDFNumber.of(unit));
        cropPages(doc, [0], { left: 18, right: 36, bottom: 18, top: 36 });
        const rendered = await view(await doc.save());
        const [width, height] = rotation % 180 ? [300, 400] : [400, 300];
        expect([rendered.width, rendered.height]).toEqual([width * unit - 54, height * unit - 54]);
      }
      const doc = await PDFDocument.create();
      doc.addPage([60 / unit, 60 / unit]).node.set(PDFName.of('UserUnit'), PDFNumber.of(unit));
      cropPages(doc, [0], { ...quarter, left: 24 });
      expect(doc.getPage(0).getCropBox().width * unit).toBe(36);
      expect(() => cropPages(doc, [0], { ...quarter, left: 1 })).toThrow('half an inch');
    },
  );
  it('applies a drawn crop as equal physical margins on pages with different user units', async () => {
    const doc = await PDFDocument.create();
    for (const unit of [2, 0.5])
      doc.addPage([400, 300]).node.set(PDFName.of('UserUnit'), PDFNumber.of(unit));
    const margins = cropMargins(doc, 0, { x: 10, y: 20, width: 350, height: 250 });
    expect(margins).toEqual({ left: 20, bottom: 40, right: 80, top: 60 });
    cropPages(doc, [0, 1], margins);
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 10, y: 20, width: 350, height: 250 });
    expect(doc.getPage(1).getCropBox()).toEqual({ x: 40, y: 80, width: 200, height: 100 });
  });
  it('rejects missing pages and bad margins', async () => {
    const doc = await quarters(0);
    expect(() => cropPages(doc, [], quarter)).toThrow('at least one page');
    expect(() => cropPages(doc, [0], { ...quarter, left: -1 })).toThrow('zero or more');
    expect(() => cropPages(doc, [0], { ...quarter, top: NaN })).toThrow('zero or more');
  });
});
