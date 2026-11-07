import { PDFDocument, PDFName } from 'pdf-lib';

export async function formPreservationPdf({ defaultOnly = false } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  for (const [i, [name, value, multiline]] of [
    ['Name', 'Original', false],
    ['Single', 'First\r\nSecond', false],
    ['Notes', 'First\r\nSecond\rThird', true],
  ].entries()) {
    const field = form.createTextField(name);
    if (multiline) field.enableMultiline();
    field.setText(value);
    field.addToPage(page, { x: 30, y: 320 - i * 80, width: 240, height: multiline ? 65 : 25 });
    if (defaultOnly && name !== 'Name') {
      field.acroField.dict.set(PDFName.of('DV'), field.acroField.dict.get(PDFName.of('V')));
      field.acroField.dict.delete(PDFName.of('V'));
    }
  }
  const radio = form.createRadioGroup('Delivery');
  for (const [i, option] of ['Courier', 'Pickup'].entries())
    radio.addOptionToPage(option, page, { x: 30 + i * 80, y: 90, width: 20, height: 20 });
  form.updateFieldAppearances();
  radio.acroField.dict.set(PDFName.of(defaultOnly ? 'DV' : 'V'), PDFName.of('Legacy'));
  if (defaultOnly) radio.acroField.dict.delete(PDFName.of('V'));
  return doc;
}
