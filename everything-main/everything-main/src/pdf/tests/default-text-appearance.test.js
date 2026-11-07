import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { fillFields, listFields, PdfSession } from '../src/core/document.js';
import { flattenDocument } from '../src/core/flatten.js';
import { defaultTextPdf } from './fixtures/default-text.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

async function rendered(bytes) {
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
    const ops = await page.getOperatorList();
    return {
      pixels: Buffer.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
      text: ops.fnArray
        .flatMap((fn, i) =>
          fn === pdfjs.OPS.showText ? ops.argsArray[i][0].map((g) => g.unicode || '') : [],
        )
        .join(''),
    };
  } finally {
    await task.destroy();
  }
}
function missing(field) {
  for (const widget of field.acroField.getWidgets()) widget.dict.delete(PDFName.of('AP'));
}

for (const kind of ['text', 'multiline', 'password', 'comb'])
  for (const inherited of [false, true])
    for (const current of ['absent', 'empty', 'override']) {
      for (const stale of [false, true])
        it(`preserves default text during flattening (${kind}, inherited=${inherited}, current=${current}, stale=${stale})`, async () => {
          const { doc, field } = await defaultTextPdf({ kind, inherited, current });
          const before = await rendered(await doc.save());
          if (stale) doc.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
          else missing(field);
          expect(flattenDocument(doc)).toEqual({ fields: 2, annotations: 0 });
          const after = await rendered(await doc.save());
          expect(after.pixels.equals(before.pixels)).toBe(true);
        });
      it(`preserves default text while changing a neighbor (${kind}, inherited=${inherited}, current=${current})`, async () => {
        const { doc, field, shown } = await defaultTextPdf({ kind, inherited, current });
        missing(field);
        await fillFields(doc, { Neighbor: 'Updated neighbor' });
        const bytes = await doc.save();
        const painted = (await rendered(bytes)).text;
        expect(painted).toBe(shown.replaceAll('\n', '') + 'Updated neighbor');
        const saved = await PDFDocument.load(bytes);
        expect(saved.getForm().getTextField('Group.Value').acroField.V() === undefined).toBe(
          current === 'absent',
        );
        expect(listFields(saved)[0].value).toBe(
          current === 'absent'
            ? kind === 'multiline'
              ? 'Default\ntext'
              : 'Default'
            : current === 'empty'
              ? ''
              : 'Current',
        );
      });
    }

it('retains default text through automatic appearance generation, undo, and redo', async () => {
  const { doc, field } = await defaultTextPdf({ inherited: true });
  missing(field);
  const bytes = await doc.save({ updateFieldAppearances: false });
  const session = new PdfSession(bytes);
  await session.change((doc) => {
    listFields(doc);
    doc.setTitle('Updated title');
  });
  expect((await rendered(session.bytes)).text).toBe('DefaultOriginal neighbor');
  const changed = session.bytes.slice();
  expect(session.undo()).toBe(true);
  expect(session.bytes).toEqual(bytes);
  expect(session.redo()).toBe(true);
  expect(session.bytes).toEqual(changed);
});
