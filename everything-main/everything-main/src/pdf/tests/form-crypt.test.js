import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cryptAppearance } from './fixtures/crypt-appearance.js';
import { sharedAppearancePdf } from './fixtures/shared-appearance.js';
import { fillFields, PdfSession, preparePdfForEditing } from '../src/core/document.js';
import { updateFieldAppearance } from '../src/core/form-appearance.js';
import { formFields } from '../src/core/structure.js';
import { openedProtection, protectPdf, unlockPdf } from '../src/core/security.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

function normal(field) {
  return field.acroField.getWidgets()[0].dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
}
function selector(stream) {
  const filters = stream.dict.lookup(PDFName.of('Filter'));
  expect(filters instanceof PDFArray).toBe(true);
  expect(filters.lookup(0)).toBe(PDFName.of('Crypt'));
  return stream.dict.lookup(PDFName.of('DecodeParms')).lookup(0).lookup(PDFName.of('Name'));
}
async function painted(bytes, password) {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  });
  try {
    const page = await (await task.promise).getPage(1);
    const operators = await page.getOperatorList();
    return operators.fnArray
      .flatMap((fn, i) =>
        fn === pdfjs.OPS.showText
          ? operators.argsArray[i][0].map((glyph) => glyph.unicode || '')
          : [],
      )
      .join('');
  } finally {
    await task.destroy();
  }
}

for (const [label, options, action] of [
  ['named filter', {}, 'explicit'],
  ['Identity exemption', { identity: true }, 'fill'],
  ['AES-128', { legacy: true }, 'fill'],
  ['indirect custom selector', { custom: true, indirect: true }, 'fill'],
  ['shared appearance', { shared: true }, 'fill'],
  ['dropdown', { kind: 'dropdown' }, 'fill'],
  ['option list', { kind: 'list' }, 'fill'],
  ['implicit save', {}, 'implicit'],
  ['password masking', { kind: 'password' }, 'mask'],
])
  it(`preserves ${label} protection when regenerating form appearances`, async () => {
    const source = await cryptAppearance(options);
    const opened = await unlockPdf(source.bytes, source.password);
    let bytes;
    if (action === 'mask') bytes = await preparePdfForEditing(opened.bytes);
    else if (action === 'fill') {
      const session = new PdfSession(opened.bytes);
      await session.change((doc) => fillFields(doc, { private0: 'Changed secret' }), {
        streamProtection: opened.encryption,
      });
      bytes = session.bytes;
      expect(session.undo()).toBe(true);
      expect(session.bytes).toEqual(opened.bytes);
      expect(session.redo()).toBe(true);
    } else {
      const doc = await PDFDocument.load(opened.bytes, { updateMetadata: false });
      formFields(doc);
      const form = doc.getForm(),
        field = form.getTextField('private0');
      field.setText('Changed secret');
      if (action === 'explicit') updateFieldAppearance(field, form, form.getDefaultFont());
      bytes = await doc.save({ updateFieldAppearances: action === 'implicit' });
    }
    const working = await PDFDocument.load(bytes, { updateMetadata: false });
    const appearance = normal(working.getForm().getField('private0'));
    expect(selector(appearance)).toBe(PDFName.of(source.name));
    const encoded = appearance.getContents().slice();
    if (options.shared) {
      const original = await PDFDocument.load(opened.bytes, { updateMetadata: false });
      expect(normal(working.getForm().getField('private1')).getContents()).toEqual(
        normal(original.getForm().getField('private1')).getContents(),
      );
      expect(selector(normal(working.getForm().getField('private1')))).toBe(
        PDFName.of(source.name),
      );
    }
    const saved = await protectPdf(bytes, openedProtection(opened, source.password));
    const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
    const cipher = normal(raw.getForm().getFields()[0]);
    expect(selector(cipher)).toBe(PDFName.of(source.name));
    if (options.identity) expect(cipher.getContents()).toEqual(encoded);
    else expect(cipher.getContents()).not.toEqual(encoded);
    const text = await painted(saved, source.password);
    if (action === 'mask') {
      expect(text).toContain('*'.repeat('Private field'.length));
      expect(text).not.toContain('Private field');
    } else expect(text).toContain('Changed secret');
  });

function streams(widget) {
  const ap = widget.dict.lookup(PDFName.of('AP'));
  return ap.entries().flatMap(([key, ref]) => {
    const entry = ap.context.lookup(ref);
    if (entry instanceof PDFStream) return [[key.decodeText(), entry]];
    if (entry instanceof PDFDict)
      return entry
        .entries()
        .map(([state, ref]) => [
          key.decodeText() + ':' + state.decodeText(),
          ap.context.lookup(ref),
        ]);
    return [];
  });
}
for (const kind of ['text', 'dropdown', 'list', 'checkbox', 'radio', 'button'])
  it(`retains each ${kind} widget's state selectors without modifying shared appearances`, async () => {
    const { doc, first, second } = await sharedAppearancePdf({ kind });
    const original = streams(second.acroField.getWidgets()[0]);
    for (const [key, stream] of original) {
      if (stream.dict.has(PDFName.of('DecodeParms'))) continue;
      const identity = key.endsWith(':Off');
      stream.dict.set(PDFName.of('Filter'), doc.context.obj(['Crypt', 'FlateDecode']));
      stream.dict.set(
        PDFName.of('DecodeParms'),
        doc.context.obj([{ Name: identity ? 'Identity' : 'PrivateCF' }, null]),
      );
    }
    const dictionaries = original.map(([, stream]) => stream.dict.toString());
    if (kind === 'text') first.setText('New');
    else if (kind === 'dropdown' || kind === 'list') first.select('New');
    else if (kind === 'checkbox') first.check();
    else if (kind === 'radio') first.select('Yes');
    else
      first.acroField.getWidgets()[0].getAppearanceCharacteristics().setCaptions({ normal: 'New' });
    updateFieldAppearance(first, doc.getForm(), doc.getForm().getDefaultFont());
    for (const [key, stream] of streams(first.acroField.getWidgets()[0]))
      expect(selector(stream)).toBe(selector(original.find(([source]) => source === key)[1]));
    expect(original.map(([, stream]) => stream.dict.toString())).toEqual(dictionaries);
  });

it('keeps independent cipher choices for multiple widgets of one field', async () => {
  const { doc, first, second } = await sharedAppearancePdf();
  const firstWidget = first.acroField.getWidgets()[0];
  const secondWidget = second.acroField.getWidgets()[0];
  const original = normal(first);
  original.dict.set(PDFName.of('Filter'), doc.context.obj(['Crypt', 'FlateDecode']));
  original.dict.set(PDFName.of('DecodeParms'), doc.context.obj([{ Name: 'PrivateCF' }, null]));
  const publicDict = original.dict.clone();
  publicDict.set(PDFName.of('DecodeParms'), doc.context.obj([{ Name: 'Identity' }, null]));
  secondWidget.setAppearances(
    doc.context.obj({
      N: doc.context.register(PDFRawStream.of(publicDict, original.getContents())),
    }),
  );
  first.acroField.Kids().push(second.acroField.Kids().get(0));
  secondWidget.dict.set(PDFName.of('Parent'), first.ref);
  doc.getForm().acroForm.removeField(second.acroField);
  first.setText('New');
  updateFieldAppearance(first, doc.getForm(), doc.getForm().getDefaultFont());
  expect(selector(firstWidget.dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N')))).toBe(
    PDFName.of('PrivateCF'),
  );
  expect(selector(secondWidget.dict.lookup(PDFName.of('AP')).lookup(PDFName.of('N')))).toBe(
    PDFName.of('Identity'),
  );
});
