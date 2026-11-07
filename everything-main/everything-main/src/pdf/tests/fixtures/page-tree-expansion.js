import { PDFDocument, PDFName } from 'pdf-lib';

/** A compact graph whose shared branches expand to 2 ** depth page occurrences. */
export async function expandingPageTree(
  depth,
  { empty = false, keepPage = false, cycle = false } = {},
) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 300]);
  let ref = empty
    ? doc.context.register(doc.context.obj({ Type: 'Pages', Kids: [], Count: 0 }))
    : page.ref;
  for (let i = 0; i < depth; i++)
    ref = doc.context.register(doc.context.obj({ Type: 'Pages', Kids: [ref, ref], Count: 0 }));
  if (keepPage)
    ref = doc.context.register(doc.context.obj({ Type: 'Pages', Kids: [ref, page.ref], Count: 1 }));
  if (cycle) doc.context.lookup(ref).lookup(PDFName.of('Kids')).push(ref);
  doc.catalog.set(PDFName.of('Pages'), ref);
  return doc.save({ addDefaultPage: false, updateFieldAppearances: false });
}
