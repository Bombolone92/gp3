import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { deletePage, fillFields, listFields } from '../src/core/document.js';
import { incompleteRadioPdf } from './fixtures/radio-appearances.js';
import { radioPagesPdf } from './fixtures/radio-pages.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

for (const defaultOnly of [false, true])
  it(`preserves literal escape-like characters in radio state names (default=${defaultOnly})`, async () => {
    const { doc: source, field: original } = await radioPagesPdf({
      selected: 'Courier',
      defaultOnly,
    });
    const state = PDFName.of('On#2320literal');
    const widget = original.acroField.getWidgets()[0];
    const normal = widget.getAppearances().normal;
    normal.set(state, normal.get(PDFName.of('0')));
    normal.delete(PDFName.of('0'));
    widget.setAppearanceState(state);
    original.acroField.dict.set(PDFName.of(defaultOnly ? 'DV' : 'V'), state);
    const doc = await PDFDocument.load(await source.save({ updateFieldAppearances: false }));
    expect(listFields(doc)[0].value).toBe('Courier');
    expect(await fillFields(doc, { Delivery: ['Courier'] })).toBe(false);
    await fillFields(doc, { Delivery: ['Pickup'] });
    expect(listFields(doc)[0].value).toBe('Pickup');
  });

for (const inheritedOptions of [false, true])
  for (const defaultOnly of [false, true])
    for (const missing of [0, 1])
      for (const appearance of ['missing', 'off-only'])
        it(`keeps radio indices when widget ${missing} has ${appearance} appearances (inherited=${inheritedOptions}, default=${defaultOnly})`, async () => {
          const { doc: source, field: original } = await incompleteRadioPdf({
            missing,
            appearance,
            inheritedOptions,
            defaultOnly,
          });
          const doc = await PDFDocument.load(await source.save({ updateFieldAppearances: false }));
          const field = doc.getForm().getRadioGroup(original.getName());
          expect(listFields(doc)[0].value).toBe('Express');
          expect(await fillFields(doc, { [field.getName()]: ['Express'] })).toBe(false);
          const before = field.acroField.V();
          await expect(
            fillFields(doc, { [field.getName()]: [missing ? 'Pickup' : 'Courier'] }),
          ).rejects.toThrow('unavailable');
          expect(field.acroField.V()).toBe(before);
          const selected = missing ? 'Courier' : 'Pickup';
          await fillFields(doc, { [field.getName()]: [selected] });
          expect(field.acroField.getValue().decodeText()).toBe(missing ? '0' : '1');
          const saved = await PDFDocument.load(await doc.save());
          expect(listFields(saved)[0].value).toBe(selected);
          await fillFields(saved, { [field.getName()]: ['Express'] });
          expect(
            saved.getForm().getRadioGroup(field.getName()).acroField.getValue().decodeText(),
          ).toBe('2');
          await fillFields(saved, { [field.getName()]: [] });
          expect(listFields(saved)[0].value).toBeUndefined();
        });

for (const inheritedOptions of [false, true])
  for (const values of [
    [null, 'Pickup', 'Express'],
    ['Courier', null, 'Express'],
    ['Courier', 'Pickup'],
  ])
    it(`keeps malformed export positions during selection and deletion (inherited=${inheritedOptions}, values=${JSON.stringify(values)})`, async () => {
      const { doc, field } = await radioPagesPdf({
        selected: 'Express',
        defaultOnly: false,
        inheritedOptions,
      });
      const owner = inheritedOptions
        ? field.acroField.dict.lookup(PDFName.of('Parent'))
        : field.acroField.dict;
      owner.set(
        PDFName.of('Opt'),
        doc.context.obj(values.map((v) => (v === null ? null : PDFHexString.fromText(v)))),
      );
      const expected = values[2] ?? '2';
      expect(listFields(doc)[0].value).toBe(expected);
      await fillFields(doc, { [field.getName()]: [values[1] ?? '1'] });
      expect(field.acroField.getValue().decodeText()).toBe('1');
      await fillFields(doc, { [field.getName()]: [expected] });
      deletePage(doc, 0);
      expect(listFields(doc)[0]).toMatchObject({
        options: [values[1] ?? '1', expected],
        value: expected,
      });
      const task = pdfjs.getDocument({ data: await doc.save() });
      try {
        const widgets = await (await (await task.promise).getPage(1)).getAnnotations();
        expect(widgets.map((w) => w.buttonValue)).toEqual([values[1] ?? '1', expected]);
        expect(widgets.map((w) => w.fieldValue)).toEqual([expected, expected]);
      } finally {
        await task.destroy();
      }
    });

for (const missing of [0, 1])
  it(`selects an available duplicate export when widget ${missing} has no appearance`, async () => {
    const { doc, field } = await incompleteRadioPdf({ missing, defaultOnly: false });
    field.acroField.dict.set(
      PDFName.of('Opt'),
      doc.context.obj(['Shared', 'Shared', 'Express'].map(PDFHexString.fromText)),
    );
    await fillFields(doc, { [field.getName()]: ['Shared'] });
    expect(field.acroField.getValue().decodeText()).toBe(missing ? '0' : '1');
    expect(await fillFields(doc, { [field.getName()]: ['Shared'] })).toBe(false);
  });

for (const inheritedOptions of [false, true])
  for (const defaultOnly of [false, true])
    for (const missing of [0, 1])
      it(`preserves the selected radio when deleting around missing appearances (inherited=${inheritedOptions}, default=${defaultOnly}, missing=${missing})`, async () => {
        const { doc, field } = await incompleteRadioPdf({ missing, inheritedOptions, defaultOnly });
        deletePage(doc, 0);
        const saved = await PDFDocument.load(await doc.save());
        expect(listFields(saved)[0]).toMatchObject({
          options: ['Pickup', 'Express'],
          value: 'Express',
        });
        expect(saved.getForm().getRadioGroup(field.getName()).acroField.V()?.decodeText()).toBe(
          defaultOnly ? undefined : '2',
        );
      });
