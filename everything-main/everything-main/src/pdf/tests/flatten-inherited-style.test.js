import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { flattenDocument } from '../src/core/flatten.js';
import { PdfSession } from '../src/core/document.js';
import { inheritedAppearancePdf } from './fixtures/inherited-appearance.js';
import { inheritedAlignmentPdf } from './fixtures/inherited-alignment.js';
import { inheritedTextLimitPdf } from './fixtures/inherited-text-limit.js';

async function pixels(bytes) {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  });
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    return Buffer.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } finally {
    await task.destroy();
  }
}
async function verifyRegeneration(source, stale) {
  const original = await source.save();
  const doc = await PDFDocument.load(original);
  if (stale) doc.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  else
    for (const field of doc.getForm().getFields())
      for (const widget of field.acroField.getWidgets()) widget.dict.delete(PDFName.of('AP'));
  expect(flattenDocument(doc)).toEqual({ fields: 1, annotations: 0 });
  const bytes = await doc.save();
  expect((await PDFDocument.load(bytes)).getForm().getFields()).toHaveLength(0);
  expect((await pixels(bytes)).equals(await pixels(original))).toBe(true);
}

for (const kind of ['text', 'multiline', 'dropdown', 'list'])
  for (const level of ['parent', 'form'])
    for (const stale of [false, true])
      it(`preserves inherited color and size during flattening (${kind}, ${level}, stale=${stale})`, async () => {
        const { doc } = await inheritedAppearancePdf({ kind, level, indirect: true });
        await verifyRegeneration(doc, stale);
      });

for (const alignment of [1, 2])
  for (const multiline of [false, true])
    for (const stale of [false, true])
      it(`preserves inherited alignment during flattening (Q=${alignment}, multiline=${multiline}, stale=${stale})`, async () => {
        const { doc } = await inheritedAlignmentPdf({
          alignment,
          multiline,
          rotation: multiline ? 90 : 0,
          indirect: true,
        });
        await verifyRegeneration(doc, stale);
      });

for (const stale of [false, true])
  it(`preserves inherited comb cell counts during flattening (stale=${stale})`, async () => {
    const { doc } = await inheritedTextLimitPdf({ comb: true, indirect: true });
    await verifyRegeneration(doc, stale);
  });

it('retains the original unflattened PDF through undo and repeats the same flattened appearance on redo', async () => {
  const { doc } = await inheritedAppearancePdf();
  const original = await pixels(await doc.save());
  doc.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  const bytes = await doc.save();
  const session = new PdfSession(bytes);
  await session.change((doc) => flattenDocument(doc));
  const flattened = session.bytes.slice();
  expect((await pixels(flattened)).equals(original)).toBe(true);
  expect(session.undo()).toBe(true);
  expect(session.bytes).toEqual(bytes);
  expect(session.redo()).toBe(true);
  expect(session.bytes).toEqual(flattened);
});
