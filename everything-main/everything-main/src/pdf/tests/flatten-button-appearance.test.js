import { expect, it } from 'vitest';
import { PDFBool, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { flattenDocument } from '../src/core/flatten.js';

it('flattens a button with its own drawing when the form asks viewers to redraw text', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const form = doc.getForm();
  const button = form.createButton('logo');
  button.addToPage('', page, { x: 50, y: 50, width: 100, height: 100, borderWidth: 0 });
  const widget = button.acroField.getWidgets()[0];
  // An icon-only button: its normal appearance paints a red square, with no caption.
  const drawing = doc.context.flateStream('1 0 0 rg 0 0 100 100 re f', {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, 100, 100],
  });
  widget.dict.set(PDFName.of('AP'), doc.context.obj({ N: doc.context.register(drawing) }));
  widget.getOrCreateAppearanceCharacteristics().dict.delete(PDFName.of('CA'));
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  const flat = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }));
  flattenDocument(flat);
  const saved = await PDFDocument.load(await flat.save({ updateFieldAppearances: false }));
  const objects = saved.getPage(0).node.Resources().lookup(PDFName.of('XObject'));
  const drawn = objects.entries().map(([, ref]) => {
    const stream = saved.context.lookup(ref);
    return new TextDecoder().decode(
      stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents(),
    );
  });
  expect(drawn.join('\n')).toContain('1 0 0 rg 0 0 100 100 re f');
  expect(saved.getForm().getFields()).toHaveLength(0);
});
