import { expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addNote, listNotes, editNote } from '../src/core/notes.js';
import { addHighlight, listHighlights, editHighlight } from '../src/core/highlight.js';

for (const kind of ['note', 'highlight'])
  for (const key of ['geometry', 'color'])
    it(`reads and edits a ${kind} with indirect ${key} numbers`, async () => {
      const doc = await PDFDocument.create();
      doc.addPage([400, 400]);
      if (kind === 'note') addNote(doc, 0, { x: 100, y: 300, text: 'Original', hex: '#1144cc' });
      else
        addHighlight(doc, 0, { quads: [[40, 220, 130, 220, 40, 196, 130, 196]], hex: '#1144cc' });
      const dict = doc.context.lookup(doc.getPage(0).node.Annots().get(0));
      const field = key === 'color' ? 'C' : kind === 'note' ? 'Rect' : 'QuadPoints';
      const array = dict.lookup(PDFName.of(field));
      dict.set(
        PDFName.of(field),
        doc.context.obj(array.asArray().map((value) => doc.context.register(value))),
      );
      const bytes = await doc.save();
      const task = pdfjs.getDocument({ data: bytes.slice() });
      try {
        const page = await (await task.promise).getPage(1);
        const annotations = await page.getAnnotations();
        const annotation = annotations.find(
          (item) => item.subtype === (kind === 'note' ? 'Text' : 'Highlight'),
        );
        expect(Array.from(annotation.color)).toEqual([17, 68, 204]);
        expect(annotation.rect).toEqual(
          kind === 'note' ? [100, 280, 120, 300] : [40, 196, 130, 220],
        );
      } finally {
        await task.destroy();
      }
      const loaded = await PDFDocument.load(bytes);
      const list = kind === 'note' ? listNotes : listHighlights;
      const edit = kind === 'note' ? editNote : editHighlight;
      const entries = list(loaded, 0);
      expect(entries).toHaveLength(1);
      expect(entries[0].hex).toBe('#1144cc');
      edit(loaded, 0, entries[0].id, { hex: '#00aa00' });
      const saved = await PDFDocument.load(await loaded.save());
      expect(list(saved, 0)[0].hex).toBe('#00aa00');
    });
