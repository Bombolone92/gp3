import { expect, it } from 'vitest';
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFString } from 'pdf-lib';
import { PdfSession, deletePage } from '../src/core/document.js';
import { damagedWidgetsPdf } from './fixtures/damaged-widgets.js';

for (const type of ['text', 'checkbox', 'radio'])
  for (const removed of [0, 1, 2])
    it(`deletes page ${removed + 1} despite an invalid ${type} widget child`, async () => {
      const source = await damagedWidgetsPdf(type),
        session = new PdfSession(source);
      await session.change((doc) => deletePage(doc, removed));
      const doc = await PDFDocument.load(session.bytes),
        field = doc.getForm().getField('Keep');
      expect(doc.getPageCount()).toBe(2);
      const kids = field.acroField.Kids();
      expect(kids.size()).toBe(removed === 2 ? 3 : 2);
      expect(
        kids
          .asArray()
          .map((entry) => doc.context.lookup(entry))
          .filter((entry) => entry instanceof PDFString)
          .map((entry) => entry.decodeText()),
      ).toEqual(['invalid widget']);
      const widgets = kids
        .asArray()
        .map((entry) => doc.context.lookup(entry))
        .filter((entry) => entry instanceof PDFDict);
      expect(widgets).toHaveLength(removed === 2 ? 2 : 1);
      expect(
        widgets.every((widget) =>
          doc.getPages().some((page) => page.ref === widget.get(PDFName.of('P'))),
        ),
      ).toBe(true);
      if (type === 'text') expect(field.getText()).toBe('Retained value');
      else {
        const value = field.acroField.dict.lookup(PDFName.of('V')).decodeText();
        expect(value).toBe(type === 'radio' ? (removed === 1 ? 'Off' : '1') : 'Yes');
        if (type === 'radio')
          expect(
            field.acroField.dict
              .lookup(PDFName.of('Opt'))
              .asArray()
              .map((entry) => entry.decodeText()),
          ).toEqual(
            removed === 2
              ? ['First', 'unused export', 'Second']
              : removed === 0
                ? ['unused export', 'Second']
                : ['First', 'unused export'],
          );
      }
      expect(session.undo()).toBe(true);
      expect(session.bytes).toEqual(source);
      expect(session.redo()).toBe(true);
      expect((await PDFDocument.load(session.bytes)).getPageCount()).toBe(2);
    });

for (const type of ['text', 'checkbox', 'radio'])
  it(`removes the ${type} field once all of its valid widgets' pages are deleted`, async () => {
    const session = new PdfSession(await damagedWidgetsPdf(type));
    await session.change((doc) => {
      deletePage(doc, 1);
      deletePage(doc, 0);
    });
    const doc = await PDFDocument.load(session.bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getForm().getFields()).toHaveLength(0);
  });

for (const type of ['text', 'checkbox', 'radio'])
  it(`preserves an unreadable ${type} widget array when deleting an unrelated page`, async () => {
    const session = new PdfSession(await damagedWidgetsPdf(type, 'array'));
    await session.change((doc) => deletePage(doc, 2));
    const doc = await PDFDocument.load(session.bytes),
      field = doc.getForm().getField('Keep');
    expect(doc.getPageCount()).toBe(2);
    expect(field.acroField.dict.lookup(PDFName.of('Kids')).decodeText()).toBe(
      'invalid widget array',
    );
    expect(
      doc
        .getPages()
        .every((page) => page.node.Annots() instanceof PDFArray && page.node.Annots().size() === 1),
    ).toBe(true);
  });

it('does not silently discard an explicit field edit when its damaged appearance cannot be updated', async () => {
  const source = await damagedWidgetsPdf('text'),
    session = new PdfSession(source);
  await expect(
    session.change((doc) => {
      doc.getForm().getTextField('Keep').setText('Explicit update');
      deletePage(doc, 2);
    }),
  ).rejects.toThrow();
  expect(session.bytes).toEqual(source);
  expect(session.past).toHaveLength(0);
});
