import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';

export async function malformedAppearancePdf({
  kind = 'text',
  location = 'field',
  appearance = '/Helvetica ' + '9'.repeat(400) + ' Tf',
  rotation = 0,
} = {}) {
  const doc = await PDFDocument.create(),
    form = doc.getForm(),
    page = doc.addPage([400, 400]);
  const field =
    kind === 'checkbox'
      ? form.createCheckBox('Value')
      : kind === 'radio'
        ? form.createRadioGroup('Value')
        : kind === 'button'
          ? form.createButton('Value')
          : kind === 'dropdown'
            ? form.createDropdown('Value')
            : form.createTextField('Value');
  const options = {
    x: rotation === 180 ? 300 : rotation ? 150 : 30,
    y: rotation >= 180 ? 300 : 150,
    width: kind === 'checkbox' || kind === 'radio' ? 30 : 240,
    height: kind === 'multiline' ? 100 : 30,
    rotate: degrees(rotation),
  };
  if (kind === 'dropdown') {
    field.setOptions(['Original', 'Changed']);
    field.select('Original');
  } else if (['text', 'multiline', 'comb', 'password'].includes(kind)) {
    if (kind === 'multiline') field.enableMultiline();
    if (kind === 'comb') {
      field.setMaxLength(12);
      field.enableCombing();
    }
    if (kind === 'password') field.enablePassword();
    field.setText(kind === 'multiline' ? 'Original\ntext' : 'Original');
  }
  if (kind === 'radio') {
    field.addOptionToPage('Yes', page, options);
    field.addOptionToPage('No', page, { ...options, x: options.x + 50 });
    field.select('Yes');
  } else if (kind === 'button') field.addToPage('Submit', page, options);
  else {
    field.addToPage(page, options);
    if (kind === 'checkbox') field.check();
  }
  form.updateFieldAppearances();
  const target =
    location === 'widget' ? field.acroField.getWidgets()[0].dict : field.acroField.dict;
  target.set(PDFName.of('DA'), PDFString.of(appearance));
  return { doc, field };
}
