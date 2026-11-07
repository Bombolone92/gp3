import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { listNotes, editNote, ensureNoteAppearance } from '../src/core/notes.js';
import { listHighlights, editHighlight, ensureMarkupAppearance } from '../src/core/highlight.js';
import { rotatePage } from '../src/core/document.js';
import { commentPdf } from './fixtures/indirect-comments.js';

async function raster(doc) {
  const task = pdfjs.getDocument({ data: await doc.save() });
  try {
    const page = await (await task.promise).getPage(1);
    const canvas = createCanvas(400, 400);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: 1 }) }).promise;
    return Buffer.from(ctx.getImageData(0, 0, 400, 400).data);
  } finally {
    await task.destroy();
  }
}

for (const kind of ['note', 'highlight', 'underline', 'strikeout']) {
  const list = kind === 'note' ? listNotes : listHighlights;
  const edit = kind === 'note' ? editNote : editHighlight;
  it(`edits an indirect ${kind} and deletes its popup when reopened`, async () => {
    const { doc, dict, id } = await commentPdf(kind);
    expect(list(doc, 0)).toHaveLength(1);
    const subtype = dict.get(PDFName.of('Subtype'));
    edit(doc, 0, id, { hex: '#1144cc', ...(kind === 'note' ? { text: 'Updated comment' } : {}) });
    expect(list(doc, 0)[0]).toMatchObject({
      hex: '#1144cc',
      text: kind === 'note' ? 'Updated comment' : 'Imported comment',
    });
    expect(dict.get(PDFName.of('Subtype'))).toBe(subtype);
    const reopened = await PDFDocument.load(await doc.save());
    expect(list(reopened, 0)).toHaveLength(1);
    edit(reopened, 0, id, { remove: true });
    expect(list(reopened, 0)).toEqual([]);
    expect(reopened.getPage(0).node.Annots().size()).toBe(0);
  });
  it(`supplies the same legacy ${kind} appearance for direct and indirect subtypes`, async () => {
    const pictures = [];
    for (const indirect of [false, true]) {
      const { doc, dict } = await commentPdf(kind, indirect);
      dict.delete(PDFName.of('AP'));
      expect(
        kind === 'note'
          ? ensureNoteAppearance(doc, doc.getPage(0), dict)
          : ensureMarkupAppearance(doc, dict),
      ).toBe(true);
      pictures.push(await raster(doc));
    }
    expect(Buffer.compare(...pictures)).toBe(0);
  });
  it(`keeps a standard ${kind} visible and editable with the Invisible flag`, async () => {
    const { doc, dict, id } = await commentPdf(kind);
    const before = await raster(doc);
    dict.set(PDFName.of('F'), doc.context.register(PDFNumber.of(5)));
    // Invisible only suppresses annotation types the reader does not recognize.
    expect(Buffer.compare(before, await raster(doc))).toBe(0);
    expect(list(doc, 0)).toHaveLength(1);
    edit(doc, 0, id, { hex: '#1144cc' });
    expect(list(doc, 0)[0].hex).toBe('#1144cc');
    expect(dict.lookup(PDFName.of('F')).asNumber()).toBe(5);
    expect(Buffer.compare(before, await raster(doc))).not.toBe(0);
    edit(doc, 0, id, { remove: true });
    expect(doc.getPage(0).node.Annots().size()).toBe(0);
  });
  for (const flags of [7, 37, 39])
    it(`keeps hidden ${kind} annotations with flags ${flags} inaccessible`, async () => {
      const { doc, dict, id } = await commentPdf(kind);
      dict.set(PDFName.of('F'), doc.context.register(PDFNumber.of(flags)));
      expect(list(doc, 0)).toEqual([]);
      const before = dict.toString();
      expect(() => edit(doc, 0, id, { hex: '#1144cc' })).toThrow();
      expect(() => edit(doc, 0, id, { remove: true })).toThrow();
      expect(dict.toString()).toBe(before);
    });
  for (const flags of [64, 65, 128, 129, 640, 641])
    it(`respects flags ${flags} on indirect ${kind} annotations`, async () => {
      const { doc, dict, id } = await commentPdf(kind);
      dict.set(PDFName.of('F'), doc.context.register(PDFNumber.of(flags)));
      expect(list(doc, 0)).toHaveLength(1);
      const before = dict.toString();
      expect(() => edit(doc, 0, id, { hex: '#1144cc' })).toThrow();
      expect(() => edit(doc, 0, id, { remove: true })).toThrow();
      expect(dict.toString()).toBe(before);
    });
}

for (const rotation of [90, 180, 270])
  it(`keeps indirect note icons upright after rotation ${rotation}`, async () => {
    const pictures = [];
    for (const indirect of [false, true]) {
      const { doc } = await commentPdf('note', indirect);
      rotatePage(doc, 0, rotation);
      pictures.push(await raster(doc));
    }
    expect(Buffer.compare(...pictures)).toBe(0);
  });
