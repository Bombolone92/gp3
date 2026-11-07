import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { deletePage, fillFields, listFields } from '../src/core/document.js';
import { checkboxDeletionPdf } from './fixtures/checkbox-options.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

for (const inherited of [false, true])
  for (const removed of [0, 1])
    it(`clears the deleted checkbox choice (inherited=${inherited}, page=${removed})`, async () => {
      const { doc: source, field: original } = await checkboxDeletionPdf({
        inherited,
        selected: removed ? 'B' : 'A',
      });
      const doc = await PDFDocument.load(await source.save());
      const appearances = doc
        .getForm()
        .getCheckBox(original.getName())
        .acroField.getWidgets()
        .filter((widget) => widget.P() !== doc.getPage(removed).ref)
        .map((widget) => widget.dict.get(PDFName.of('AP')).toString());
      deletePage(doc, removed);
      const saved = await PDFDocument.load(await doc.save());
      const field = saved.getForm().getCheckBox(original.getName());
      expect(field.acroField.getValue().decodeText()).toBe('Off');
      expect(
        field.acroField.getWidgets().map((widget) => widget.dict.get(PDFName.of('AP')).toString()),
      ).toEqual(appearances);
      expect(
        field.acroField.getWidgets().every((w) => w.getAppearanceState() === PDFName.of('Off')),
      ).toBe(true);
      expect(listFields(saved)[0].value).toEqual(removed ? false : []);
      expect((await annotations(saved)).every((w) => w.fieldValue === 'Off')).toBe(true);
      await fillFields(saved, { [field.getName()]: removed ? true : ['Express'] });
      expect(field.acroField.getValue().decodeText()).toBe(removed ? 'A' : 'C');
    });

it('keeps a selected checkbox state that still appears on another page', async () => {
  const { doc: source, field: original } = await checkboxDeletionPdf({ selected: 'A' });
  const repeated = original.acroField.getWidgets()[2];
  const normal = repeated.getAppearances().normal;
  normal.set(PDFName.of('A'), normal.get(PDFName.of('C')));
  normal.delete(PDFName.of('C'));
  repeated.setAppearanceState(PDFName.of('A'));
  const doc = await PDFDocument.load(await source.save());
  deletePage(doc, 0);
  const saved = await PDFDocument.load(await doc.save());
  const field = saved.getForm().getCheckBox('Delivery');
  expect(field.acroField.getValue().decodeText()).toBe('A');
  expect(listFields(saved)[0].value).toEqual(['Express']);
  expect((await annotations(saved)).map((w) => w.fieldValue)).toEqual(['Off', 'Express']);
});

for (const selected of ['Off', 'Unknown'])
  it(`leaves an existing ${selected} value alone when removing unrelated widgets`, async () => {
    const { doc, field } = await checkboxDeletionPdf({ selected });
    deletePage(doc, 0);
    expect(field.acroField.getValue().decodeText()).toBe(selected);
  });

async function annotations(doc) {
  const task = pdfjs.getDocument({ data: await doc.save() });
  try {
    return await (await (await task.promise).getPage(1)).getAnnotations();
  } finally {
    await task.destroy();
  }
}

for (const inherited of [false, true])
  for (const indirect of [false, true])
    for (const removed of [0, 1])
      it(`keeps checkbox exports aligned after deleting page ${removed} (inherited=${inherited}, indirect=${indirect})`, async () => {
        const { doc, field } = await checkboxDeletionPdf({
          inherited,
          indirect,
          selected: removed ? 'A' : 'B',
        });
        deletePage(doc, removed);
        const expected = removed ? ['Courier'] : ['Pickup', 'Express'];
        expect((await annotations(doc)).map((widget) => widget.exportValue)).toEqual(expected);
        const saved = await PDFDocument.load(await doc.save());
        if (!removed) {
          expect(listFields(saved)[0]).toMatchObject({ options: expected, value: ['Pickup'] });
          await fillFields(saved, { [field.getName()]: ['Express'] });
          expect(
            saved.getForm().getCheckBox(field.getName()).acroField.getValue().decodeText(),
          ).toBe('C');
          expect((await annotations(saved)).map((widget) => widget.fieldValue)).toEqual([
            'Off',
            'Express',
          ]);
        } else expect(listFields(saved)[0].value).toBe(true);
      });

for (const values of [
  ['Courier', '', 'Express'],
  ['Courier', null, 'Express'],
  ['Courier', 'Pickup'],
  ['Courier'],
])
  it(`retains empty, missing and malformed export positions: ${JSON.stringify(values)}`, async () => {
    const { doc } = await checkboxDeletionPdf({ values, inherited: true, indirect: true });
    deletePage(doc, 0);
    expect(listFields(doc)[0]).toMatchObject({
      options: [values[1] ?? 'B', values[2] ?? 'C'],
      value: [values[1] ?? 'B'],
    });
    const saved = await PDFDocument.load(await doc.save());
    expect(listFields(saved)[0]).toEqual(listFields(doc)[0]);
  });

it('does not change another checkbox field sharing its export array', async () => {
  const { doc, field } = await checkboxDeletionPdf({ indirect: true });
  const sibling = doc.getForm().createCheckBox('Other delivery');
  for (let i = 0; i < 2; i++) {
    sibling.addToPage(doc.getPage(1), { x: 40 + i * 80, y: 100, width: 20, height: 20 });
    const normal = sibling.acroField.getWidgets()[i].getAppearances().normal;
    normal.set(PDFName.of(i ? 'B' : 'A'), normal.get(PDFName.of('Yes')));
    normal.delete(PDFName.of('Yes'));
  }
  sibling.acroField.dict.set(PDFName.of('Opt'), field.acroField.dict.get(PDFName.of('Opt')));
  deletePage(doc, 0);
  expect(listFields(doc).map(({ options }) => options)).toEqual([
    ['Pickup', 'Express'],
    ['Courier', 'Pickup'],
  ]);
});

for (const opt of [undefined, PDFHexString.fromText('Invalid scalar'), PDFName.of('Invalid')])
  it(`preserves appearance-name choices without an export array (${opt})`, async () => {
    const { doc, field } = await checkboxDeletionPdf();
    if (opt) field.acroField.dict.set(PDFName.of('Opt'), opt);
    else field.acroField.dict.delete(PDFName.of('Opt'));
    deletePage(doc, 0);
    expect(listFields(doc)[0]).toMatchObject({ options: ['B', 'C'], value: ['B'] });
    await fillFields(doc, { Delivery: ['C'] });
    expect(field.acroField.getValue().decodeText()).toBe('C');
  });
