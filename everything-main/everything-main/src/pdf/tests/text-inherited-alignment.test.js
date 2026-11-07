import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fillFields, PdfSession } from '../src/core/document.js';
import { inheritedAlignmentPdf } from './fixtures/inherited-alignment.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

function appearance(field) {
  const stream = field.acroField.dict.context.lookup(
    field.acroField.getWidgets()[0].getNormalAppearance(),
  );
  return new TextDecoder()
    .decode(
      stream.getUnencodedContents
        ? stream.getUnencodedContents()
        : decodePDFRawStream(stream).decode(),
    )
    .replace(/\/[^\s]+ ([\d.]+) Tf/g, '/Font $1 Tf');
}
async function render(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
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

for (const alignment of [1, 2])
  for (const multiline of [false, true])
    for (const rotation of [0, 90])
      it(`preserves inherited alignment when editing (Q=${alignment}, multiline=${multiline}, rotation=${rotation})`, async () => {
        const { doc: source } = await inheritedAlignmentPdf({
          alignment,
          multiline,
          rotation,
          indirect: true,
        });
        const bytes = await source.save();
        const doc = await PDFDocument.load(bytes);
        const reference = await PDFDocument.load(bytes);
        reference.getForm().getTextField('Address.Value').setAlignment(alignment);
        const field = doc.getForm().getTextField('Address.Value');
        const parent = field.acroField.getParent().dict;
        const originalParent = parent.toString();
        const text = multiline ? 'Changed text\nSecond line' : 'Changed text';
        await fillFields(doc, { 'Address.Value': text });
        await fillFields(reference, { 'Address.Value': text });
        expect(parent.toString()).toBe(originalParent);
        expect(appearance(field)).toBe(
          appearance(reference.getForm().getTextField('Address.Value')),
        );
        const saved = await doc.save();
        expect(await render(saved)).toEqual(await render(await reference.save()));
        const reopened = await PDFDocument.load(saved);
        expect(reopened.getForm().getTextField('Address.Value').getText()).toBe(text);
        await fillFields(reopened, { 'Address.Value': 'Again' });
        expect(reopened.getForm().getTextField('Address.Value').getAlignment()).toBe(alignment);
      });

it('keeps unchanged/read-only fields and local overrides intact and supports undo/redo', async () => {
  const { doc, field, parent } = await inheritedAlignmentPdf();
  const snapshot = () =>
    doc.context.enumerateIndirectObjects().map(([ref, obj]) => [ref, obj.toString()]);
  const before = snapshot();
  expect(await fillFields(doc, { 'Address.Value': 'Original' })).toBe(false);
  expect(snapshot()).toEqual(before);
  field.enableReadOnly();
  const locked = snapshot();
  expect(await fillFields(doc, { 'Address.Value': 'Changed' })).toBe(false);
  expect(snapshot()).toEqual(locked);
  field.disableReadOnly();
  field.setAlignment(1);
  const bytes = await doc.save();
  const session = new PdfSession(bytes);
  await session.change((doc) => fillFields(doc, { 'Address.Value': 'Changed' }));
  expect(
    (await PDFDocument.load(session.bytes)).getForm().getTextField('Address.Value').getAlignment(),
  ).toBe(1);
  expect(parent.lookup(PDFName.of('Q')).asNumber()).toBe(2);
  expect(session.undo()).toBe(true);
  expect(session.bytes).toEqual(bytes);
  expect(session.redo()).toBe(true);
});
