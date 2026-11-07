import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { PdfSession, deletePage, fillFields, listFields } from '../src/core/document.js';
import { flattenCounts, flattenFields } from '../src/core/flatten.js';
import { repairForm } from '../src/core/structure.js';
import { parentCycleKinds, parentCyclePdf } from './fixtures/form-cycles.js';

const expected = [
  { name: 'group.Name', value: 'Inherited value', readOnly: true, type: 'text' },
  { name: 'Safe', value: 'Unchanged', readOnly: false, type: 'text' },
];

it.each(parentCycleKinds)(
  'detects cyclic form parents without changing the source: %s',
  async (kind) => {
    const doc = await PDFDocument.load(await parentCyclePdf(kind));
    const before = doc.context
      .enumerateIndirectObjects()
      .map(([ref, object]) => [ref, object.toString()]);
    expect(() => listFields(doc)).toThrow('The form in this PDF is damaged');
    await expect(fillFields(doc, {})).rejects.toThrow('The form in this PDF is damaged');
    expect(flattenFields(doc)).toBe(0);
    expect(flattenCounts(doc).fields).toBe(0);
    expect(
      doc.context.enumerateIndirectObjects().map(([ref, object]) => [ref, object.toString()]),
    ).toEqual(before);
  },
);

it.each(parentCycleKinds)(
  'repairs cyclic parents using the child hierarchy and preserves inherited fields: %s',
  async (kind) => {
    const bytes = await parentCyclePdf(kind);
    const session = new PdfSession(bytes);
    await session.change((doc) => deletePage(doc, 1));
    const saved = await PDFDocument.load(session.bytes);
    expect(saved.getPageCount()).toBe(1);
    expect(listFields(saved)).toMatchObject(expected);
    expect(repairForm(saved)).toBe(false);
    const nested = saved.getForm().getTextField('group.Name');
    const root = nested.acroField.getParent();
    expect(root.dict.has(PDFName.of('Parent'))).toBe(false);
    expect(nested.acroField.getWidgets()[0].dict.get(PDFName.of('Parent'))).toBe(nested.ref);
    expect(session.undo()).toBe(true);
    expect(session.bytes).toEqual(bytes);
    expect(session.redo()).toBe(true);
    expect(listFields(await PDFDocument.load(session.bytes))).toMatchObject(expected);
  },
);

it('leaves valid nested fields, inheritance, and widget parents unchanged', async () => {
  const doc = await PDFDocument.load(await parentCyclePdf());
  const before = doc.context
    .enumerateIndirectObjects()
    .map(([ref, object]) => [ref, object.toString()]);
  expect(repairForm(doc)).toBe(false);
  expect(listFields(doc)).toMatchObject(expected);
  expect(
    doc.context.enumerateIndirectObjects().map(([ref, object]) => [ref, object.toString()]),
  ).toEqual(before);
});

it('finds a parent loop beyond a deep chain without recursing', async () => {
  const doc = await PDFDocument.load(await parentCyclePdf());
  const root = doc.getForm().getTextField('group.Name').acroField.getParent();
  const ancestor = doc.context.obj({});
  let ref = doc.context.register(ancestor);
  ancestor.set(PDFName.of('Parent'), ref);
  for (let i = 0; i < 10000; i++) ref = doc.context.register(doc.context.obj({ Parent: ref }));
  root.dict.set(PDFName.of('Parent'), ref);
  expect(() => listFields(doc)).toThrow('The form in this PDF is damaged');
  expect(repairForm(doc)).toBe(true);
  expect(listFields(doc)).toMatchObject(expected);
  expect(repairForm(doc)).toBe(false);
});

it('repairs simultaneous child and parent cycles without losing the surviving fields', async () => {
  const doc = await PDFDocument.load(await parentCyclePdf('ancestor and child'));
  const rootRef = doc.catalog.lookup(PDFName.of('AcroForm')).lookup(PDFName.of('Fields')).get(0);
  const root = doc.context.lookup(rootRef);
  const child = root.lookup(PDFName.of('Kids')).lookup(0);
  child.lookup(PDFName.of('Kids')).push(rootRef);
  expect(() => listFields(doc)).toThrow('The form in this PDF is damaged');
  expect(repairForm(doc)).toBe(true);
  expect(listFields(doc)).toMatchObject(expected);
  expect(repairForm(doc)).toBe(false);
});

it('preserves an unusual but acyclic parent chain', async () => {
  const doc = await PDFDocument.load(await parentCyclePdf());
  const root = doc.getForm().getTextField('group.Name').acroField.getParent();
  const outside = doc.context.register(doc.context.obj({ T: PDFString.of('Outside') }));
  root.dict.set(PDFName.of('Parent'), outside);
  expect(repairForm(doc)).toBe(false);
  expect(root.dict.get(PDFName.of('Parent'))).toBe(outside);
  expect(listFields(doc)[0]).toMatchObject({ ...expected[0], name: 'Outside.group.Name' });
});
