import { PDFDocument, PDFName } from 'pdf-lib';

export async function inheritedTextLimitPdf({
  comb = false,
  indirect = false,
  multiline = false,
} = {}) {
  const doc = await PDFDocument.create();
  const field = doc.getForm().createTextField('Address.Code');
  field.setMaxLength(5);
  if (multiline) field.enableMultiline();
  if (comb) field.enableCombing();
  field.setText('123');
  field.addToPage(doc.addPage([400, 400]), {
    x: 30,
    y: 250,
    width: 200,
    height: multiline ? 70 : 30,
  });
  doc.getForm().updateFieldAppearances();
  const parent = field.acroField.getParent().dict;
  const maximum = field.acroField.dict.get(PDFName.of('MaxLen'));
  parent.set(PDFName.of('MaxLen'), indirect ? doc.context.register(maximum) : maximum);
  field.acroField.dict.delete(PDFName.of('MaxLen'));
  return { doc, field, parent };
}
