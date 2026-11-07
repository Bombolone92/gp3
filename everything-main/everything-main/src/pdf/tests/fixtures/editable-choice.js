import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';

export async function editableChoicePdf({
  inherited = false,
  defaultOnly = false,
  readOnly = false,
} = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  const field = form.createDropdown('Destination.Country');
  field.enableEditing();
  if (readOnly) field.enableReadOnly();
  field.acroField.setOptions([
    { value: PDFHexString.fromText('CA'), display: PDFHexString.fromText('Canada') },
    { value: PDFHexString.fromText('FR'), display: PDFHexString.fromText('France') },
    { value: PDFHexString.fromText(''), display: PDFHexString.fromText('') },
  ]);
  field.acroField.setValues([PDFHexString.fromText('CA')]);
  field.addToPage(page, { x: 30, y: 300, width: 240, height: 30 });
  if (inherited) {
    const flags = field.acroField.dict.get(PDFName.of('Ff'));
    field.acroField.getParent().dict.set(PDFName.of('Ff'), doc.context.register(flags));
    field.acroField.dict.delete(PDFName.of('Ff'));
  }
  if (defaultOnly) {
    field.acroField.dict.set(PDFName.of('DV'), field.acroField.dict.get(PDFName.of('V')));
    field.acroField.dict.delete(PDFName.of('V'));
  }
  const fixed = form.createDropdown('Fixed');
  fixed.setOptions(['A', 'B']);
  fixed.select('A');
  fixed.addToPage(page, { x: 30, y: 230, width: 240, height: 30 });
  const multiple = form.createDropdown('Multiple');
  multiple.setOptions(['First', 'Second', 'Third']);
  multiple.enableMultiselect();
  multiple.enableEditing();
  multiple.select(['First', 'Second']);
  multiple.addToPage(page, { x: 30, y: 120, width: 240, height: 70 });
  form.updateFieldAppearances();
  return { doc, field };
}
