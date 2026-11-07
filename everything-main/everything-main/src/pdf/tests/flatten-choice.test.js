import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { flattenDocument } from '../src/core/flatten.js';
import { PdfSession } from '../src/core/document.js';
import { flattenChoicePdf } from './fixtures/flatten-choice.js';

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
function regenerate(doc, stale) {
  if (stale) doc.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  else
    for (const field of doc.getForm().getFields())
      for (const widget of field.acroField.getWidgets()) widget.dict.delete(PDFName.of('AP'));
}
for (const list of [false, true])
  for (const inherited of [false, true])
    for (const value of ['current', 'default', 'empty', ...(!list ? ['custom'] : [])])
      for (const stale of [false, true])
        it(`preserves choice labels and selected rows when flattening (list=${list}, inherited=${inherited}, value=${value}, stale=${stale})`, async () => {
          const { doc: source } = await flattenChoicePdf({ list, inherited, value });
          const original = await source.save();
          const doc = await PDFDocument.load(original);
          regenerate(doc, stale);
          expect(flattenDocument(doc)).toEqual({ fields: 1, annotations: 0 });
          const bytes = await doc.save();
          expect((await PDFDocument.load(bytes)).getForm().getFields()).toHaveLength(0);
          expect((await pixels(bytes)).equals(await pixels(original))).toBe(true);
        });

it('preserves original choices through undo and the flattened drawing through redo', async () => {
  const { doc } = await flattenChoicePdf({ list: true, inherited: true, value: 'default' });
  const original = await pixels(await doc.save());
  regenerate(doc, true);
  const bytes = await doc.save({ updateFieldAppearances: false });
  const session = new PdfSession(bytes);
  await session.change((doc) => flattenDocument(doc));
  const flattened = session.bytes.slice();
  expect((await pixels(flattened)).equals(original)).toBe(true);
  expect(session.undo()).toBe(true);
  expect(session.bytes).toEqual(bytes);
  expect(session.redo()).toBe(true);
  expect(session.bytes).toEqual(flattened);
});
