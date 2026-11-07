import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFArray, PDFDict, PDFName, StandardFonts } from 'pdf-lib';
import { PdfSession, deletePage, fillFields } from '../src/core/document.js';
import { formFields } from '../src/core/structure.js';
import { partialFlattenPdf } from './fixtures/partial-flatten.js';
import { paintedText } from './helpers/painted-text.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

async function source(kind) {
  const doc = await PDFDocument.load(await partialFlattenPdf(kind));
  doc.addPage([400, 400]);
  if (kind === 'widget-layout')
    doc.getForm().getField('Keep value').acroField.getWidgets()[0].dict.delete(PDFName.of('AP'));
  return doc.save({ updateFieldAppearances: false });
}
function retained(doc) {
  const field = doc.getForm().getField('Keep value'),
    kids = field.acroField.dict.lookup(PDFName.of('Kids'));
  const widgets = (kids instanceof PDFArray ? kids.asArray() : [field.acroField.dict])
    .map((entry) => doc.context.lookup(entry))
    .filter((entry) => entry instanceof PDFDict);
  return [
    field.acroField.dict,
    ...widgets,
    ...widgets.map((widget) => widget.lookup(PDFName.of('AP'))),
  ].map((dict) => dict?.toString());
}
for (const kind of ['text', 'dropdown', 'list', 'widget-layout', 'widgets'])
  for (const action of ['fill', 'delete'])
    it(`preserves an untouched ${kind} field when performing ${action}`, async () => {
      const bytes = await source(kind),
        original = retained(await PDFDocument.load(bytes)),
        session = new PdfSession(bytes);
      await session.change((doc) =>
        action === 'fill'
          ? fillFields(doc, { 'Flatten me': 'Updated safe value' })
          : deletePage(doc, 1),
      );
      const doc = await PDFDocument.load(session.bytes);
      expect(retained(doc)).toEqual(original);
      if (action === 'fill') {
        expect(doc.getForm().getTextField('Flatten me').getText()).toBe('Updated safe value');
        expect(await paintedText(session.bytes)).toContain('Updated safe value');
      } else expect(doc.getPageCount()).toBe(1);
      expect(session.undo()).toBe(true);
      expect(session.bytes).toEqual(bytes);
      expect(session.redo()).toBe(true);
      expect(retained(await PDFDocument.load(session.bytes))).toEqual(original);
    });

it('keeps explicit regeneration failures visible to callers', async () => {
  const doc = await PDFDocument.load(await source('text'));
  formFields(doc);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  expect(() => doc.getForm().updateFieldAppearances(font)).toThrow('WinAnsi cannot encode');
});

it('continues automatic generation after multiple failed clean fields and retries later explicit edits', async () => {
  const source = await PDFDocument.create(),
    page = source.addPage([400, 400]);
  for (const [index, name] of ['First', 'Second', 'Third'].entries()) {
    const field = source.getForm().createTextField(name);
    field.addToPage(page, { x: 30, y: 300 - 60 * index, width: 250, height: 30 });
    field.setText(index < 2 ? '漢字' : 'Generate this appearance');
    field.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'));
  }
  const doc = await PDFDocument.load(await source.save({ updateFieldAppearances: false }));
  formFields(doc);
  const original = ['First', 'Second'].map((name) =>
    doc.getForm().getField(name).acroField.dict.toString(),
  );
  const saved = await doc.save();
  expect(
    ['First', 'Second'].map((name) => doc.getForm().getField(name).acroField.dict.toString()),
  ).toEqual(original);
  expect(await paintedText(saved)).toContain('Generate this appearance');
  expect(doc.getForm().getTextField('Third').needsAppearancesUpdate()).toBe(false);
  doc.getForm().getTextField('First').setText('Now supported');
  expect(await paintedText(await doc.save())).toContain('Now supported');
});

it('still refuses an explicit edit of a damaged field and leaves the transaction unchanged', async () => {
  const original = await source('widgets'),
    session = new PdfSession(original);
  await expect(
    session.change((doc) => fillFields(doc, { 'Keep value': 'Explicit new value' })),
  ).rejects.toThrow();
  expect(session.bytes).toEqual(original);
  expect(session.past).toHaveLength(0);
});
