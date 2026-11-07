import { expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { PdfSession, movePage, validatePdf } from '../src/core/document.js';
import { inspectImages } from '../src/core/image-edit.js';
import { repairPageParents } from '../src/core/structure.js';

/** Two pages under an intermediate node; `loop` bends a Parent link back into the tree. */
async function looped(loop) {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  doc.addPage([200, 100]);
  const rootRef = doc.catalog.get(PDFName.of('Pages'));
  const root = doc.catalog.Pages();
  const pages = [0, 1].map((i) => doc.getPage(i));
  // Move both pages under an intermediate node that supplies their size.
  const middle = doc.context.obj({
    Type: 'Pages',
    Kids: pages.map((page) => page.ref),
    Count: 2,
    Parent: rootRef,
    MediaBox: [0, 0, 400, 500],
  });
  const middleRef = doc.context.register(middle);
  root.set(PDFName.of('Kids'), doc.context.obj([middleRef]));
  for (const page of pages) {
    page.node.set(PDFName.of('Parent'), middleRef);
    page.node.delete(PDFName.of('MediaBox'));
    page.node.delete(PDFName.of('Resources'));
  }
  if (loop === 'root') root.set(PDFName.of('Parent'), rootRef);
  if (loop === 'middle') middle.set(PDFName.of('Parent'), pages[0].ref);
  return doc.save({ useObjectStreams: false });
}

for (const loop of ['root', 'middle'])
  it(`edits a PDF whose page tree Parent links loop (${loop})`, async () => {
    const session = new PdfSession(await looped(loop));
    await session.change((doc) => {
      inspectImages(doc, 0);
      return movePage(doc, 0, 1);
    });
    const doc = await PDFDocument.load(session.bytes);
    expect(doc.getPageCount()).toBe(2);
    // Both pages still inherit their size from the node that holds them.
    for (const page of doc.getPages()) expect(page.getSize()).toEqual({ width: 400, height: 500 });
    expect((await validatePdf(await looped(loop))).getPage(0).getSize().width).toBe(400);
  });

it('leaves Parent links alone when they do not loop', async () => {
  const doc = await PDFDocument.load(await looped(null));
  const before = doc.getPages().map((page) => page.node.get(PDFName.of('Parent')));
  repairPageParents(doc);
  expect(doc.getPages().map((page) => page.node.get(PDFName.of('Parent')))).toEqual(before);
  expect(doc.catalog.Pages().has(PDFName.of('Parent'))).toBe(false);
});
