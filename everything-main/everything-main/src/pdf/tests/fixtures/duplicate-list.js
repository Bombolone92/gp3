import { PDFDocument, PDFName, PDFHexString, degrees } from 'pdf-lib';

export async function duplicateListPdf({
  unique = false,
  sorted = false,
  inherited = false,
  rotation = 0,
  selected = [],
} = {}) {
  const doc = await PDFDocument.create();
  const form = doc.getForm();
  const field = form.createOptionList('Group.Office');
  const options = [
    { value: 'north', label: unique ? 'Office 1' : 'Office' },
    { value: 'south', label: unique ? 'Office 2' : 'Office' },
    { value: 'other', label: 'Alpha' },
  ];
  field.acroField.setOptions(
    options.map(({ value, label }) => ({
      value: PDFHexString.fromText(value),
      display: PDFHexString.fromText(label),
    })),
  );
  field.enableMultiselect();
  if (sorted) field.enableSorting();
  field.acroField.dict.set(PDFName.of('V'), doc.context.obj(selected.map(PDFHexString.fromText)));
  field.addToPage(doc.addPage([400, 400]), {
    x: rotation === 180 ? 300 : rotation ? 150 : 30,
    y: rotation >= 180 ? 300 : 150,
    width: 240,
    height: 110,
    rotate: degrees(rotation),
  });
  field.setFontSize(12);
  form.updateFieldAppearances();
  if (inherited) {
    const parent = field.acroField.getParent().dict;
    for (const key of ['Opt', 'V', 'Ff']) {
      parent.set(PDFName.of(key), doc.context.register(field.acroField.dict.get(PDFName.of(key))));
      field.acroField.dict.delete(PDFName.of(key));
    }
  }
  return { doc, field };
}
