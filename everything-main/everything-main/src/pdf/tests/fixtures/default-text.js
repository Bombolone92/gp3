import { PDFDocument, PDFName, PDFHexString, defaultTextFieldAppearanceProvider } from 'pdf-lib';

export async function defaultTextPdf({
  kind = 'text',
  inherited = false,
  current = 'absent',
} = {}) {
  const doc = await PDFDocument.create();
  const form = doc.getForm();
  const page = doc.addPage([400, 400]);
  const field = form.createTextField('Group.Value');
  const defaultValue = kind === 'multiline' ? 'Default\ntext' : 'Default';
  if (kind === 'multiline') field.enableMultiline();
  if (kind === 'password') field.enablePassword();
  if (kind === 'comb') {
    field.setMaxLength(10);
    field.enableCombing();
  }
  const shown = current === 'empty' ? '' : current === 'override' ? 'Current' : defaultValue;
  field.setText(shown);
  if (!shown) field.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText(''));
  field.addToPage(page, { x: 30, y: 250, width: 240, height: kind === 'multiline' ? 70 : 30 });
  field.setFontSize(12);
  field.updateAppearances(form.getDefaultFont(), (source, widget, font) => {
    const display = Object.create(source);
    display.getText = () => (kind === 'password' ? '*'.repeat(shown.length) : shown);
    return defaultTextFieldAppearanceProvider(display, widget, font);
  });
  const neighbor = form.createTextField('Neighbor');
  neighbor.setText('Original neighbor');
  neighbor.addToPage(page, { x: 30, y: 150, width: 240, height: 30 });
  neighbor.setFontSize(12);
  form.updateFieldAppearances();
  const owner = inherited ? field.acroField.getParent().dict : field.acroField.dict;
  owner.set(PDFName.of('DV'), doc.context.register(PDFHexString.fromText(defaultValue)));
  if (current === 'absent') field.acroField.dict.delete(PDFName.of('V'));
  else if (inherited) {
    owner.set(PDFName.of('V'), doc.context.register(field.acroField.dict.get(PDFName.of('V'))));
    field.acroField.dict.delete(PDFName.of('V'));
  }
  return {
    doc,
    field,
    shown: kind === 'password' ? '*'.repeat(shown.length) : shown,
    defaultValue,
  };
}
