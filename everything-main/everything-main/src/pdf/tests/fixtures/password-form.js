import { PDFDocument, PDFName } from 'pdf-lib';

export async function passwordFormPdf({ inherited = false, readOnly = false } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const form = doc.getForm();
  const secret = form.createTextField('Account.Secret');
  secret.enablePassword();
  if (readOnly) secret.enableReadOnly();
  secret.setText('Example passphrase');
  secret.addToPage(page, { x: 30, y: 310, width: 240, height: 30 });
  if (inherited) {
    const flags = secret.acroField.dict.get(PDFName.of('Ff'));
    secret.acroField.getParent().dict.set(PDFName.of('Ff'), doc.context.register(flags));
    secret.acroField.dict.delete(PDFName.of('Ff'));
  }
  const name = form.createTextField('Name');
  name.setText('Original name');
  name.addToPage(page, { x: 30, y: 250, width: 240, height: 30 });
  const notes = form.createTextField('Notes');
  notes.enableMultiline();
  notes.setText('First line\nSecond line');
  notes.addToPage(page, { x: 30, y: 140, width: 240, height: 70 });
  form.updateFieldAppearances();
  return { doc, secret };
}
