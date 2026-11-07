import { expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { MAX_PAGES, validatePdf } from '../src/core/document.js';
import { copyPagesFrom, extractPages } from '../src/core/pages.js';

it('rejects extracted PDFs beyond the supported page count', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([20, 20]);
  const bytes = await doc.save();
  const indices = Array(MAX_PAGES + 1).fill(0);
  await expect(extractPages(bytes, indices)).rejects.toThrow(
    'The extracted PDF would exceed 1,000 pages.',
  );
  await expect(copyPagesFrom(doc, indices)).rejects.toThrow(
    'The extracted PDF would exceed 1,000 pages.',
  );
  expect(doc.getPageCount()).toBe(1);
});

it('allows repeated pages up to the limit and exports a PDF that can reopen', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([20, 30]);
  const bytes = await extractPages(await doc.save(), Array(MAX_PAGES).fill(0));
  const reopened = await validatePdf(bytes);
  expect(reopened.getPageCount()).toBe(MAX_PAGES);
  expect(reopened.getPage(MAX_PAGES - 1).getSize()).toEqual({ width: 20, height: 30 });
});
