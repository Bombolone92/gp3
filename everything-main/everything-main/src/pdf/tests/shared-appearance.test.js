import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFBool } from 'pdf-lib';
import { fillFields, preparePdfForEditing, PdfSession } from '../src/core/document.js';
import { updateFieldAppearance } from '../src/core/form-appearance.js';
import { flattenDocument } from '../src/core/flatten.js';
import { sharedAppearancePdf } from './fixtures/shared-appearance.js';
import { rendered } from './helpers/list-render.js';
import { paintedText } from './helpers/painted-text.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());
const lowerHalf = (pixels) => pixels.subarray(pixels.length / 2);

for (const kind of ['text', 'dropdown', 'list', 'checkbox', 'radio', 'button'])
  for (const indirect of [false, true])
    it(`regenerates one ${kind} without changing the shared neighbor (indirect=${indirect})`, async () => {
      const { doc, first, second } = await sharedAppearancePdf({ kind, indirect });
      const original = await rendered(await doc.save());
      const shared = second.acroField.getWidgets()[0].dict.lookup(PDFName.of('AP'));
      const appearance = shared.toString();
      const widget = first.acroField.getWidgets()[0];
      widget.getAppearanceCharacteristics().setBackgroundColor([1, 0.8, 0.2]);
      if (kind === 'text') first.setText('New');
      else if (kind === 'dropdown' || kind === 'list') first.select('New');
      else if (kind === 'checkbox') first.check();
      else if (kind === 'radio') first.select('Yes');
      else widget.getAppearanceCharacteristics().setCaptions({ normal: 'New' });
      updateFieldAppearance(first, doc.getForm(), doc.getForm().getDefaultFont());
      expect(shared.toString()).toBe(appearance);
      const saved = await rendered(await doc.save());
      expect(saved.pixels.equals(original.pixels)).toBe(false);
      expect(lowerHalf(saved.pixels).equals(lowerHalf(original.pixels))).toBe(true);
    });

for (const kind of ['text', 'dropdown', 'list'])
  it(`preserves untouched ${kind} pixels through editing, save, undo, and redo`, async () => {
    const { doc } = await sharedAppearancePdf({ kind });
    const bytes = await doc.save();
    const original = await rendered(bytes);
    const session = new PdfSession(bytes);
    await session.change((doc) => fillFields(doc, { First: kind === 'text' ? 'New' : ['New'] }));
    const saved = await rendered(session.bytes);
    expect(lowerHalf(saved.pixels).equals(lowerHalf(original.pixels))).toBe(true);
    const field = (await PDFDocument.load(session.bytes)).getForm().getField('Second');
    expect(kind === 'text' ? field.getText() : field.getSelected()).toEqual(
      kind === 'text' ? 'Old' : ['Old'],
    );
    expect(session.undo()).toBe(true);
    expect(session.bytes).toEqual(bytes);
    expect(session.redo()).toBe(true);
    expect((await rendered(session.bytes)).pixels.equals(saved.pixels)).toBe(true);
  });

it('masks an imported password without masking another field that shares its appearance', async () => {
  const { doc, first } = await sharedAppearancePdf();
  first.enablePassword();
  const bytes = await preparePdfForEditing(await doc.save());
  expect(await paintedText(bytes)).toBe('***Old');
  const form = (await PDFDocument.load(bytes)).getForm();
  expect(form.getTextField('First').getText()).toBe('Old');
  expect(form.getTextField('Second').getText()).toBe('Old');
});

it('keeps a retained field’s shared drawing intact when another field is flattened', async () => {
  const { doc, first, second } = await sharedAppearancePdf();
  const before = second.acroField.getWidgets()[0].dict.lookup(PDFName.of('AP')).toString();
  first.setText('New');
  second.setText('漢字');
  doc.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  expect(flattenDocument(doc)).toEqual({
    fields: 1,
    annotations: 0,
    unflattened: { fields: 1, annotations: 0 },
  });
  const saved = await PDFDocument.load(await doc.save());
  expect(
    saved
      .getForm()
      .getTextField('Second')
      .acroField.getWidgets()[0]
      .dict.lookup(PDFName.of('AP'))
      .toString(),
  ).toBe(before);
});

it('gives widgets of one field independent drawings when they share an appearance dictionary', async () => {
  const results = [];
  for (const shared of [false, true]) {
    const { doc, first, second } = await sharedAppearancePdf();
    const firstWidget = first.acroField.getWidgets()[0];
    const secondWidget = second.acroField.getWidgets()[0];
    if (!shared) secondWidget.setAppearances(secondWidget.dict.lookup(PDFName.of('AP')).clone());
    first.acroField.Kids().push(second.acroField.Kids().get(0));
    secondWidget.dict.set(PDFName.of('Parent'), first.ref);
    doc.getForm().acroForm.removeField(second.acroField);
    firstWidget.getAppearanceCharacteristics().setBackgroundColor([1, 0.8, 0.2]);
    secondWidget.getAppearanceCharacteristics().setBackgroundColor([0.2, 0.8, 1]);
    first.setText('New');
    updateFieldAppearance(first, doc.getForm(), doc.getForm().getDefaultFont());
    results.push((await rendered(await doc.save())).pixels);
  }
  expect(results[1].equals(results[0])).toBe(true);
});
