import { expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addNote, editNote, listNotes } from '../src/core/notes.js';
import { addLink, removeLink, listLinks } from '../src/core/links.js';
import { addHighlight, editHighlight, listHighlights, rectQuad } from '../src/core/highlight.js';
import { flattenDocument } from '../src/core/flatten.js';
const actions = {
  note: {
    add: (doc, index) => addNote(doc, index, { x: 30, y: 150, text: 'Only this page' }),
    list: listNotes,
    remove: (doc, index, id) => editNote(doc, index, id, { remove: true }),
  },
  link: {
    add: (doc, index) =>
      addLink(doc, index, {
        rect: { x: 30, y: 100, width: 100, height: 30 },
        url: 'https://example.com',
      }),
    list: listLinks,
    remove: removeLink,
  },
  highlight: {
    add: (doc, index) =>
      addHighlight(doc, index, { quads: [rectQuad({ x: 30, y: 100, width: 100, height: 30 })] }),
    list: listHighlights,
    remove: (doc, index, id) => editHighlight(doc, index, id, { remove: true }),
  },
};
async function shared(indirect) {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.addPage([200, 200]);
  const array = doc.context.obj([]),
    value = indirect ? doc.context.register(array) : array;
  for (const page of doc.getPages()) page.node.set(PDFName.of('Annots'), value);
  return doc;
}
for (const indirect of [false, true])
  for (const [kind, action] of Object.entries(actions)) {
    for (const index of [0, 1])
      it(`adding ${kind} affects only page ${index + 1} with shared Annots (indirect=${indirect})`, async () => {
        const doc = await shared(indirect);
        action.add(doc, index);
        expect(action.list(doc, index)).toHaveLength(1);
        expect(action.list(doc, 1 - index)).toHaveLength(0);
        const task = pdfjs.getDocument({ data: await doc.save() });
        try {
          const pdf = await task.promise;
          expect(
            (await (await pdf.getPage(2 - index)).getAnnotations()).filter(
              (annot) => annot.subtype !== 'Popup',
            ),
          ).toHaveLength(0);
        } finally {
          await task.destroy();
        }
      });
    it(`removing ${kind} affects only the chosen page with shared Annots (indirect=${indirect})`, async () => {
      const doc = await PDFDocument.create();
      doc.addPage([200, 200]);
      doc.addPage([200, 200]);
      action.add(doc, 0);
      const array = doc.getPage(0).node.Annots(),
        value = indirect ? doc.context.register(array) : array;
      for (const page of doc.getPages()) page.node.set(PDFName.of('Annots'), value);
      action.remove(doc, 0, action.list(doc, 0)[0].id);
      expect(action.list(doc, 0)).toHaveLength(0);
      expect(action.list(doc, 1)).toHaveLength(1);
    });
  }
for (const indirect of [false, true])
  it(`flattens each page’s shared annotation placement (indirect=${indirect})`, async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.addPage([200, 200]);
    addNote(doc, 0, { x: 30, y: 150, text: 'Shared note' });
    const array = doc.getPage(0).node.Annots(),
      value = indirect ? doc.context.register(array) : array;
    for (const page of doc.getPages()) page.node.set(PDFName.of('Annots'), value);
    expect(flattenDocument(doc, { fields: false })).toEqual({ fields: 0, annotations: 2 });
    const task = pdfjs.getDocument({ data: await doc.save() });
    try {
      const pdf = await task.promise;
      const images = [];
      for (const number of [1, 2]) {
        const page = await pdf.getPage(number);
        expect(await page.getAnnotations()).toHaveLength(0);
        const canvas = createCanvas(200, 200);
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: page.getViewport({ scale: 1 }) })
          .promise;
        images.push(context.getImageData(0, 0, 200, 200).data);
      }
      expect(images[0].some((value) => value < 200)).toBe(true);
      expect(images[1]).toEqual(images[0]);
    } finally {
      await task.destroy();
    }
  });
