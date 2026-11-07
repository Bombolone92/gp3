import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fillFields, listFields } from '../src/core/document.js';
import { checkboxOptionsPdf, incompleteCheckboxPdf } from './fixtures/checkbox-options.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());
const states = (field) =>
  field.acroField.getWidgets().map((widget) => widget.getAppearanceState().decodeText());
for (const appearance of ['missing', 'off-only'])
  for (const selected of ['A', 'B'])
    it(`clears a checkbox group with a ${appearance} appearance (selected=${selected})`, async () => {
      const { doc } = await incompleteCheckboxPdf(appearance, selected);
      const reopened = await PDFDocument.load(await doc.save({ updateFieldAppearances: false }));
      const field = reopened.getForm().getCheckBox('Delivery');
      expect(field.acroField.getWidgets()[2].getOnValue()).toBeUndefined();
      await fillFields(reopened, { Delivery: [] });
      expect(field.acroField.getValue().decodeText()).toBe('Off');
      expect(states(field)).toEqual(['Off', 'Off', 'Off']);
      expect(listFields(reopened)[0].value).toEqual([]);
      expect(await fillFields(reopened, { Delivery: [] })).toBe(false);
      await fillFields(reopened, { Delivery: ['Pickup'] });
      expect(states(field)).toEqual(['Off', 'B', 'Off']);
      const saved = await PDFDocument.load(await reopened.save());
      expect(listFields(saved)[0].value).toEqual(['Pickup']);
      expect(states(saved.getForm().getCheckBox('Delivery'))).toEqual(['Off', 'B', 'Off']);
    });
for (const inherited of [false, true])
  for (const indirect of [false, true])
    for (const separatePages of [false, true])
      it(`edits checkbox exports independently of appearance names (inherited=${inherited}, indirect=${indirect}, pages=${separatePages})`, async () => {
        const { doc, field } = await checkboxOptionsPdf({ inherited, indirect, separatePages });
        expect(listFields(doc)[0]).toMatchObject({
          options: ['Courier', 'Pickup'],
          value: ['Courier'],
        });
        expect(await fillFields(doc, { [field.getName()]: ['Pickup'] })).toBeUndefined();
        expect(field.acroField.getValue().decodeText()).toBe('B');
        expect(states(field)).toEqual(['Off', 'B']);
        expect(await fillFields(doc, { [field.getName()]: ['Pickup'] })).toBe(false);
        const bytes = await doc.save();
        const reopened = await PDFDocument.load(bytes);
        expect(listFields(reopened)[0].value).toEqual(['Pickup']);
        const task = pdfjs.getDocument({ data: bytes.slice() });
        try {
          const pdf = await task.promise;
          const widgets = (
            await Promise.all(
              Array.from({ length: pdf.numPages }, async (_, i) =>
                (await pdf.getPage(i + 1)).getAnnotations(),
              ),
            )
          ).flat();
          expect(widgets.map((w) => [w.exportValue, w.fieldValue])).toEqual([
            ['Courier', 'Off'],
            ['Pickup', 'Pickup'],
          ]);
        } finally {
          await task.destroy();
        }
        await fillFields(doc, { [field.getName()]: [] });
        expect(states(field)).toEqual(['Off', 'Off']);
        expect(listFields(doc)[0].value).toEqual([]);
      });

for (const values of [
  ['', 'Pickup'],
  [null, 'Pickup'],
  ['B', 'A'],
])
  it(`preserves option indexing and empty or overlapping exports: ${JSON.stringify(values)}`, async () => {
    const { doc, field } = await checkboxOptionsPdf({ values, selected: 'Off' });
    const first = values[0] ?? 'A';
    expect(listFields(doc)[0].options).toEqual([first, values[1]]);
    await fillFields(doc, { [field.getName()]: [first] });
    expect(field.acroField.getValue().decodeText()).toBe('A');
    expect(listFields(doc)[0].value).toEqual([first]);
    await fillFields(doc, { [field.getName()]: [values[1]] });
    expect(field.acroField.getValue().decodeText()).toBe('B');
    await expect(fillFields(doc, { [field.getName()]: ['Missing'] })).rejects.toThrow(
      'available form options',
    );
    expect(states(field)).toEqual(['Off', 'B']);
    await fillFields(doc, { [field.getName()]: [] });
    expect(field.acroField.getValue().decodeText()).toBe('Off');
  });

it('keeps an already selected appearance when duplicate exports describe the same choice', async () => {
  const { doc, field } = await checkboxOptionsPdf({ values: ['Shared', 'Shared'], selected: 'B' });
  expect(listFields(doc)[0]).toMatchObject({ options: ['Shared'], value: ['Shared'] });
  expect(await fillFields(doc, { [field.getName()]: ['Shared'] })).toBe(false);
  expect(states(field)).toEqual(['Off', 'B']);
});
