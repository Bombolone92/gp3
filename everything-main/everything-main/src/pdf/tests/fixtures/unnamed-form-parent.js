import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';

export async function unnamedParentPdf({ parentName } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  const text = form.createTextField('group.Name');
  text.setText('Original');
  text.addToPage(page, { x: 30, y: 320, width: 200, height: 25 });
  const box = form.createCheckBox('group.Accept');
  box.addToPage(page, { x: 30, y: 270, width: 20, height: 20 });
  const radio = form.createRadioGroup('group.Delivery');
  for (const [i, option] of ['Pickup', 'Courier'].entries())
    radio.addOptionToPage(option, page, { x: 30 + i * 80, y: 220, width: 20, height: 20 });
  radio.select('Pickup');
  const choice = form.createDropdown('group.Choice');
  choice.addOptions(['First', 'Second']);
  choice.select('First');
  choice.addToPage(page, { x: 30, y: 170, width: 200, height: 25 });
  const other = form.createTextField('undefined.Name');
  other.setText('Separate field');
  other.addToPage(page, { x: 30, y: 120, width: 200, height: 25 });
  form.updateFieldAppearances();
  const parent = text.acroField.getParent().dict;
  if (parentName === undefined) parent.delete(PDFName.of('T'));
  else parent.set(PDFName.of('T'), doc.context.register(PDFHexString.fromText(parentName)));
  return { doc, text, box, radio, choice, other, parent };
}
