import { PDFDocument, PDFName } from 'pdf-lib';
import { addNote } from '../../src/core/notes.js';
import { addHighlight, rectQuad } from '../../src/core/highlight.js';

export async function commentPdf(kind, indirect = true) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  if (kind === 'note') addNote(doc, 0, { x: 100, y: 300, text: 'Imported comment' });
  else
    addHighlight(doc, 0, {
      kind,
      text: 'Imported comment',
      quads: [rectQuad({ x: 100, y: 200, width: 120, height: 24 })],
    });
  const ref = page.node.Annots().get(0);
  const dict = doc.context.lookup(ref);
  if (kind !== 'note') {
    const popup = doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Popup',
        Parent: ref,
        Rect: [240, 100, 380, 200],
      }),
    );
    dict.set(PDFName.of('Popup'), popup);
    page.node.addAnnot(popup);
  }
  if (indirect)
    for (const ref of page.node.Annots().asArray()) {
      const annotation = doc.context.lookup(ref);
      annotation.set(
        PDFName.of('Subtype'),
        doc.context.register(annotation.get(PDFName.of('Subtype'))),
      );
    }
  return { doc, dict, id: ref.toString() };
}
