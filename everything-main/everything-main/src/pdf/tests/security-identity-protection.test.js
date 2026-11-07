import { expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { protectPdf, unlockPdf } from '../src/core/security.js';
import { setPageSource } from '../src/core/text-edit.js';
import { updateFieldAppearance } from '../src/core/form-appearance.js';
import { PdfSession } from '../src/core/document.js';

const exempt = (doc, stream) => {
  const filter = stream.dict.get(PDFName.of('Filter'));
  stream.dict.set(PDFName.of('Filter'), doc.context.obj(['Crypt', ...(filter ? [filter] : [])]));
  stream.dict.set(PDFName.of('DecodeParms'), doc.context.obj([{ Name: 'Identity' }, null]));
};

/** Every stream's decoded text, as someone without the password reads the file. */
async function readableWithoutPassword(bytes) {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const texts = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    let data = object.getContents();
    if (String(object.dict.get(PDFName.of('Filter'))).includes('FlateDecode'))
      try {
        data = inflateSync(data);
      } catch {
        continue;
      }
    texts.push(Buffer.from(data).toString('latin1'));
  }
  return texts.join('\n');
}

it('new protection encrypts content that inherited an Identity Crypt exemption', async () => {
  // An unencrypted file whose page content and field appearance carry Identity selectors.
  const template = await PDFDocument.create();
  const page = template.addPage([300, 300]);
  const content = template.context.flateStream('BT /F1 12 Tf 20 250 Td (Template) Tj ET');
  exempt(template, content);
  page.node.set(PDFName.of('Contents'), template.context.register(content));
  const field = template.getForm().createTextField('secret');
  field.addToPage(page, { x: 20, y: 100, width: 200, height: 30 });
  field.updateAppearances(await template.embedFont(StandardFonts.Helvetica));
  for (const widget of field.acroField.getWidgets())
    exempt(
      template,
      template.context.lookup(widget.dict.lookup(PDFName.of('AP')).get(PDFName.of('N'))),
    );
  const session = new PdfSession(await template.save({ useObjectStreams: false }));
  await session.change(async (doc) => {
    setPageSource(doc, doc.getPage(0), 'BT /F1 12 Tf 20 250 Td (PAGE-SECRET) Tj ET');
    const form = doc.getForm();
    const text = form.getTextField('secret');
    text.setText('FIELD-SECRET');
    updateFieldAppearance(text, form, await doc.embedFont(StandardFonts.Helvetica));
  });
  const protectedBytes = await protectPdf(session.bytes, { open: 'correct horse' });
  const exposed = await readableWithoutPassword(protectedBytes);
  expect(exposed).not.toContain('PAGE-SECRET');
  expect(exposed).not.toContain(Buffer.from('FIELD-SECRET').toString('hex').toUpperCase());
  expect(exposed).not.toContain('FIELD-SECRET');
  const unlocked = await readableWithoutPassword(
    (await unlockPdf(protectedBytes, 'correct horse')).bytes,
  );
  expect(unlocked).toContain('PAGE-SECRET');
});
