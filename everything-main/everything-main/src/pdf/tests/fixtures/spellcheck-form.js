import { PDFDocument, PDFName } from 'pdf-lib';

export async function spellcheckFormPdf({ inherited = false, readOnly = false } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 700]);
  const form = doc.getForm();
  const fields = [];
  for (const kind of ['Text', 'Notes', 'Choice', 'Password']) {
    for (const enabled of [false, true]) {
      const name = `${kind}${enabled ? 'Enabled' : 'Disabled'}.Value`;
      const field = kind === 'Choice' ? form.createDropdown(name) : form.createTextField(name);
      if (kind === 'Choice') {
        field.enableEditing();
        field.setOptions(['Original', 'Other']);
        field.select('Original');
      } else {
        if (kind === 'Notes') field.enableMultiline();
        if (kind === 'Password') field.enablePassword();
        field.setText('Original');
      }
      if (!enabled) field.disableSpellChecking();
      if (readOnly) field.enableReadOnly();
      field.addToPage(page, { x: 30, y: 620 - fields.length * 75, width: 260, height: 45 });
      if (inherited) {
        const flags = field.acroField.dict.get(PDFName.of('Ff'));
        field.acroField.getParent().dict.set(PDFName.of('Ff'), doc.context.register(flags));
        field.acroField.dict.delete(PDFName.of('Ff'));
      }
      fields.push({ name, kind, enabled });
    }
  }
  form.updateFieldAppearances();
  return { doc, fields };
}
