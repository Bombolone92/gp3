import { expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { formButtonSelections, listFields } from '../src/core/document.js';
import { formWidgets } from '../src/core/form-draft.js';
import { offExportPdf } from './fixtures/off-export.js';

for (const kind of ['radio', 'checkbox'])
  for (const inherited of [false, true])
    for (const defaultOnly of [false, true])
      for (const selected of [false, true])
        it(`distinguishes an Off export from no selection (${kind}, inherited=${inherited}, default=${defaultOnly}, selected=${selected})`, async () => {
          const { doc: source } = await offExportPdf({ kind, inherited, defaultOnly, selected });
          const bytes = await source.save({ updateFieldAppearances: false });
          const doc = await PDFDocument.load(bytes);
          const snapshot = () =>
            doc.context.enumerateIndirectObjects().map(([ref, object]) => [ref, object.toString()]);
          const before = snapshot();
          const selections = formButtonSelections(doc, new Set(['Settings.Mode']));
          expect(selections.get('Settings.Mode')).toEqual(selected ? ['Off'] : []);
          expect(listFields(doc)[0].value).toEqual(
            kind === 'radio' ? (selected ? 'Off' : undefined) : selected ? ['Off'] : [],
          );
          expect(snapshot()).toEqual(before);
          const task = pdfjs.getDocument({ data: bytes.slice() });
          try {
            for (const page of [1, 2]) {
              const annotations = await (await (await task.promise).getPage(page)).getAnnotations();
              const original = structuredClone(annotations);
              const [widget] = formWidgets(annotations, undefined, selections);
              expect(widget.value).toEqual(selected ? ['Off'] : []);
              expect(widget.type).toBe(kind);
              expect(annotations).toEqual(original);
            }
          } finally {
            await task.destroy();
          }
        });
