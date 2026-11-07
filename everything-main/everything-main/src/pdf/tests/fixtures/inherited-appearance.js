import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';

export async function inheritedAppearancePdf({
  kind = 'text',
  level = 'parent',
  indirect = false,
} = {}) {
  const doc = await PDFDocument.create();
  const form = doc.getForm();
  const field =
    kind === 'dropdown'
      ? form.createDropdown('Group.Value')
      : kind === 'list'
        ? form.createOptionList('Group.Value')
        : form.createTextField('Group.Value');
  if (kind === 'dropdown' || kind === 'list') {
    field.setOptions(['Original', 'Changed']);
    field.select('Original');
  } else {
    if (kind === 'multiline') field.enableMultiline();
    field.setText('Original');
  }
  field.addToPage(doc.addPage([400, 400]), {
    x: 40,
    y: 200,
    width: 240,
    height: kind === 'list' || kind === 'multiline' ? 80 : 30,
  });
  field.acroField.dict.set(
    PDFName.of('DA'),
    PDFHexString.fromText('0.7 0.1 0.2 rg /Helvetica 12 Tf'),
  );
  form.updateFieldAppearances();
  // Preserve the source appearance, but store its defaults where PDF viewers also find them.
  const owner = level === 'form' ? form.acroForm.dict : field.acroField.getParent().dict;
  const appearance = indirect
    ? PDFHexString.of(Buffer.from(field.acroField.getDefaultAppearance()).toString('hex'))
    : field.acroField.dict.get(PDFName.of('DA'));
  owner.set(PDFName.of('DA'), indirect ? doc.context.register(appearance) : appearance);
  field.acroField.dict.delete(PDFName.of('DA'));
  return { doc, field, owner };
}
