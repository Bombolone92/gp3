import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { flattenDocument } from '../src/core/flatten.js';

const n = PDFName.of;

async function sample(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const canvas = createCanvas(200, 200),
      context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport: page.getViewport({ scale: 1 }) }).promise;
    return [100, 150].flatMap((y) =>
      [40, 140].map((x) => Array.from(context.getImageData(x, y, 1, 1).data)),
    );
  } finally {
    await task.destroy();
  }
}

describe('annotation appearances converted to ordinary Form XObjects', () => {
  it.each(['comment', 'field'])(
    'preserves a visible %s while leaving the shared page resource hidden',
    async (kind) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([200, 200]);
      const ctx = doc.context;
      const hidden = ctx.register(
        ctx.obj({ Type: 'OCG', Name: PDFString.of('Hidden page resource') }),
      );
      doc.catalog.set(n('OCProperties'), ctx.obj({ OCGs: [hidden], D: { OFF: [hidden] } }));
      const appearance = ctx.register(
        ctx.flateStream('1 0 0 rg 0 0 40 20 re f', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 40, 20],
          OC: hidden,
        }),
      );
      page.node.set(n('Resources'), ctx.obj({ XObject: { Original: appearance } }));
      page.node.set(
        n('Contents'),
        ctx.register(ctx.flateStream('q 1 0 0 1 120 90 cm /Original Do Q')),
      );
      for (const y of [90, 40]) {
        let annot;
        if (kind === 'field') {
          const field = doc.getForm().createTextField(`field-${y}`);
          field.addToPage(page, { x: 20, y, width: 40, height: 20, borderWidth: 0 });
          annot = field.acroField.getWidgets()[0].dict;
          doc.getForm().markFieldAsClean(field.ref);
        } else {
          annot = ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [20, y, 60, y + 20], F: 4 });
          page.node.addAnnot(ctx.register(annot));
        }
        annot.set(n('AP'), ctx.obj({ N: appearance }));
      }
      const original = await doc.save();
      const before = await sample(original);
      expect(before).toEqual([
        [255, 0, 0, 255],
        [255, 255, 255, 255],
        [255, 0, 0, 255],
        [255, 255, 255, 255],
      ]);
      expect(flattenDocument(doc)).toEqual({
        fields: kind === 'field' ? 2 : 0,
        annotations: kind === 'comment' ? 2 : 0,
      });
      const flattened = await doc.save();
      expect(await sample(flattened)).toEqual(before);
      const reopened = await PDFDocument.load(flattened);
      const objects = reopened.getPage(0).node.Resources().lookup(n('XObject'));
      const originalRef = objects.get(n('Original'));
      expect(reopened.context.lookup(originalRef).dict.get(n('OC'))).toBe(hidden);
      // Both flattened placements can share one prepared appearance, without copying it twice.
      const copies = objects
        .entries()
        .filter(([key]) => key !== n('Original'))
        .map(([, ref]) => ref);
      expect(copies).toHaveLength(2);
      expect(new Set(copies).size).toBe(1);
      expect(copies[0]).not.toBe(originalRef);
    },
  );
});
