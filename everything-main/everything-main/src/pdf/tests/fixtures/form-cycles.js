import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

/** A nested field with inherited values, plus an independent field and a spare page. */
export async function parentCyclePdf(kind) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  doc.addPage([400, 300]);
  const form = doc.getForm();
  const field = form.createTextField('group.Name');
  field.setText('Inherited value');
  field.addToPage(page, { x: 30, y: 200, width: 200, height: 30 });
  const safe = form.createTextField('Safe');
  safe.setText('Unchanged');
  safe.addToPage(page, { x: 30, y: 140, width: 200, height: 30 });
  form.updateFieldAppearances();
  const child = field.acroField.dict;
  const rootRef = child.get(PDFName.of('Parent'));
  const root = doc.context.lookup(rootRef);
  root.set(PDFName.of('FT'), PDFName.of('Tx'));
  root.set(PDFName.of('Ff'), doc.context.obj(1));
  root.set(PDFName.of('V'), PDFString.of('Inherited value'));
  for (const key of ['FT', 'Ff', 'V']) child.delete(PDFName.of(key));
  const parent = PDFName.of('Parent');
  if (kind === 'root self') root.set(parent, rootRef);
  else if (kind === 'child self') child.set(parent, field.ref);
  else if (kind === 'ancestor and child') root.set(parent, field.ref);
  else if (kind === 'two roots') {
    root.set(parent, safe.ref);
    safe.acroField.dict.set(parent, rootRef);
  } else if (kind === 'external ancestors' || kind === 'multiple cycles') {
    const outside = doc.context.obj({ T: PDFString.of('Outside') });
    const outsideRef = doc.context.register(outside);
    root.set(parent, outsideRef);
    outside.set(parent, kind === 'multiple cycles' ? field.ref : outsideRef);
    if (kind === 'multiple cycles') child.set(parent, field.ref);
  }
  return doc.save({ updateFieldAppearances: false });
}

export const parentCycleKinds = [
  'root self',
  'child self',
  'ancestor and child',
  'two roots',
  'external ancestors',
  'multiple cycles',
];

/** One field listed twice at every level, multiplying an unguarded tree walk by 2^depth. */
export async function repeatedFieldTree(depth = 8) {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  doc.addPage();
  const field = doc.getForm().createTextField('Leaf');
  field.setText('Saved value');
  field.addToPage(page);
  doc.getForm().updateFieldAppearances();
  let dict = field.acroField.dict,
    ref = field.ref;
  for (let i = 0; i < depth; i++) {
    const parent = doc.context.obj({ T: PDFString.of(`Level${i}`), Kids: [ref, ref] });
    const parentRef = doc.context.register(parent);
    dict.set(PDFName.of('Parent'), parentRef);
    dict = parent;
    ref = parentRef;
  }
  doc.getForm().acroForm.dict.set(PDFName.of('Fields'), doc.context.obj([ref]));
  return doc.save({ updateFieldAppearances: false });
}
