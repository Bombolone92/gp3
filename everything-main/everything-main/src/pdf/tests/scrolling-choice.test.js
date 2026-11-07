import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { fillFields } from '../src/core/document.js';
import { updateFieldAppearance } from '../src/core/form-appearance.js';
import { flattenDocument } from '../src/core/flatten.js';
import { scrollingChoicePdf, selectedPixels } from './fixtures/scrolling-choice.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

it('keeps a newly selected last option visible in the exported list appearance', async () => {
  const { doc: source } = await scrollingChoicePdf();
  const doc = await PDFDocument.load(await source.save());
  expect(await selectedPixels(await doc.save())).toBeGreaterThan(1000);
  await fillFields(doc, { Destination: ['Choice 12'] });
  const bytes = await doc.save();
  expect(
    (await PDFDocument.load(bytes)).getForm().getOptionList('Destination').getSelected(),
  ).toEqual(['Choice 12']);
  expect(await selectedPixels(bytes)).toBeGreaterThan(1000);
  expect(
    doc.getForm().getOptionList('Destination').acroField.dict.lookup(PDFName.of('TI')).asNumber(),
  ).toBeGreaterThan(0);
});

it('scrolls back for a new first selection and keeps the scroll position when cleared', async () => {
  const { doc } = await scrollingChoicePdf();
  await fillFields(doc, { Destination: ['Choice 12'] });
  const field = doc.getForm().getOptionList('Destination');
  const top = field.acroField.dict.get(PDFName.of('TI'));
  await fillFields(doc, { Destination: [] });
  expect(field.acroField.dict.get(PDFName.of('TI'))).toBe(top);
  expect(await selectedPixels(await doc.save())).toBe(0);
  await fillFields(doc, { Destination: ['Choice 01'] });
  expect(await selectedPixels(await doc.save())).toBeGreaterThan(1000);
  expect(field.acroField.dict.lookup(PDFName.of('TI'))?.asNumber?.() || 0).toBe(0);
});

for (const selected of ['Choice 01', 'Choice 12'])
  it(`retains an explicit scroll position when regenerating a list with ${selected} selected`, async () => {
    const { doc, field } = await scrollingChoicePdf();
    field.select(selected);
    field.acroField.dict.set(PDFName.of('TI'), PDFNumber.of(8));
    updateFieldAppearance(field, doc.getForm(), doc.getForm().getDefaultFont());
    expect(field.acroField.dict.lookup(PDFName.of('TI')).asNumber()).toBe(8);
    const count = await selectedPixels(await doc.save());
    if (selected === 'Choice 01') expect(count).toBe(0);
    else expect(count).toBeGreaterThan(1000);
  });

it('keeps selected export values visible through sorting, multiselect, and flattening a missing appearance', async () => {
  const { doc, field } = await scrollingChoicePdf();
  field.setOptions(field.getOptions().reverse());
  field.enableSorting();
  field.enableMultiselect();
  await fillFields(doc, { Destination: ['Choice 11', 'Choice 12'] });
  expect(field.getSelected()).toEqual(['Choice 11', 'Choice 12']);
  expect(await selectedPixels(await doc.save())).toBeGreaterThan(2000);
  for (const widget of field.acroField.getWidgets()) widget.dict.delete(PDFName.of('AP'));
  flattenDocument(doc);
  expect(doc.getForm().getFields()).toHaveLength(0);
  expect(await selectedPixels(await doc.save())).toBeGreaterThan(2000);
});
