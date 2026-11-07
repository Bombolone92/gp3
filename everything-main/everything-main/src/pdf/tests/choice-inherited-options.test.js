import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';
import { fillFields, listFields, PdfSession } from '../src/core/document.js';
import { inheritedChoicePdf, inheritedChoices } from './fixtures/inherited-choice.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

for (const list of [false, true])
  for (const indirect of [false, true])
    for (const defaultOnly of [false, true])
      it(`reads and edits inherited choice options (list=${list}, indirect=${indirect}, default=${defaultOnly})`, async () => {
        const { doc, field, parent } = await inheritedChoicePdf({ list, indirect, defaultOnly });
        const snapshot = () =>
          doc.context.enumerateIndirectObjects().map(([ref, obj]) => [ref, obj.toString()]);
        const before = snapshot();
        expect(listFields(doc)[0]).toMatchObject({ choices: inheritedChoices, value: ['CA'] });
        expect(await fillFields(doc, { 'Destination.Country': ['CA'] })).toBe(false);
        expect(snapshot()).toEqual(before);
        const originalOptions = parent.lookup(PDFName.of('Opt')).toString();
        const selected = list ? ['JP', 'FR'] : ['FR'];
        await fillFields(doc, { 'Destination.Country': selected });
        expect(parent.lookup(PDFName.of('Opt')).toString()).toBe(originalOptions);
        expect(field.acroField.dict.has(PDFName.of('Opt'))).toBe(false);
        const bytes = await doc.save();
        const reopened = await PDFDocument.load(bytes);
        expect(listFields(reopened)[0]).toMatchObject({
          choices: inheritedChoices,
          value: selected,
        });
        if (list)
          expect(
            field.acroField.dict
              .lookup(PDFName.of('I'))
              .asArray()
              .map((n) => n.asNumber()),
          ).toEqual([1, 2]);
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const task = pdfjs.getDocument({ data: bytes.slice() });
        try {
          const page = await (await task.promise).getPage(1);
          expect((await page.getAnnotations())[0].options).toEqual(
            inheritedChoices.map(({ value, label }) => ({
              exportValue: value,
              displayValue: label,
            })),
          );
          const ops = await page.getOperatorList();
          const shown = ops.fnArray
            .flatMap((op, i) =>
              op === pdfjs.OPS.showText
                ? ops.argsArray[i][0].filter((g) => typeof g !== 'number').map((g) => g.unicode)
                : [],
            )
            .join('');
          expect(shown).toContain('France');
          if (list) {
            expect(shown).toContain('Canada');
            expect(shown).toContain('Japan');
          }
        } finally {
          await task.destroy();
        }
        await fillFields(reopened, { 'Destination.Country': [] });
        expect(listFields(reopened)[0].value).toEqual([]);
      });

it('preserves choices and values through transaction undo and redo', async () => {
  const { doc } = await inheritedChoicePdf();
  const bytes = await doc.save();
  const session = new PdfSession(bytes);
  await session.change((doc) => fillFields(doc, { 'Destination.Country': ['FR'] }));
  expect(session.undo()).toBe(true);
  expect(session.bytes).toEqual(bytes);
  expect(session.redo()).toBe(true);
  expect(listFields(await PDFDocument.load(session.bytes))[0]).toMatchObject({
    choices: inheritedChoices,
    value: ['FR'],
  });
});
