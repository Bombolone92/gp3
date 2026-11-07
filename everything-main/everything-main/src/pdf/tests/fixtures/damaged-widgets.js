import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

export async function damagedWidgetsPdf(type = 'text', damage = 'entry') {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([400, 400]), doc.addPage([400, 400]), doc.addPage([400, 400])];
  const form = doc.getForm();
  const field =
    type === 'radio'
      ? form.createRadioGroup('Keep')
      : type === 'checkbox'
        ? form.createCheckBox('Keep')
        : form.createTextField('Keep');
  for (let i = 0; i < 2; i++) {
    const options = { x: 40, y: 200, width: type === 'text' ? 200 : 20, height: 25 };
    if (type === 'radio') field.addOptionToPage(i ? 'Second' : 'First', pages[i], options);
    else field.addToPage(pages[i], options);
  }
  if (type === 'text') field.setText('Retained value');
  else if (type === 'checkbox') field.check();
  else field.select('Second');
  form.updateFieldAppearances();
  if (damage === 'entry') {
    field.acroField.Kids().insert(1, PDFString.of('invalid widget'));
    if (type === 'radio')
      field.acroField.dict.lookup(PDFName.of('Opt')).insert(1, PDFString.of('unused export'));
  } else if (damage === 'array')
    field.acroField.dict.set(PDFName.of('Kids'), PDFString.of('invalid widget array'));
  return doc.save({ updateFieldAppearances: false });
}
