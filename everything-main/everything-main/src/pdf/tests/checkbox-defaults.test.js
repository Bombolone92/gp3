import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { deletePage, fillFields, listFields } from '../src/core/document.js';
import {
  checkboxOptionsPdf,
  checkboxDeletionPdf,
  useCheckboxDefault,
} from './fixtures/checkbox-options.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

it('keeps an absent value absent when deleting a widget without an on appearance', async () => {
  const { doc, field } = await checkboxDeletionPdf({ selected: 'Off' });
  field.acroField.dict.delete(PDFName.of('V'));
  field.acroField.getWidgets()[2].dict.delete(PDFName.of('AP'));
  deletePage(doc, 1);
  expect(field.acroField.V()).toBeUndefined();
  expect(listFields(doc)[0].value).toBe(false);
});

for (const inherited of [false, true])
  for (const selected of ['A', 'B'])
    for (const first of ['Courier', ''])
      it(`reads and clears a default checkbox choice (inherited=${inherited}, selected=${selected}, first=${JSON.stringify(first)})`, async () => {
        const { doc: source, field: original } = await checkboxOptionsPdf({
          inherited,
          indirect: true,
          selected,
          values: [first, 'Pickup'],
        });
        useCheckboxDefault(source, original);
        const doc = await PDFDocument.load(await source.save({ updateFieldAppearances: false }));
        const field = doc.getForm().getCheckBox(original.getName());
        const value = selected === 'A' ? first : 'Pickup';
        expect(listFields(doc)[0].value).toEqual([value]);
        expect(await fillFields(doc, { [field.getName()]: [value] })).toBe(false);
        expect(field.acroField.V()).toBeUndefined();
        expect(await fillFields(doc, { [field.getName()]: [] })).toBeUndefined();
        expect(field.acroField.V().decodeText()).toBe('Off');
        expect(
          doc.context
            .lookup(field.acroField.getInheritableAttribute(PDFName.of('DV')))
            .decodeText(),
        ).toBe(selected);
        const bytes = await doc.save();
        const saved = await PDFDocument.load(bytes);
        expect(listFields(saved)[0].value).toEqual([]);
        expect(await fillFields(saved, { [field.getName()]: [] })).toBe(false);
        const task = pdfjs.getDocument({ data: bytes.slice() });
        try {
          const widgets = await (await (await task.promise).getPage(1)).getAnnotations();
          expect(widgets.map((w) => w.fieldValue)).toEqual(['Off', 'Off']);
        } finally {
          await task.destroy();
        }
        await fillFields(saved, { [field.getName()]: [selected === 'A' ? 'Pickup' : first] });
        expect(saved.getForm().getCheckBox(field.getName()).acroField.getValue().decodeText()).toBe(
          selected === 'A' ? 'B' : 'A',
        );
      });

for (const inherited of [false, true])
  for (const selected of ['A', 'B', 'Off'])
    it(`prefers an explicit ${selected} value over a checkbox default (inherited=${inherited})`, async () => {
      const { doc, field } = await checkboxOptionsPdf({ inherited, selected: 'A' });
      useCheckboxDefault(doc, field);
      const owner = inherited
        ? field.acroField.dict.lookup(PDFName.of('Parent'))
        : field.acroField.dict;
      owner.set(PDFName.of('V'), doc.context.register(PDFName.of(selected)));
      const value = selected === 'Off' ? [] : [selected === 'A' ? 'Courier' : 'Pickup'];
      expect(listFields(doc)[0].value).toEqual(value);
      expect(await fillFields(doc, { [field.getName()]: value })).toBe(false);
    });

for (const inherited of [false, true])
  for (const selected of ['A', 'B'])
    for (const removed of [0, 1])
      it(`deletes the selected default only with its last widget (inherited=${inherited}, selected=${selected}, page=${removed})`, async () => {
        const { doc: source, field: original } = await checkboxDeletionPdf({ inherited, selected });
        useCheckboxDefault(source, original);
        const doc = await PDFDocument.load(await source.save({ updateFieldAppearances: false }));
        deletePage(doc, removed);
        const saved = await PDFDocument.load(await doc.save());
        const field = saved.getForm().getCheckBox(original.getName());
        const cleared = (selected === 'A') === (removed === 0);
        expect(field.acroField.V()?.decodeText()).toBe(cleared ? 'Off' : undefined);
        expect(listFields(saved)[0].value).toEqual(removed ? !cleared : cleared ? [] : ['Pickup']);
      });
