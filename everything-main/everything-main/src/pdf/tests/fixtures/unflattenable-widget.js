import { PDFDocument, PDFName, PDFString } from 'pdf-lib';

/** A signature field without an appearance, in either of the supported widget layouts. */
export async function unflattenableWidget({ indirect = true, merged = true } = {}) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  doc.addPage([450, 300]);
  const ctx = doc.context;
  const widget = {
    Type: 'Annot',
    Subtype: indirect ? ctx.register(PDFName.of('Widget')) : 'Widget',
    Rect: [20, 20, 150, 60],
    F: 4,
    P: page.ref,
  };
  const field = ctx.register(
    ctx.obj({ FT: 'Sig', T: PDFString.of('Signature'), ...(merged ? widget : {}) }),
  );
  const ref = merged ? field : ctx.register(ctx.obj({ ...widget, Parent: field }));
  if (!merged) ctx.lookup(field).set(PDFName.of('Kids'), ctx.obj([ref]));
  doc.catalog.getOrCreateAcroForm().Fields().push(field);
  page.node.addAnnot(ref);
  return doc;
}
