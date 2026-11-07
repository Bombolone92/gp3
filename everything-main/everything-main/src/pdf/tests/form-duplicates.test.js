import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { PdfSession, deletePage, listFields } from '../src/core/document.js';
import { repairForm } from '../src/core/structure.js';
import { repeatedFieldTree } from './fixtures/form-cycles.js';

it('detects repeated child references before they expand into exponentially many fields', async () => {
  const doc = await PDFDocument.load(await repeatedFieldTree());
  const before = doc.context.enumerateIndirectObjects().map(([ref, obj]) => [ref, obj.toString()]);
  expect(() => listFields(doc)).toThrow('The form in this PDF is damaged');
  expect(doc.context.enumerateIndirectObjects().map(([ref, obj]) => [ref, obj.toString()])).toEqual(
    before,
  );
});

it('repairs repeated child references without duplicating fields, values, or widgets', async () => {
  const bytes = await repeatedFieldTree();
  const session = new PdfSession(bytes);
  await session.change((doc) => deletePage(doc, 1));
  const saved = await PDFDocument.load(session.bytes);
  const fields = saved.getForm().getFields();
  expect(fields).toHaveLength(1);
  expect(fields[0].getName()).toBe('Level7.Level6.Level5.Level4.Level3.Level2.Level1.Level0.Leaf');
  expect(fields[0].getText()).toBe('Saved value');
  expect(fields[0].acroField.getWidgets()).toHaveLength(1);
  expect(repairForm(saved)).toBe(false);
  expect(session.undo()).toBe(true);
  expect(session.bytes).toEqual(bytes);
});

it.each([false, true])(
  'retains the declared parent when another parent repeats its child (wrong parent first: %s)',
  async (wrongFirst) => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const field = doc.getForm().createTextField('Correct.Leaf');
    field.setText('Saved value');
    const fields = doc.getForm().acroForm.Fields();
    const wrong = doc.context.obj({ T: PDFString.of('Wrong'), Kids: [field.ref] });
    const wrongRef = doc.context.register(wrong);
    fields.insert(wrongFirst ? 0 : fields.size(), wrongRef);
    expect(repairForm(doc)).toBe(true);
    expect(wrong.lookup(PDFName.of('Kids')).size()).toBe(0);
    expect(listFields(doc)).toMatchObject([{ name: 'Correct.Leaf', value: 'Saved value' }]);
    expect(repairForm(doc)).toBe(false);
  },
);

it('removes duplicate root entries without changing the field', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const field = doc.getForm().createTextField('Root');
  const fields = doc.getForm().acroForm.Fields();
  fields.push(field.ref);
  expect(repairForm(doc)).toBe(true);
  expect(doc.getForm().acroForm.Fields().size()).toBe(1);
  expect(fields.size()).toBe(2);
  expect(listFields(doc)).toMatchObject([{ name: 'Root' }]);
});

it.each([false, true])(
  'isolates shared child arrays before removing a misplaced reference (wrong parent first: %s)',
  async (wrongFirst) => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const field = doc.getForm().createTextField('Correct.Leaf');
    field.setText('Saved value');
    const correct = field.acroField.getParent().dict;
    const shared = doc.context.register(correct.lookup(PDFName.of('Kids')));
    correct.set(PDFName.of('Kids'), shared);
    const wrong = doc.context.obj({ T: PDFString.of('Wrong'), Kids: shared });
    const fields = doc.getForm().acroForm.Fields();
    fields.insert(wrongFirst ? 0 : fields.size(), doc.context.register(wrong));
    expect(repairForm(doc)).toBe(true);
    expect(listFields(doc)).toMatchObject([{ name: 'Correct.Leaf', value: 'Saved value' }]);
    expect(correct.lookup(PDFName.of('Kids')).asArray()).toEqual([field.ref]);
  },
);

it('prunes empty ancestor groups after removing a misplaced descendant', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const field = doc.getForm().createTextField('Correct.Leaf');
  field.setText('Saved value');
  const inner = doc.context.register(
    doc.context.obj({ T: PDFString.of('Inner'), Kids: [field.ref] }),
  );
  const wrong = doc.context.register(doc.context.obj({ T: PDFString.of('Wrong'), Kids: [inner] }));
  doc.context.lookup(inner).set(PDFName.of('Parent'), wrong);
  doc.getForm().acroForm.Fields().insert(0, wrong);
  expect(repairForm(doc)).toBe(true);
  expect(listFields(doc)).toMatchObject([{ name: 'Correct.Leaf', value: 'Saved value' }]);
  expect(doc.getForm().acroForm.Fields().size()).toBe(1);
  expect(repairForm(doc)).toBe(false);
});

it.each([false, true])(
  'keeps both field values when removing a shared widget from the wrong field (wrong first: %s)',
  async (wrongFirst) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const form = doc.getForm();
    const correct = form.createTextField('Correct');
    correct.setText('First value');
    correct.addToPage(page);
    const wrong = form.createTextField('Wrong');
    wrong.setText('Second value');
    const shared = doc.context.register(correct.acroField.Kids());
    correct.acroField.dict.set(PDFName.of('Kids'), shared);
    wrong.acroField.dict.set(PDFName.of('Kids'), shared);
    if (wrongFirst)
      form.acroForm.dict.set(PDFName.of('Fields'), doc.context.obj([wrong.ref, correct.ref]));
    expect(repairForm(doc)).toBe(true);
    expect(form.getTextField('Correct').getText()).toBe('First value');
    expect(form.getTextField('Wrong').getText()).toBe('Second value');
    expect(correct.acroField.getWidgets()).toHaveLength(1);
    expect(wrong.acroField.getWidgets()).toHaveLength(0);
    expect(form.getFields()).toHaveLength(2);
    expect(repairForm(doc)).toBe(false);
  },
);
