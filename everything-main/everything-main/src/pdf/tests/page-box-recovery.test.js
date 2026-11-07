import { expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfSession, visibleBox } from '../src/core/document.js';
import { cropPages, resetCrop } from '../src/core/crop.js';
import { invalidMediaBoxes, pageBoxPdf } from './fixtures/page-boxes.js';

async function geometry(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const page = await (await task.promise).getPage(1),
      [x, y, x1, y1] = page.view;
    return { x, y, width: x1 - x, height: y1 - y };
  } finally {
    await task.destroy();
  }
}

for (const kind of Object.keys(invalidMediaBoxes))
  for (const inherited of [false, true]) {
    it(`matches the displayed fallback page for ${kind} media box (inherited=${inherited})`, async () => {
      const bytes = await pageBoxPdf(kind, true, 0, inherited),
        doc = await PDFDocument.load(bytes);
      expect(visibleBox(doc.getPage(0))).toEqual(await geometry(bytes));
    });
    for (const rotation of [0, 90, 180, 270])
      it(`crops and restores ${kind} media box (inherited=${inherited}, rotation=${rotation})`, async () => {
        const bytes = await pageBoxPdf(kind, false, rotation, inherited),
          session = new PdfSession(bytes);
        await session.change((doc) =>
          cropPages(doc, [0], { top: 18, bottom: 18, left: 18, right: 18 }),
        );
        expect(await geometry(session.bytes)).toEqual({ x: 18, y: 18, width: 576, height: 756 });
        await session.change((doc) => resetCrop(doc, [0]));
        expect(await geometry(session.bytes)).toEqual({ x: 0, y: 0, width: 612, height: 792 });
        expect(session.undo()).toBe(true);
        expect(await geometry(session.bytes)).toEqual({ x: 18, y: 18, width: 576, height: 756 });
        expect(session.undo()).toBe(true);
        expect(session.bytes).toEqual(bytes);
      });
  }

for (const value of [
  [0, 0, 'invalid', 792],
  [0, 0, 0, 792],
  [900, 900, 1000, 1000],
])
  for (const inherited of [false, true])
    it(`reports no visible crop for ignored crop box ${JSON.stringify(value)} (inherited=${inherited})`, async () => {
      const doc = await PDFDocument.create(),
        page = doc.addPage([612, 792]);
      (inherited ? doc.catalog.Pages() : page.node).set(
        PDFName.of('CropBox'),
        doc.context.obj(value),
      );
      const bytes = await doc.save(),
        session = new PdfSession(bytes);
      expect(await geometry(bytes)).toEqual({ x: 0, y: 0, width: 612, height: 792 });
      await expect(session.change((doc) => resetCrop(doc, [0]))).resolves.toBe(false);
      expect(session.bytes).toEqual(bytes);
      expect(session.past).toHaveLength(0);
    });

it('retains valid reversed, offset and indirect page boxes while restoring the full media area', async () => {
  const doc = await PDFDocument.create(),
    page = doc.addPage([400, 500]);
  const media = doc.context.obj(
    [410, 520, 10, 20].map((value) => doc.context.register(doc.context.obj(value))),
  );
  page.node.set(PDFName.of('MediaBox'), doc.context.register(media));
  page.node.set(PDFName.of('CropBox'), doc.context.obj([360, 470, 60, 70]));
  const session = new PdfSession(await doc.save());
  await session.change((doc) => resetCrop(doc, [0]));
  expect(await geometry(session.bytes)).toEqual({ x: 10, y: 20, width: 400, height: 500 });
  const saved = await PDFDocument.load(session.bytes);
  expect(
    saved
      .getPage(0)
      .node.MediaBox()
      .asArray()
      .every((value) => value.constructor.name === 'PDFRef'),
  ).toBe(true);
});
