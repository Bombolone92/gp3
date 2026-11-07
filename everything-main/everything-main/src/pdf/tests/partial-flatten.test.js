import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFArray, StandardFonts } from 'pdf-lib';
import { PdfSession } from '../src/core/document.js';
import { flattenDocument } from '../src/core/flatten.js';
import { partialFlattenPdf } from './fixtures/partial-flatten.js';
import { paintedText } from './helpers/painted-text.js';

const expected = { fields: 1, annotations: 1, unflattened: { fields: 1, annotations: 0 } };
function snapshot(doc) {
  const field = doc.getForm().getField('Keep value');
  const kids = field.acroField.dict.lookup(PDFName.of('Kids'));
  const widgets = (kids instanceof PDFArray ? kids.asArray() : [field.acroField.dict])
    .map((entry) => doc.context.lookup(entry))
    .filter((entry) => entry instanceof PDFDict);
  return [
    field.acroField.dict,
    ...widgets,
    ...widgets.map((widget) => widget.lookup(PDFName.of('AP'))),
  ].map((dict) => dict?.toString());
}

for (const kind of ['text', 'dropdown', 'list', 'widget-layout', 'rectangle', 'widgets'])
  for (const stale of ['text', 'dropdown', 'list'].includes(kind) ? [false, true] : [false])
    it(`saves the safe flattened content and preserves the retained field (${kind}, stale=${stale})`, async () => {
      const bytes = await partialFlattenPdf(kind, stale);
      const original = snapshot(await PDFDocument.load(bytes));
      const session = new PdfSession(bytes);
      await session.change((doc) => {
        expect(flattenDocument(doc)).toEqual(expected);
        expect(snapshot(doc)).toEqual(original);
      });
      const saved = await PDFDocument.load(session.bytes);
      expect(snapshot(saved)).toEqual(original);
      expect(saved.getForm().getFields()).toHaveLength(1);
      const painted = await paintedText(session.bytes);
      expect(painted).toContain('Visible value');
      expect(session.undo()).toBe(true);
      expect(session.bytes).toEqual(bytes);
      expect(session.redo()).toBe(true);
      expect(snapshot(await PDFDocument.load(session.bytes))).toEqual(original);
    });

it('allows repeated saves of the partial result without retrying an unsupported appearance', async () => {
  const doc = await PDFDocument.load(await partialFlattenPdf());
  expect(flattenDocument(doc)).toEqual(expected);
  const original = snapshot(doc);
  for (let i = 0; i < 2; i++)
    expect(snapshot(await PDFDocument.load(await doc.save()))).toEqual(original);
});

it('regenerates a retained field after a later explicit edit', async () => {
  const doc = await PDFDocument.load(await partialFlattenPdf());
  expect(flattenDocument(doc)).toEqual(expected);
  doc.getForm().getTextField('Keep value').setText('Now supported');
  const bytes = await doc.save();
  expect(await paintedText(bytes)).toContain('Now supported');
  expect((await PDFDocument.load(bytes)).getForm().getTextField('Keep value').getText()).toBe(
    'Now supported',
  );
  expect(flattenDocument(doc)).toEqual({ fields: 1, annotations: 0 });
});

it('still rejects a later explicit edit that cannot produce its requested appearance', async () => {
  const doc = await PDFDocument.load(await partialFlattenPdf());
  expect(flattenDocument(doc)).toEqual(expected);
  doc.getForm().getTextField('Keep value').setText('新しい値');
  await expect(doc.save()).rejects.toThrow('WinAnsi cannot encode');
});

it('retries a retained appearance when explicitly supplied a font that supports its text', async () => {
  const doc = await PDFDocument.load(await partialFlattenPdf());
  doc.getForm().getTextField('Keep value').setText('Ω');
  expect(flattenDocument(doc)).toEqual(expected);
  const field = doc.getForm().getTextField('Keep value');
  expect(field.needsAppearancesUpdate()).toBe(true);
  doc.getForm().updateFieldAppearances(await doc.embedFont(StandardFonts.Symbol));
  expect(field.needsAppearancesUpdate()).toBe(false);
  const saved = await PDFDocument.load(await doc.save());
  expect(saved.getForm().getTextField('Keep value').getText()).toBe('Ω');
});
