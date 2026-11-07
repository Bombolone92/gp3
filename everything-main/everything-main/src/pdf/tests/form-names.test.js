import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fillFields, listFields } from '../src/core/document.js';
import { unnamedParentPdf } from './fixtures/unnamed-form-parent.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

const snapshot = (doc) =>
  doc.context.enumerateIndirectObjects().map(([ref, value]) => [ref.toString(), value.toString()]);

it('does not mistake a literal undefined name for an unnamed parent', async () => {
  const { doc, text, other } = await unnamedParentPdf();
  await fillFields(doc, { 'undefined.Name': 'Updated separately' });
  expect(text.getText()).toBe('Original');
  expect(other.getText()).toBe('Updated separately');
});

it('skips an unnamed intermediate parent while retaining named ancestors', async () => {
  const { doc, text, parent } = await unnamedParentPdf();
  const form = doc.getForm();
  const anchor = form.createTextField('Customer.Anchor');
  const outer = anchor.acroField.getParent();
  const parentRef = text.acroField.dict.get(PDFName.of('Parent'));
  outer.dict.lookup(PDFName.of('Kids')).push(parentRef);
  parent.set(PDFName.of('Parent'), outer.ref);
  const roots = form.acroForm.dict.lookup(PDFName.of('Fields'));
  roots.remove(roots.indexOf(parentRef));
  expect(listFields(doc).map(({ name }) => name)).toContain('Customer.Name');
  await fillFields(doc, { 'Customer.Name': 'Nested update' });
  expect(text.getText()).toBe('Nested update');
  expect(parent.has(PDFName.of('T'))).toBe(false);
  const task = pdfjs.getDocument({ data: await doc.save() });
  try {
    const widgets = await (await (await task.promise).getPage(1)).getAnnotations();
    expect(widgets.find((widget) => widget.fieldName === 'Customer.Name')?.fieldValue).toBe(
      'Nested update',
    );
  } finally {
    await task.destroy();
  }
});

it('preserves the first-match behavior of actual duplicate names', async () => {
  const { doc, text, other, parent } = await unnamedParentPdf();
  parent.set(PDFName.of('T'), PDFHexString.fromText('undefined'));
  await fillFields(doc, { 'undefined.Name': 'First match' });
  expect(text.getText()).toBe('First match');
  expect(other.getText()).toBe('Separate field');
});

for (const parentName of [undefined, '', 'Customer', '客户']) {
  const prefix = parentName === undefined ? '' : `${parentName}.`;
  it(`reads the same field names as the renderer without changing the PDF (parent=${parentName})`, async () => {
    const { doc } = await unnamedParentPdf({ parentName });
    const bytes = await doc.save({ updateFieldAppearances: false });
    const before = snapshot(doc);
    const names = listFields(doc).map((field) => field.name);
    expect(names).toEqual([
      `${prefix}Name`,
      `${prefix}Accept`,
      `${prefix}Delivery`,
      `${prefix}Choice`,
      'undefined.Name',
    ]);
    expect(snapshot(doc)).toEqual(before);
    const task = pdfjs.getDocument({ data: bytes });
    try {
      const widgets = await (await (await task.promise).getPage(1)).getAnnotations();
      expect([...new Set(widgets.map((widget) => widget.fieldName))]).toEqual(names);
    } finally {
      await task.destroy();
    }
  });

  it(`edits each field by its displayed name and preserves distinct names (parent=${parentName})`, async () => {
    const { doc, text, box, radio, choice, other, parent } = await unnamedParentPdf({ parentName });
    const parentEntry = parent.get(PDFName.of('T'));
    expect(
      await fillFields(doc, {
        [`${prefix}Name`]: 'Updated',
        [`${prefix}Accept`]: true,
        [`${prefix}Delivery`]: ['Courier'],
        [`${prefix}Choice`]: ['Second'],
      }),
    ).not.toBe(false);
    expect(text.getText()).toBe('Updated');
    expect(box.isChecked()).toBe(true);
    expect(radio.getSelected()).toBe('Courier');
    expect(choice.getSelected()).toEqual(['Second']);
    expect(other.getText()).toBe('Separate field');
    expect(parent.get(PDFName.of('T'))).toBe(parentEntry);
    const saved = await PDFDocument.load(await doc.save());
    expect(listFields(saved).map(({ name, value }) => [name, value])).toEqual([
      [`${prefix}Name`, 'Updated'],
      [`${prefix}Accept`, true],
      [`${prefix}Delivery`, 'Courier'],
      [`${prefix}Choice`, ['Second']],
      ['undefined.Name', 'Separate field'],
    ]);
    expect(await fillFields(saved, { 'undefined.Name': 'Separate update' })).not.toBe(false);
    expect(listFields(saved)[0].value).toBe('Updated');
    expect(listFields(saved).at(-1).value).toBe('Separate update');
  });

  it(`keeps no-op, read-only and unknown-name behavior (parent=${parentName})`, async () => {
    const { doc, text, other } = await unnamedParentPdf({ parentName });
    expect(await fillFields(doc, { [`${prefix}Name`]: 'Original' })).toBe(false);
    text.enableReadOnly();
    expect(await fillFields(doc, { [`${prefix}Name`]: 'Ignored' })).toBe(false);
    expect(text.getText()).toBe('Original');
    await expect(fillFields(doc, { 'missing.Name': 'Ignored' })).rejects.toThrow('no form field');
    expect(other.getText()).toBe('Separate field');
  });
}
