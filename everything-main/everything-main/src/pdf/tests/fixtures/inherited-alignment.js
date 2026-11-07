import { PDFDocument, PDFName, degrees, rgb } from 'pdf-lib';

export async function inheritedAlignmentPdf({
  alignment = 2,
  multiline = false,
  rotation = 0,
  indirect = false,
} = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const field = doc.getForm().createTextField('Address.Value');
  field.setAlignment(alignment);
  if (multiline) field.enableMultiline();
  field.setText('Original');
  field.addToPage(page, {
    x: rotation ? 120 : 40,
    y: 120,
    width: 240,
    height: multiline ? 80 : 30,
    rotate: degrees(rotation),
    textColor: rgb(0.7, 0.1, 0.2),
  });
  field.setFontSize(12);
  doc.getForm().updateFieldAppearances();
  const parent = field.acroField.getParent().dict;
  const q = field.acroField.dict.get(PDFName.of('Q'));
  parent.set(PDFName.of('Q'), indirect ? doc.context.register(q) : q);
  field.acroField.dict.delete(PDFName.of('Q'));
  return { doc, field, parent };
}
