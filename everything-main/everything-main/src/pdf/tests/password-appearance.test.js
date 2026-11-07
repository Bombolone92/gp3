import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFBool, defaultTextFieldAppearanceProvider } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fillFields, PdfSession } from '../src/core/document.js';
import { flattenDocument } from '../src/core/flatten.js';
import { passwordFormPdf } from './fixtures/password-form.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

async function paintedText(bytes) {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
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

async function maskedSource(inherited) {
  const { doc, secret } = await passwordFormPdf({ inherited });
  secret.updateAppearances(doc.getForm().getDefaultFont(), (source, widget, font) => {
    const display = Object.create(source);
    display.getText = () => '*'.repeat(source.getText().length);
    return defaultTextFieldAppearanceProvider(display, widget, font);
  });
  return doc;
}

for (const inherited of [false, true]) {
  it(`keeps edited password values out of painted appearances (inherited=${inherited})`, async () => {
    const doc = await maskedSource(inherited);
    const bytes = await doc.save();
    expect(await paintedText(bytes)).not.toContain('Example passphrase');
    const session = new PdfSession(bytes);
    await session.change((doc) => fillFields(doc, { 'Account.Secret': 'Changed secret' }));
    const saved = await PDFDocument.load(session.bytes);
    expect(saved.getForm().getTextField('Account.Secret').getText()).toBe('Changed secret');
    const painted = await paintedText(session.bytes);
    expect(painted).not.toContain('Changed secret');
    expect(painted).toContain('*'.repeat('Changed secret'.length));
    expect(painted).toContain('Original name');
    expect(session.undo()).toBe(true);
    expect(session.bytes).toEqual(bytes);
    expect(session.redo()).toBe(true);
    expect(await paintedText(session.bytes)).toBe(painted);
  });

  for (const stale of [false, true])
    it(`masks regenerated password appearances when flattening (inherited=${inherited}, stale=${stale})`, async () => {
      const doc = await maskedSource(inherited);
      if (stale) doc.getForm().acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
      else
        doc
          .getForm()
          .getTextField('Account.Secret')
          .acroField.getWidgets()[0]
          .dict.delete(PDFName.of('AP'));
      expect(flattenDocument(doc)).toEqual({ fields: 3, annotations: 0 });
      const bytes = await doc.save();
      const painted = await paintedText(bytes);
      expect(painted).not.toContain('Example passphrase');
      expect(painted).toContain('*'.repeat('Example passphrase'.length));
      expect(painted).toContain('Original name');
    });
}
