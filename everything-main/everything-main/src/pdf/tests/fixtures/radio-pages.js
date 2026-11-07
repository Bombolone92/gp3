import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';

export async function radioPagesPdf({
  selected = 'Pickup',
  defaultOnly = true,
  inherited = false,
  exportNamed = false,
  inheritedOptions = false,
} = {}) {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([300, 300]), doc.addPage([300, 300])];
  const field = doc.getForm().createRadioGroup('Delivery');
  ['Courier', 'Pickup', 'Express'].forEach((option, i) =>
    field.addOptionToPage(option, pages[i ? 1 : 0], {
      x: 40 + i * 80,
      y: 200,
      width: 20,
      height: 20,
    }),
  );
  if (selected === 'Off') field.clear();
  else field.select(selected);
  const value = exportNamed ? PDFName.of(selected) : field.acroField.V();
  const owner =
    inherited || inheritedOptions
      ? doc.context.obj({ T: PDFHexString.fromText('Shipping'), Kids: [field.ref] })
      : field.acroField.dict;
  owner.set(PDFName.of('DV'), doc.context.register(value));
  if (defaultOnly) field.acroField.dict.delete(PDFName.of('V'));
  else if (inherited) {
    owner.set(PDFName.of('V'), doc.context.register(value));
    field.acroField.dict.delete(PDFName.of('V'));
  } else if (exportNamed) field.acroField.dict.set(PDFName.of('V'), value);
  if (inheritedOptions) {
    owner.set(PDFName.of('Opt'), field.acroField.dict.get(PDFName.of('Opt')));
    field.acroField.dict.delete(PDFName.of('Opt'));
  }
  if (inherited || inheritedOptions) {
    const ref = doc.context.register(owner);
    field.acroField.dict.set(PDFName.of('Parent'), ref);
    doc.catalog.lookup(PDFName.of('AcroForm')).set(PDFName.of('Fields'), doc.context.obj([ref]));
  }
  return { doc, field };
}
