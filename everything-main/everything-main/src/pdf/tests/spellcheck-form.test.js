import { expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { listFields } from '../src/core/document.js';
import { formWidgets } from '../src/core/form-draft.js';
import { spellcheckFormPdf } from './fixtures/spellcheck-form.js';

for (const inherited of [false, true])
  for (const readOnly of [false, true])
    it(`reads spellchecking flags consistently without modifying the document (inherited=${inherited}, readOnly=${readOnly})`, async () => {
      const { doc: source, fields } = await spellcheckFormPdf({ inherited, readOnly });
      const bytes = await source.save();
      const doc = await PDFDocument.load(bytes);
      const snapshot = () =>
        doc.context.enumerateIndirectObjects().map(([ref, object]) => [ref, object.toString()]);
      const before = snapshot();
      const expected = fields.map(({ name, kind, enabled }) => ({
        name,
        readOnly,
        spellcheck: enabled && kind !== 'Password',
      }));
      expect(listFields(doc)).toMatchObject(expected);
      expect(snapshot()).toEqual(before);
      const task = pdfjs.getDocument({ data: bytes.slice() });
      try {
        const annotations = await (await (await task.promise).getPage(1)).getAnnotations();
        const original = structuredClone(annotations);
        expect(formWidgets(annotations)).toMatchObject(expected);
        expect(annotations).toEqual(original);
      } finally {
        await task.destroy();
      }
    });
