import { expect, it } from 'vitest';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { flattenDocument } from '../src/core/flatten.js';

async function fixture(rotations, shared, sharedList) {
  const doc = await PDFDocument.create();
  const dict = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Text',
    Rect: [80, 80, 100, 100],
    C: [1, 0.8, 0],
    F: 4,
  });
  const ref = doc.context.register(dict);
  const list = doc.context.register(doc.context.obj([ref]));
  for (const [index, rotation] of rotations.entries()) {
    const page = doc.addPage([200, 200]);
    page.setRotation(degrees(rotation));
    page.node.set(
      PDFName.of('Annots'),
      shared && sharedList
        ? list
        : doc.context.obj([shared || index === 0 ? ref : doc.context.register(dict.clone())]),
    );
  }
  return doc;
}
async function raster(bytes) {
  const task = pdfjs.getDocument({ data: bytes });
  try {
    const pdf = await task.promise;
    const hashes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      expect(await page.getAnnotations()).toHaveLength(0);
      const canvas = createCanvas(200, 200),
        context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport: page.getViewport({ scale: 1 }) })
        .promise;
      const pixels = context.getImageData(0, 0, 200, 200).data;
      expect(pixels.some((value) => value < 200)).toBe(true);
      hashes.push(createHash('sha256').update(pixels).digest('hex'));
    }
    return hashes;
  } finally {
    await task.destroy();
  }
}
for (const sharedList of [false, true])
  for (const rotations of [
    [0, 90],
    [0, 180],
    [0, 270],
    [90, 0],
    [180, 0],
    [270, 0],
  ])
    it(`flattening a shared legacy note preserves each page's rotation ${rotations} (shared list ${sharedList})`, async () => {
      const control = await fixture(rotations, false, false);
      const doc = await fixture(rotations, true, sharedList);
      expect(flattenDocument(control)).toEqual({ fields: 0, annotations: 2 });
      expect(flattenDocument(doc)).toEqual({ fields: 0, annotations: 2 });
      expect(await raster(await doc.save())).toEqual(await raster(await control.save()));
    });

for (const kind of ['note', 'highlight'])
  it(`reuses equivalent generated ${kind} drawings across many shared placements`, async () => {
    const rotations = Array.from({ length: 40 }, (_, index) => (index % 4) * 90);
    const doc = await fixture(rotations, true, false);
    if (kind === 'highlight') {
      const dict = doc.context.lookup(doc.getPage(0).node.Annots().get(0));
      dict.set(PDFName.of('Subtype'), PDFName.of('Highlight'));
      dict.set(PDFName.of('QuadPoints'), doc.context.obj([80, 100, 100, 100, 80, 80, 100, 80]));
    }
    expect(flattenDocument(doc)).toEqual({ fields: 0, annotations: 40 });
    const saved = await PDFDocument.load(await doc.save());
    const drawings = saved
      .getPages()
      .map((page) => page.node.Resources().lookup(PDFName.of('XObject')).values()[0].toString());
    expect(new Set(drawings).size).toBe(kind === 'note' ? 4 : 1);
    expect(drawings.slice(4, 8)).toEqual(drawings.slice(0, 4));
  });
