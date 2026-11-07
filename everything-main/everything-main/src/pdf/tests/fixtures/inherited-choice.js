import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';

export const inheritedChoices = [
  { value: 'CA', label: 'Canada' },
  { value: 'FR', label: 'France' },
  { value: 'JP', label: 'Japan' },
];

export async function inheritedChoicePdf({
  list = false,
  indirect = false,
  defaultOnly = false,
} = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  const field = list
    ? form.createOptionList('Destination.Country')
    : form.createDropdown('Destination.Country');
  if (list) field.enableMultiselect();
  field.acroField.setOptions(
    inheritedChoices.map(({ value, label }) => ({
      value: PDFHexString.fromText(value),
      display: PDFHexString.fromText(label),
    })),
  );
  field.addToPage(page, { x: 30, y: 200, width: 240, height: list ? 120 : 30 });
  field.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText('CA'));
  form.updateFieldAppearances();
  const parent = field.acroField.getParent().dict;
  const options = field.acroField.dict.get(PDFName.of('Opt'));
  parent.set(PDFName.of('Opt'), indirect ? doc.context.register(options) : options);
  field.acroField.dict.delete(PDFName.of('Opt'));
  if (defaultOnly) {
    parent.set(PDFName.of('DV'), field.acroField.dict.get(PDFName.of('V')));
    field.acroField.dict.delete(PDFName.of('V'));
  }
  return { doc, field, parent };
}
