import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { deletePage, fillFields, listFields } from '../src/core/document.js';
import { radioPagesPdf } from './fixtures/radio-pages.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

for (const defaultOnly of [false, true]) {
  it(`does not confuse a deleted appearance name with a surviving export (default=${defaultOnly})`, async () => {
    const { doc, field } = await radioPagesPdf({ defaultOnly, selected: 'Courier' });
    field.acroField.dict.lookup(PDFName.of('Opt')).set(1, PDFHexString.fromText('0'));
    deletePage(doc, 0);
    expect(listFields(doc)[0]).toMatchObject({ options: ['0', 'Express'], value: undefined });
    expect(field.acroField.V().decodeText()).toBe('Off');
  });

  it(`retains a repeated radio choice when one copy is deleted (default=${defaultOnly})`, async () => {
    const { doc, field } = await radioPagesPdf({ defaultOnly: false });
    field.disableMutualExclusion();
    field.addOptionToPage('Pickup', doc.getPage(0), { x: 40, y: 100, width: 20, height: 20 });
    field.select('Pickup');
    expect(
      field.acroField.getWidgets().filter((w) => w.getOnValue() === PDFName.of('1')),
    ).toHaveLength(2);
    if (defaultOnly) field.acroField.dict.delete(PDFName.of('V'));
    deletePage(doc, 0);
    const saved = await PDFDocument.load(await doc.save());
    expect(listFields(saved)[0].value).toBe('Pickup');
    expect(saved.getForm().getRadioGroup('Delivery').acroField.V()?.decodeText()).toBe(
      defaultOnly ? undefined : '1',
    );
  });
}

for (const stored of ['Pickup', 'Unrecognized'])
  it(`preserves an imported radio value that is not an appearance name: ${stored}`, async () => {
    const { doc, field } = await radioPagesPdf({ defaultOnly: false });
    field.acroField.dict.set(PDFName.of('V'), PDFName.of(stored));
    deletePage(doc, 0);
    const saved = await PDFDocument.load(await doc.save());
    expect(saved.getForm().getRadioGroup(field.getName()).acroField.getValue().decodeText()).toBe(
      stored,
    );
    expect(listFields(saved)[0].value).toBe(stored);
  });

for (const inherited of [false, true])
  for (const exportNamed of [false, true])
    for (const defaultOnly of [false, true])
      for (const selected of ['Courier', 'Pickup', 'Express', 'Off'])
        for (const removed of [0, 1])
          it(`retains only surviving radio selections (inherited=${inherited}, exports=${exportNamed}, default=${defaultOnly}, selected=${selected}, page=${removed})`, async () => {
            const { doc: source, field: original } = await radioPagesPdf({
              inherited,
              defaultOnly,
              selected,
              exportNamed,
            });
            const doc = await PDFDocument.load(
              await source.save({ updateFieldAppearances: false }),
            );
            const field = doc.getForm().getRadioGroup(original.getName());
            expect(listFields(doc)[0].value).toBe(selected === 'Off' ? undefined : selected);
            const remaining = field.acroField
              .getWidgets()
              .filter((w) => w.P() !== doc.getPage(removed).ref);
            const appearances = remaining.map((w) => w.dict.get(PDFName.of('AP')).toString());
            const options = removed ? ['Courier'] : ['Pickup', 'Express'];
            const survives = options.includes(selected);
            deletePage(doc, removed);
            expect(listFields(doc)[0]).toMatchObject({
              options,
              value: survives ? selected : undefined,
            });
            if (defaultOnly && survives) expect(field.acroField.V()).toBeUndefined();
            else
              expect(field.acroField.V().decodeText()).toBe(
                survives
                  ? exportNamed
                    ? selected
                    : String(['Courier', 'Pickup', 'Express'].indexOf(selected))
                  : 'Off',
              );
            const bytes = await doc.save();
            const saved = await PDFDocument.load(bytes);
            expect(listFields(saved)).toEqual(listFields(doc));
            expect(
              saved
                .getForm()
                .getRadioGroup(field.getName())
                .acroField.getWidgets()
                .map((w) => w.dict.get(PDFName.of('AP')).toString()),
            ).toEqual(appearances);
            const task = pdfjs.getDocument({ data: bytes.slice() });
            try {
              const widgets = await (await (await task.promise).getPage(1)).getAnnotations();
              expect(widgets.map((w) => w.fieldValue)).toEqual(
                options.map(() => (survives ? selected : 'Off')),
              );
            } finally {
              await task.destroy();
            }
            await fillFields(saved, { [field.getName()]: [options.at(-1)] });
            expect(listFields(saved)[0].value).toBe(options.at(-1));
          });
