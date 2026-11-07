import { PDFDocument, PDFName } from 'pdf-lib';

export async function sharedAppearancePdf({ kind = 'text', indirect = true } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  const fields = [];
  for (const [i, name] of ['First', 'Second'].entries()) {
    const field =
      kind === 'dropdown'
        ? form.createDropdown(name)
        : kind === 'list'
          ? form.createOptionList(name)
          : kind === 'checkbox'
            ? form.createCheckBox(name)
            : kind === 'radio'
              ? form.createRadioGroup(name)
              : kind === 'button'
                ? form.createButton(name)
                : form.createTextField(name);
    if (kind === 'dropdown' || kind === 'list') {
      field.setOptions(['Old', 'New']);
      field.select('Old');
    } else if (kind === 'text') field.setText('Old');
    const options = {
      x: 30,
      y: i ? 80 : 280,
      width: ['checkbox', 'radio'].includes(kind) ? 40 : 280,
      height: kind === 'list' ? 70 : 40,
    };
    if (kind === 'radio') field.addOptionToPage('Yes', page, options);
    else if (kind === 'button') field.addToPage('Old', page, options);
    else field.addToPage(page, options);
    fields.push(field);
  }
  form.updateFieldAppearances();
  const appearances = fields[0].acroField.getWidgets()[0].dict.lookup(PDFName.of('AP'));
  // Readers can use the same normal and interactive drawings in both widgets.
  appearances.set(PDFName.of('R'), appearances.get(PDFName.of('N')));
  appearances.set(PDFName.of('D'), appearances.get(PDFName.of('N')));
  const shared = indirect ? doc.context.register(appearances) : appearances;
  for (const field of fields) field.acroField.getWidgets()[0].dict.set(PDFName.of('AP'), shared);
  return { doc, first: fields[0], second: fields[1] };
}
