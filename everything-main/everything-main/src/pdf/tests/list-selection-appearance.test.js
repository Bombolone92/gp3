import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  PDFDocument,
  PDFName,
  PDFBool,
  PDFHexString,
  PDFString,
  defaultOptionListAppearanceProvider,
} from 'pdf-lib';
import { rendered } from './helpers/list-render.js';
import { fillFields, PdfSession, embedFont } from '../src/core/document.js';
import { flattenDocument } from '../src/core/flatten.js';
import { duplicateListPdf } from './fixtures/duplicate-list.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

for (const action of ['edit', 'flatten'])
  for (const sorted of [false, true])
    for (const rotation of [0, 90])
      for (const selected of [['north'], ['south'], ['north', 'south'], []])
        it(`paints only the selected duplicate-label rows (${action}, sorted=${sorted}, rotation=${rotation}, selected=${selected})`, async () => {
          const outputs = [];
          for (const unique of [false, true]) {
            const { doc } = await duplicateListPdf({
              unique,
              sorted,
              rotation,
              inherited: true,
              selected: action === 'flatten' ? selected : [],
            });
            if (action === 'edit') await fillFields(doc, { 'Group.Office': selected });
            else {
              doc.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
              expect(flattenDocument(doc)).toEqual({ fields: 1, annotations: 0 });
            }
            const bytes = await doc.save();
            outputs.push(await rendered(bytes, rotation));
            if (action === 'edit')
              expect(
                (await PDFDocument.load(bytes))
                  .getForm()
                  .getOptionList('Group.Office')
                  .getSelected(),
              ).toEqual(selected);
          }
          expect(outputs[0].bands).toEqual(outputs[1].bands);
          expect(outputs[0].bands).toHaveLength(selected.length);
          expect(outputs[0].lines.filter((line) => line === 'Office')).toHaveLength(2);
        });

it('highlights every rendered line belonging to a selected wrapped option', async () => {
  const { doc, field } = await duplicateListPdf();
  field.acroField.setOptions([
    {
      value: PDFHexString.fromText('long'),
      display: PDFHexString.fromText(
        'A long office description that wraps onto several lines in the list',
      ),
    },
  ]);
  for (const widget of field.acroField.getWidgets())
    widget.setRectangle({ ...widget.getRectangle(), width: 130 });
  await fillFields(doc, { 'Group.Office': ['long'] });
  const output = await rendered(await doc.save());
  expect(output.lines.length).toBeGreaterThan(1);
  expect(output.bands).toHaveLength(output.lines.length);
});

it('keeps a duplicate-label selection correct through undo and redo', async () => {
  const { doc } = await duplicateListPdf();
  const bytes = await doc.save(),
    session = new PdfSession(bytes);
  await session.change((doc) => fillFields(doc, { 'Group.Office': ['south'] }));
  expect((await rendered(session.bytes)).bands).toHaveLength(1);
  const changed = session.bytes.slice();
  expect(session.undo()).toBe(true);
  expect(session.bytes).toEqual(bytes);
  expect(session.redo()).toBe(true);
  expect(session.bytes).toEqual(changed);
});

for (const rotation of [0, 90, 180, 270])
  for (const fontSize of [0, 12])
    for (const widgetStyle of [false, true])
      it(`keeps ordinary list rendering unchanged (rotation=${rotation}, size=${fontSize}, widget=${widgetStyle})`, async () => {
        const { doc, field } = await duplicateListPdf({
          unique: true,
          sorted: true,
          rotation,
          inherited: true,
        });
        field.acroField.dict.set(PDFName.of('DA'), PDFString.of(`0.2 g /Helvetica ${fontSize} Tf`));
        if (widgetStyle)
          field.acroField
            .getWidgets()[0]
            .dict.set(
              PDFName.of('DA'),
              PDFString.of(`0.1 0.4 0.2 0.1 k /Helvetica ${fontSize} Tf`),
            );
        await fillFields(doc, { 'Group.Office': ['south'] });
        const bytes = await doc.save();
        const reference = await PDFDocument.load(bytes),
          other = reference.getForm().getOptionList('Group.Office');
        other.acroField.dict.set(PDFName.of('DA'), PDFString.of(`0.2 g /Helvetica ${fontSize} Tf`));
        if (widgetStyle)
          other.acroField
            .getWidgets()[0]
            .dict.set(
              PDFName.of('DA'),
              PDFString.of(`0.1 0.4 0.2 0.1 k /Helvetica ${fontSize} Tf`),
            );
        other.updateAppearances(await embedFont(reference), (source, widget, font) => {
          const display = Object.create(source);
          display.getSelected = () => ['Office 2'];
          display.getOptions = () => ['Office 1', 'Office 2', 'Alpha'];
          return defaultOptionListAppearanceProvider(display, widget, font);
        });
        expect(
          (await rendered(bytes)).pixels.equals((await rendered(await reference.save())).pixels),
        ).toBe(true);
      });

it('keeps blank hard lines within a selected option highlighted', async () => {
  const { doc, field } = await duplicateListPdf();
  field.acroField.setOptions([
    { value: PDFHexString.fromText('lines'), display: PDFHexString.fromText('First\n\nThird') },
  ]);
  await fillFields(doc, { 'Group.Office': ['lines'] });
  expect((await rendered(await doc.save())).bands).toHaveLength(3);
});

for (const location of ['field', 'widget'])
  it(`does not write infinite font sizes from an overflowing ${location} default`, async () => {
    const { doc, field } = await duplicateListPdf();
    const owner = location === 'field' ? field.acroField : field.acroField.getWidgets()[0];
    owner.setDefaultAppearance(`/Helvetica ${'9'.repeat(400)} Tf`);
    await fillFields(doc, { 'Group.Office': ['south'] });
    const output = await rendered(await doc.save());
    expect(output.bands).toHaveLength(1);
    expect(output.lines.filter((line) => line === 'Office')).toHaveLength(2);
  });
