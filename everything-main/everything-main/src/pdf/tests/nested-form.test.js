import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  listFields,
  fillFields,
  deletePage,
  duplicatePage,
  PdfSession,
  rotatePage,
} from '../src/core/document.js';
import { formFields } from '../src/core/structure.js';
import { flattenFields, flattenCounts } from '../src/core/flatten.js';
import { nestedFormPdf } from './fixtures/nested-form.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

for (const depth of [1, 2, 20])
  it(`reads and fills fields below ${depth} unnamed groups without renaming the hierarchy`, async () => {
    const { doc: source, text } = await nestedFormPdf({ depth });
    const doc = await PDFDocument.load(await source.save({ updateFieldAppearances: false }));
    const snapshot = () =>
      doc.context.enumerateIndirectObjects().map(([ref, object]) => [ref, object.toString()]);
    const before = snapshot();
    expect(listFields(doc).map(({ name }) => name)).toEqual([
      'Customer.Name',
      'Customer.Accept',
      'Customer.Delivery',
      'Customer.Choice',
      'undefined.Name',
    ]);
    expect(snapshot()).toEqual(before);
    await fillFields(doc, {
      'Customer.Name': 'Nested update',
      'Customer.Accept': true,
      'Customer.Delivery': ['Courier'],
      'Customer.Choice': ['Second'],
    });
    expect(doc.context.lookup(text.ref).lookup(PDFName.of('V')).decodeText()).toBe('Nested update');
    expect(doc.context.lookup(text.ref).lookup(PDFName.of('Parent')).has(PDFName.of('T'))).toBe(
      false,
    );
    const task = pdfjs.getDocument({ data: await doc.save() });
    try {
      const annotations = await (await (await task.promise).getPage(1)).getAnnotations();
      expect(annotations.find((a) => a.fieldName === 'Customer.Name').fieldValue).toBe(
        'Nested update',
      );
      expect(annotations.find((a) => a.fieldName === 'Customer.Choice').fieldValue).toEqual([
        'Second',
      ]);
    } finally {
      await task.destroy();
    }
    expect(flattenCounts(doc).fields).toBe(5);
    expect(flattenFields(doc)).toBe(5);
    const flat = pdfjs.getDocument({ data: await doc.save() });
    try {
      const page = await (await flat.promise).getPage(1);
      expect((await page.getAnnotations()).filter((a) => a.subtype === 'Widget')).toHaveLength(0);
      expect((await page.getTextContent()).items.map((item) => item.str).join(' ')).toContain(
        'Nested update',
      );
    } finally {
      await flat.destroy();
    }
  });

it('removes nested fields when deleting their last page', async () => {
  const { doc } = await nestedFormPdf();
  doc.addPage();
  deletePage(doc, 0);
  expect(doc.getForm().acroForm.dict.lookup(PDFName.of('Fields')).size()).toBe(0);
});

it('duplicates nested form pages as fixed content while retaining the original fields', async () => {
  const { doc } = await nestedFormPdf();
  await duplicatePage(doc, 0);
  expect(doc.getPageCount()).toBe(2);
  expect(listFields(doc)).toHaveLength(5);
  const task = pdfjs.getDocument({ data: await doc.save() });
  try {
    const page = await (await task.promise).getPage(2);
    expect((await page.getAnnotations()).filter((a) => a.subtype === 'Widget')).toHaveLength(0);
    expect((await page.getTextContent()).items.map((item) => item.str).join(' ')).toContain(
      'Original',
    );
  } finally {
    await task.destroy();
  }
});

it('saves unrelated page edits without changing nested field values or names', async () => {
  const { doc } = await nestedFormPdf();
  const bytes = await doc.save({ updateFieldAppearances: false });
  const session = new PdfSession(bytes);
  await session.change((source) => rotatePage(source, 0));
  const saved = await PDFDocument.load(session.bytes);
  expect(saved.getPage(0).getRotation().angle).toBe(90);
  expect(listFields(saved)[0]).toMatchObject({ name: 'Customer.Name', value: 'Original' });
  expect(session.undo()).toBe(true);
  expect(session.bytes).toEqual(bytes);
  expect(session.redo()).toBe(true);
});

it('does not regenerate untouched Unicode fields during unrelated page edits', async () => {
  const { doc, text } = await nestedFormPdf();
  text.acroField.setValue(PDFHexString.fromText('你好'));
  text.acroField.getWidgets()[0].dict.delete(PDFName.of('AP'));
  const session = new PdfSession(await doc.save({ updateFieldAppearances: false }));
  await session.change((source) => rotatePage(source, 0));
  const saved = await PDFDocument.load(session.bytes);
  const field = saved.context.lookup(text.ref);
  expect(saved.getPage(0).getRotation().angle).toBe(90);
  expect(field.lookup(PDFName.of('V')).decodeText()).toBe('你好');
  expect(field.lookup(PDFName.of('Kids')).lookup(0).has(PDFName.of('AP'))).toBe(false);
});

it('retains option lists, push buttons, and signatures under unnamed groups', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  const list = form.createOptionList('Outer.Middle.List');
  list.setOptions(['One', 'Two']);
  list.select('Two');
  list.addToPage(page, { x: 20, y: 600, width: 100, height: 50 });
  const button = form.createButton('Outer.Middle.Button');
  button.addToPage('Button', page, { x: 20, y: 500, width: 100, height: 30 });
  const parent = list.acroField.getParent();
  const signature = doc.context.register(
    doc.context.obj({ FT: 'Sig', T: PDFHexString.fromText('Signature') }),
  );
  const dict = doc.context.lookup(signature);
  dict.set(PDFName.of('Parent'), parent.ref);
  parent.dict.lookup(PDFName.of('Kids')).push(signature);
  parent.dict.delete(PDFName.of('T'));
  expect(formFields(doc).map((field) => field.constructor.name)).toEqual([
    'PDFOptionList',
    'PDFButton',
    'PDFSignature',
  ]);
  expect(listFields(doc)).toMatchObject([
    { name: 'Outer.List', value: ['Two'], type: 'select' },
    { name: 'Outer.Button', type: 'unsupported' },
    { name: 'Outer.Signature', type: 'unsupported' },
  ]);
  await fillFields(doc, { 'Outer.List': ['One'] });
  expect(list.getSelected()).toEqual(['One']);
  await expect(doc.save()).resolves.toBeInstanceOf(Uint8Array);
});

it('recognizes an unnamed field merged into its widget', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const text = doc.getForm().createTextField('Customer.Name');
  text.setText('Original');
  text.addToPage(page, { x: 20, y: 600, width: 100, height: 30 });
  const parent = text.acroField.getParent();
  const widget = text.acroField.getWidgets()[0];
  const ref = page.node.lookup(PDFName.of('Annots')).get(0);
  for (const [key, value] of text.acroField.dict.entries())
    if (!['T', 'Kids'].includes(key.decodeText())) widget.dict.set(key, value);
  widget.dict.set(PDFName.of('Parent'), parent.ref);
  parent.dict.set(PDFName.of('Kids'), doc.context.obj([ref]));
  expect(listFields(doc)).toMatchObject([{ name: 'Customer', type: 'text', value: 'Original' }]);
  await fillFields(doc, { Customer: 'Merged update' });
  expect(widget.dict.lookup(PDFName.of('V')).decodeText()).toBe('Merged update');
  await expect(doc.save()).resolves.toBeInstanceOf(Uint8Array);
});
