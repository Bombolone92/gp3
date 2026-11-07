import { expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { listFields } from '../src/core/document.js';
import { passwordFormPdf } from './fixtures/password-form.js';

for (const inherited of [false, true])
  for (const readOnly of [false, true])
    it(`reports password flags without changing values or the PDF (inherited=${inherited}, readOnly=${readOnly})`, async () => {
      const { doc: source } = await passwordFormPdf({ inherited, readOnly });
      const doc = await PDFDocument.load(await source.save());
      const snapshot = () =>
        doc.context.enumerateIndirectObjects().map(([ref, object]) => [ref, object.toString()]);
      const before = snapshot();
      expect(listFields(doc)).toMatchObject([
        { name: 'Account.Secret', password: true, readOnly, value: 'Example passphrase' },
        { name: 'Name', password: false, multiline: false, value: 'Original name' },
        { name: 'Notes', password: false, multiline: true, value: 'First line\nSecond line' },
      ]);
      expect(snapshot()).toEqual(before);
    });
