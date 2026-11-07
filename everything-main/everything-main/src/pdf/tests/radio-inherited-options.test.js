import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFString, PDFHexString, PDFNumber } from 'pdf-lib';
import { deletePage, fillFields, listFields } from '../src/core/document.js';
import { radioPagesPdf } from './fixtures/radio-pages.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

for (const opt of [PDFName.of('Invalid'), PDFNumber.of(7)])
  for (const defaultOnly of [false, true])
    it(`retains appearance-name choices for malformed inherited options (${opt}, default=${defaultOnly})`, async () => {
      const { doc, field } = await radioPagesPdf({
        defaultOnly,
        inherited: true,
        inheritedOptions: true,
      });
      field.acroField.dict.lookup(PDFName.of('Parent')).set(PDFName.of('Opt'), opt);
      expect(listFields(doc)[0]).toMatchObject({ options: ['0', '1', '2'], value: '1' });
      await fillFields(doc, { [field.getName()]: ['2'] });
      expect(listFields(doc)[0].value).toBe('2');
      expect(field.acroField.dict.has(PDFName.of('Opt'))).toBe(false);
      deletePage(doc, 0);
      expect(listFields(doc)[0]).toMatchObject({ options: ['1', '2'], value: '2' });
    });

for (const StringType of [PDFString, PDFHexString])
  for (const value of ['Courier', ''])
    it(`supports a single inherited ${StringType.name} export ${JSON.stringify(value)}`, async () => {
      const { doc, field } = await radioPagesPdf({
        selected: 'Courier',
        inherited: true,
        inheritedOptions: true,
      });
      field.acroField.removeWidget(2);
      field.acroField.removeWidget(1);
      doc.getPage(1).node.delete(PDFName.of('Annots'));
      const parent = field.acroField.dict.lookup(PDFName.of('Parent'));
      parent.set(
        PDFName.of('Opt'),
        StringType === PDFString ? PDFString.of(value) : PDFHexString.fromText(value),
      );
      expect(listFields(doc)[0]).toMatchObject({ options: [value], value });
      await fillFields(doc, { [field.getName()]: [] });
      await fillFields(doc, { [field.getName()]: [value] });
      expect(field.acroField.getValue().decodeText()).toBe('0');
    });

for (const defaultOnly of [false, true])
  for (const exportNamed of [false, true])
    for (const indirect of [false, true])
      it(`reads and edits inherited radio exports (default=${defaultOnly}, names=${exportNamed}, indirect=${indirect})`, async () => {
        const { doc, field } = await radioPagesPdf({
          inherited: true,
          inheritedOptions: true,
          defaultOnly,
          exportNamed,
        });
        const parent = field.acroField.dict.lookup(PDFName.of('Parent'));
        if (indirect)
          parent.set(PDFName.of('Opt'), doc.context.register(parent.get(PDFName.of('Opt'))));
        const original = parent.lookup(PDFName.of('Opt')).toString();
        expect(listFields(doc)[0]).toMatchObject({
          options: ['Courier', 'Pickup', 'Express'],
          value: 'Pickup',
        });
        expect(await fillFields(doc, { [field.getName()]: ['Pickup'] })).toBe(false);
        expect(field.acroField.dict.has(PDFName.of('Opt'))).toBe(false);
        await fillFields(doc, { [field.getName()]: ['Express'] });
        expect(field.acroField.getValue().decodeText()).toBe('2');
        expect(parent.lookup(PDFName.of('Opt')).toString()).toBe(original);
        const saved = await PDFDocument.load(await doc.save());
        expect(listFields(saved)[0]).toMatchObject({
          options: ['Courier', 'Pickup', 'Express'],
          value: 'Express',
        });
        await fillFields(saved, { [field.getName()]: ['Courier'] });
        expect(listFields(saved)[0].value).toBe('Courier');
        await fillFields(saved, { [field.getName()]: [] });
        expect(
          saved.getForm().getRadioGroup(field.getName()).acroField.getValue().decodeText(),
        ).toBe('Off');
      });

for (const defaultOnly of [false, true])
  for (const exportNamed of [false, true])
    for (const selected of ['Courier', 'Pickup'])
      for (const removed of [0, 1])
        it(`deletes inherited radio options without changing other choices (default=${defaultOnly}, names=${exportNamed}, selected=${selected}, page=${removed})`, async () => {
          const { doc, field } = await radioPagesPdf({
            inherited: true,
            inheritedOptions: true,
            defaultOnly,
            exportNamed,
            selected,
          });
          const parent = field.acroField.dict.lookup(PDFName.of('Parent'));
          const original = parent.lookup(PDFName.of('Opt')).toString();
          deletePage(doc, removed);
          const options = removed ? ['Courier'] : ['Pickup', 'Express'];
          const expected = options.includes(selected) ? selected : undefined;
          const saved = await PDFDocument.load(await doc.save());
          expect(listFields(saved)[0]).toMatchObject({ options, value: expected });
          expect(parent.lookup(PDFName.of('Opt')).toString()).toBe(original);
          await fillFields(saved, { [field.getName()]: [options.at(-1)] });
          expect(listFields(saved)[0].value).toBe(options.at(-1));
        });
