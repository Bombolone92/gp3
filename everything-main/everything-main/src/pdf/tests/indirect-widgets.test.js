import { expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPages } from '../src/core/pages.js';
import { splitPdf } from '../src/core/split.js';
import { duplicatePage, insertPdfPages } from '../src/core/document.js';
import { unflattenableWidget } from './fixtures/unflattenable-widget.js';

for (const indirect of [false, true])
  for (const merged of [false, true])
    for (const operation of ['extract', 'split', 'insert', 'duplicate'])
      it(`refuses to orphan an unflattened widget on ${operation} (indirect=${indirect}, merged=${merged})`, async () => {
        const source = await unflattenableWidget({ indirect, merged });
        const bytes = await source.save();
        const target = await PDFDocument.create();
        target.addPage([700, 700]);
        const work =
          operation === 'extract'
            ? () => extractPages(bytes, [0])
            : operation === 'split'
              ? () => splitPdf(bytes, [[1], [0]])
              : operation === 'insert'
                ? () => insertPdfPages(target, bytes)
                : () => duplicatePage(source, 0);
        await expect(work()).rejects.toThrow('could not be flattened safely');
        expect(source.getPageCount()).toBe(2);
        expect(source.getForm().getFields()).toHaveLength(1);
        expect(source.getPage(0).node.Annots().size()).toBe(1);
        expect(target.getPageCount()).toBe(1);
        expect(target.getPage(0).getWidth()).toBe(700);
        // Other pages are still usable: refusing one widget must not block the whole file.
        const safe = await PDFDocument.load(await extractPages(bytes, [1]));
        expect(safe.getPageCount()).toBe(1);
        expect(safe.getPage(0).getWidth()).toBe(450);
        expect(safe.getForm().getFields()).toHaveLength(0);
      });

it('still copies an indirectly typed widget when its appearance can be flattened', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const field = doc.getForm().createTextField('Name');
  field.setText('Ada');
  field.addToPage(page, { x: 30, y: 200, width: 150, height: 25 });
  const widget = doc.context.lookup(page.node.Annots().get(0));
  widget.set(PDFName.of('Subtype'), doc.context.register(PDFName.of('Widget')));
  const bytes = await extractPages(await doc.save(), [0]);
  const result = await PDFDocument.load(bytes);
  expect(result.getForm().getFields()).toHaveLength(0);
  expect(result.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  const task = pdfjs.getDocument({ data: bytes });
  try {
    const text = await (await (await task.promise).getPage(1)).getTextContent();
    expect(text.items.map((item) => item.str).join('')).toContain('Ada');
  } finally {
    await task.destroy();
  }
});
