import { expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { replacementPng } from './fixtures/crypt-replacement.js';
import { PdfSession, duplicatePage } from '../src/core/document.js';
import { inspectImages, replaceImage } from '../src/core/image-edit.js';

const xobjectNames = async (bytes, index) =>
  (await PDFDocument.load(bytes))
    .getPage(index)
    .node.Resources()
    .lookup(PDFName.of('XObject'))
    .keys()
    .map((key) => key.decodeText())
    .sort();

it('keeps only the latest replacement of a picture, wherever it is still drawn', async () => {
  const start = await PDFDocument.create();
  start
    .addPage([400, 400])
    .drawImage(await start.embedPng(replacementPng()), { x: 40, y: 40, width: 300, height: 300 });
  const session = new PdfSession(await start.save());
  const replace = (index) =>
    session.change((doc) =>
      replaceImage(doc, index, inspectImages(doc, index)[0], new Uint8Array(replacementPng())),
    );
  await replace(0);
  // A copy of the page keeps drawing the first replacement.
  await session.change((doc) => duplicatePage(doc, 0));
  const copied = await xobjectNames(session.bytes, 1);
  await replace(0);
  await replace(0);
  const names = await xobjectNames(session.bytes, 0);
  expect(names.filter((name) => name.startsWith('ReplacementImage'))).toHaveLength(1);
  expect(await xobjectNames(session.bytes, 1)).toEqual(copied);
  const doc = await PDFDocument.load(session.bytes);
  for (const index of [0, 1]) expect(inspectImages(doc, index)).toHaveLength(1);
});
