import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfSession, duplicatePage, insertPdfPages } from '../src/core/document.js';

/** A one-page tagged PDF whose page holds a figure with alternate text. */
async function tagged(word, alt) {
  const doc = await PDFDocument.create();
  const font = doc.embedStandardFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 300]);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font.ref } }));
  page.node.set(
    PDFName.of('Contents'),
    doc.context.register(
      doc.context.stream(`/Figure <</MCID 0>> BDC BT /F1 24 Tf 20 200 Td (${word}) Tj ET EMC`),
    ),
  );
  page.node.set(PDFName.of('StructParents'), doc.context.obj(0));
  const root = doc.context.register(doc.context.obj({ Type: 'StructTreeRoot' }));
  const figure = doc.context.register(
    doc.context.obj({
      Type: 'StructElem',
      S: 'Figure',
      P: root,
      Pg: page.ref,
      K: 0,
      Alt: PDFString.of(alt),
    }),
  );
  doc.context.lookup(root).set(PDFName.of('K'), doc.context.obj([figure]));
  doc.context.lookup(root).set(PDFName.of('ParentTree'), doc.context.obj({ Nums: [0, [figure]] }));
  doc.catalog.set(PDFName.of('StructTreeRoot'), root);
  doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }));
  return doc.save();
}
async function structure(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const trees = [];
    for (let i = 1; i <= pdf.numPages; i++)
      trees.push(JSON.stringify(await (await pdf.getPage(i)).getStructTree()));
    return trees;
  } finally {
    await task.destroy();
  }
}

for (const [label, operation] of [
  [
    'inserted from another tagged PDF',
    async (doc) => insertPdfPages(doc, await tagged('NEW', 'Signature')),
  ],
  ['duplicated', (doc) => duplicatePage(doc, 0)],
])
  it(`does not describe a page ${label} with this document's tags`, async () => {
    const session = new PdfSession(await tagged('TARGET', 'Company logo'));
    await session.change(operation);
    const [original, copy] = await structure(session.bytes);
    expect(original).toContain('Company logo');
    expect(copy).not.toContain('Company logo');
  });
