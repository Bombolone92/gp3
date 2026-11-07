import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';

export async function offExportPdf({
  kind = 'radio',
  inherited = false,
  defaultOnly = false,
  selected = true,
} = {}) {
  const doc = await PDFDocument.create();
  const pages = [doc.addPage([300, 300]), doc.addPage([300, 300])];
  const form = doc.getForm();
  const field =
    kind === 'radio'
      ? form.createRadioGroup('Settings.Mode')
      : form.createCheckBox('Settings.Mode');
  for (let i = 0; i < 2; i++) {
    const options = { x: 40, y: 210, width: 25, height: 25 };
    if (kind === 'radio') field.addOptionToPage(i ? 'Other' : 'Off', pages[i], options);
    else {
      field.addToPage(pages[i], options);
      const widget = field.acroField.getWidgets()[i];
      const normal = widget.getAppearances().normal;
      normal.set(PDFName.of(String(i)), normal.get(PDFName.of('Yes')));
      normal.delete(PDFName.of('Yes'));
    }
  }
  field.acroField.dict.set(
    PDFName.of('Opt'),
    doc.context.obj(['Off', 'Other'].map(PDFHexString.fromText)),
  );
  const value = PDFName.of(selected ? '0' : 'Off');
  field.acroField.dict.set(PDFName.of('V'), value);
  field.acroField
    .getWidgets()
    .forEach((widget, i) =>
      widget.setAppearanceState(PDFName.of(selected && i === 0 ? '0' : 'Off')),
    );
  const owner = inherited ? field.acroField.getParent().dict : field.acroField.dict;
  if (inherited) {
    owner.set(PDFName.of('Opt'), doc.context.register(field.acroField.dict.get(PDFName.of('Opt'))));
    field.acroField.dict.delete(PDFName.of('Opt'));
  }
  if (inherited || defaultOnly) {
    owner.set(PDFName.of(defaultOnly ? 'DV' : 'V'), doc.context.register(value));
    field.acroField.dict.delete(PDFName.of('V'));
  }
  return { doc, field };
}
