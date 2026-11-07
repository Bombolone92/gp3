import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFString, decodePDFRawStream } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fillFields, PdfSession } from '../src/core/document.js';
import { inheritedAppearancePdf } from './fixtures/inherited-appearance.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

const appearance = (doc) => {
  const field = doc.getForm().getField('Group.Value');
  const stream = doc.context.lookup(field.acroField.getWidgets()[0].getNormalAppearance());
  return new TextDecoder()
    .decode(decodePDFRawStream(stream).decode())
    .replace(/\/[^\s]+ ([\d.]+) Tf/g, '/Font $1 Tf');
};

for (const kind of ['text', 'multiline', 'dropdown', 'list'])
  for (const level of ['parent', 'form'])
    for (const indirect of [false, true])
      it(`preserves inherited appearance on edit (${kind}, ${level}, indirect=${indirect})`, async () => {
        const { doc, owner } = await inheritedAppearancePdf({ kind, level, indirect });
        const originalOwner = owner.toString();
        const inherited = owner.lookup(PDFName.of('DA'));
        const reference = await PDFDocument.load(await doc.save());
        reference.getForm().getField('Group.Value').acroField.dict.set(PDFName.of('DA'), inherited);
        const value = kind === 'dropdown' || kind === 'list' ? ['Changed'] : 'Changed';
        await fillFields(doc, { 'Group.Value': value });
        await fillFields(reference, { 'Group.Value': value });
        expect(owner.toString()).toBe(originalOwner);
        const bytes = await doc.save();
        const saved = await PDFDocument.load(bytes);
        expect(appearance(saved)).toBe(appearance(await PDFDocument.load(await reference.save())));
        const task = pdfjs.getDocument({ data: bytes.slice() });
        try {
          const page = await (await task.promise).getPage(1);
          const [annotation] = await page.getAnnotations();
          expect(annotation.defaultAppearanceData.fontSize).toBe(12);
          expect([...annotation.defaultAppearanceData.fontColor]).toEqual([178, 26, 51]);
        } finally {
          await task.destroy();
        }
      });

it.each(['field', 'widget'])(
  'leaves unchanged fields alone and respects nearer %s defaults',
  async (location) => {
    const { doc, field, owner } = await inheritedAppearancePdf();
    const snapshot = () =>
      doc.context.enumerateIndirectObjects().map(([ref, obj]) => [ref, obj.toString()]);
    const before = snapshot();
    expect(await fillFields(doc, { 'Group.Value': 'Original' })).toBe(false);
    expect(snapshot()).toEqual(before);
    field.enableReadOnly();
    const locked = snapshot();
    expect(await fillFields(doc, { 'Group.Value': 'Changed' })).toBe(false);
    expect(snapshot()).toEqual(locked);
    field.disableReadOnly();
    const target =
      location === 'field' ? field.acroField.dict : field.acroField.getWidgets()[0].dict;
    target.set(PDFName.of('DA'), PDFString.of('0 0 1 rg /Helvetica 10 Tf'));
    const originalOwner = owner.toString();
    const bytes = await doc.save();
    const session = new PdfSession(bytes);
    await session.change((doc) => fillFields(doc, { 'Group.Value': 'Changed' }));
    const shown = appearance(await PDFDocument.load(session.bytes));
    expect(shown).toContain('0 0 1 rg');
    expect(shown).toContain('/Font 10 Tf');
    expect(owner.toString()).toBe(originalOwner);
    expect(session.undo()).toBe(true);
    expect(session.bytes).toEqual(bytes);
    expect(session.redo()).toBe(true);
  },
);

it.each(['field', 'parent'])(
  'uses form defaults when the %s appearance is empty',
  async (location) => {
    const { doc, field } = await inheritedAppearancePdf({ level: 'form' });
    const target = location === 'field' ? field.acroField.dict : field.acroField.getParent().dict;
    target.set(PDFName.of('DA'), PDFString.of(''));
    await fillFields(doc, { 'Group.Value': 'Changed' });
    const shown = appearance(await PDFDocument.load(await doc.save()));
    expect(shown).toContain('0.7 0.1 0.2 rg');
    expect(shown).toContain('/Font 12 Tf');
  },
);

it('prefers parent defaults to form-wide defaults', async () => {
  const { doc } = await inheritedAppearancePdf();
  doc.getForm().acroForm.dict.set(PDFName.of('DA'), PDFString.of('0 1 0 rg /Helvetica 8 Tf'));
  await fillFields(doc, { 'Group.Value': 'Changed' });
  const shown = appearance(await PDFDocument.load(await doc.save()));
  expect(shown).toContain('0.7 0.1 0.2 rg');
  expect(shown).toContain('/Font 12 Tf');
});
