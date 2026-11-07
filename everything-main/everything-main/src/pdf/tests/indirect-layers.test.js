import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { extractPages } from '../src/core/pages.js';
import { duplicatePage, insertPdfPages } from '../src/core/document.js';
import { flattenDocument } from '../src/core/flatten.js';

const n = PDFName.of;
async function fixture(kind, layerKind, visible, flags) {
  const doc = await PDFDocument.create();
  const ctx = doc.context,
    page = doc.addPage([100, 100]);
  const group = ctx.register(
    ctx.obj({ Type: ctx.register(n('OCG')), Name: PDFString.of('Imported layer') }),
  );
  doc.catalog.set(
    n('OCProperties'),
    ctx.obj({ OCGs: [group], D: { OFF: visible ? [] : [group] } }),
  );
  const layer =
    layerKind === 'OCG'
      ? group
      : ctx.register(
          ctx.obj({
            Type: ctx.register(n('OCMD')),
            OCGs: [group],
            P: 'AllOn',
            VE: ['And', group],
          }),
        );
  let annotation;
  if (kind === 'field') {
    const field = doc.getForm().createTextField('Layered');
    field.addToPage(page, { x: 10, y: 10, width: 80, height: 80 });
    await doc.save();
    annotation = field.acroField.getWidgets()[0].dict;
  } else {
    annotation = ctx.obj({ Type: 'Annot', Subtype: 'Square', Rect: [10, 10, 90, 90] });
    page.node.addAnnot(ctx.register(annotation));
  }
  annotation.set(n('Rect'), ctx.obj([10, 10, 90, 90]));
  annotation.set(n('F'), ctx.obj(flags));
  annotation.set(n('OC'), layer);
  annotation.set(
    n('AP'),
    ctx.obj({
      N: ctx.register(
        ctx.flateStream('1 0 0 rg 0 0 80 80 re f', {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 80, 80],
        }),
      ),
    }),
  );
  return { doc, groupId: `${group.objectNumber}R` };
}
async function center(bytes, intent, groupId, override, pageNumber = 1) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(pageNumber);
    const config = await pdf.getOptionalContentConfig({ intent });
    if (override !== undefined) config.setVisibility(groupId, override, false);
    const canvas = createCanvas(100, 100),
      ctx = canvas.getContext('2d');
    await page.render({
      canvasContext: ctx,
      viewport: page.getViewport({ scale: 1 }),
      intent,
      optionalContentConfigPromise: Promise.resolve(config),
    }).promise;
    return Array.from(ctx.getImageData(50, 50, 1, 1).data);
  } finally {
    await task.destroy();
  }
}
for (const kind of ['annotation', 'field'])
  for (const layerKind of ['OCG', 'OCMD'])
    for (const visible of [false, true])
      for (const flags of [4, 0, 36])
        it(`preserves ${kind} visibility in indirect ${layerKind} layers (visible=${visible}, flags=${flags})`, async () => {
          const { doc, groupId } = await fixture(kind, layerKind, visible, flags);
          const before = await doc.save();
          expect(flattenDocument(doc)).toEqual({
            fields: kind === 'field' ? 1 : 0,
            annotations: kind === 'annotation' ? 1 : 0,
          });
          expect(doc.getPage(0).node.Annots().size()).toBe(0);
          const after = await doc.save();
          for (const intent of ['display', 'print'])
            for (const override of [undefined, !visible]) {
              const expected =
                (override ?? visible) && (intent === 'display' ? !(flags & 32) : !!(flags & 4))
                  ? [255, 0, 0, 255]
                  : [255, 255, 255, 255];
              expect(await center(before, intent, groupId, override)).toEqual(expected);
              expect(await center(after, intent, groupId, override)).toEqual(expected);
            }
        });

for (const operation of ['extract', 'insert', 'duplicate'])
  for (const layerKind of ['OCG', 'OCMD'])
    it(`${operation} keeps a flattened field controlled by its indirect ${layerKind} layer`, async () => {
      const { doc } = await fixture('field', layerKind, false, 4);
      const original = await doc.save();
      let output,
        pageNumber = 1;
      if (operation === 'extract') output = await extractPages(original, [0]);
      else if (operation === 'insert') {
        const target = await PDFDocument.create();
        target.addPage([100, 100]);
        await insertPdfPages(target, original);
        output = await target.save();
        pageNumber = 2;
      } else {
        await duplicatePage(doc, 0);
        output = await doc.save();
        pageNumber = 2;
      }
      const saved = await PDFDocument.load(output);
      const group = saved.catalog.lookup(n('OCProperties')).lookup(n('OCGs')).get(0);
      const groupId = `${group.objectNumber}R`;
      expect(
        saved
          .getPage(pageNumber - 1)
          .node.Annots()
          ?.size() ?? 0,
      ).toBe(0);
      for (const intent of ['display', 'print']) {
        expect(await center(output, intent, groupId, undefined, pageNumber)).toEqual([
          255, 255, 255, 255,
        ]);
        expect(await center(output, intent, groupId, true, pageNumber)).toEqual([255, 0, 0, 255]);
      }
    });
