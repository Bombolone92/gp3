import { expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { cryptReplacement, replacementPng } from './fixtures/crypt-replacement.js';
import { inspectImages, replaceImage } from '../src/core/image-edit.js';
import { PdfSession } from '../src/core/document.js';
import { openedProtection, protectPdf, unlockPdf } from '../src/core/security.js';

async function pixels(bytes, password) {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  });

  try {
    const page = await (await task.promise).getPage(1),
      viewport = page.getViewport({ scale: 1 });
    const canvas = createCanvas(viewport.width, viewport.height),
      ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } finally {
    await task.destroy();
  }
}
function selector(stream) {
  const filter = stream.dict.lookup(PDFName.of('Filter'));
  expect(filter instanceof PDFArray).toBe(true);
  expect(filter.lookup(0)).toBe(PDFName.of('Crypt'));
  return stream.dict.lookup(PDFName.of('DecodeParms')).lookup(0).lookup(PDFName.of('Name'));
}
for (const [label, options] of [
  ['named selector', {}],
  ['Identity exemption', { identity: true }],
  ['Identity over an encrypted default', { identity: true, defaultEncrypted: true }],
  ['AES-128', { legacy: true }],
  ['indirect custom selector', { custom: true, indirect: true }],
  ['nested Form', { nested: true }],
  ['shared image', { shared: true }],
  ['private soft mask', { mask: 'SMask' }],
  ['public soft mask', { mask: 'SMask', maskIdentity: true }],
  ['private mask on public image', { identity: true, mask: 'SMask' }],
  ['public hard mask', { mask: 'Mask', maskIdentity: true }],
])
  it(`preserves ${label} protection when replacing image pixels`, async () => {
    const source = await cryptReplacement(options),
      opened = await unlockPdf(source.bytes, source.password);
    const original = await PDFDocument.load(opened.bytes, { updateMetadata: false });
    const old = inspectImages(original, 0)[0].object,
      oldBytes = old.getContents().slice(),
      oldDict = old.dict.toString();
    const before = await pixels(source.bytes, source.password);
    expect(selector(old)).toBe(PDFName.of(source.name));
    if (options.mask)
      expect(selector(old.dict.lookup(PDFName.of(options.mask)))).toBe(
        PDFName.of(options.maskIdentity ? 'Identity' : options.custom ? 'LegacyCF' : 'StdCF'),
      );
    const session = new PdfSession(opened.bytes);
    await session.change(
      async (doc) => {
        const oldImage = inspectImages(doc, 0)[0].object,
          bytes = oldImage.getContents().slice(),
          dict = oldImage.dict.toString();
        await replaceImage(doc, 0, inspectImages(doc, 0)[0], replacementPng());
        expect(oldImage.getContents()).toEqual(bytes);
        expect(oldImage.dict.toString()).toBe(dict);
      },
      { streamProtection: opened.encryption },
    );
    const editedBytes = session.bytes.slice();
    const edited = await PDFDocument.load(editedBytes, { updateMetadata: false });
    const image = inspectImages(edited, 0)[0].object,
      mask = image.dict.lookup(PDFName.of('SMask'));
    expect(selector(image)).toBe(PDFName.of(source.name));
    const maskName = options.mask
      ? options.maskIdentity
        ? 'Identity'
        : options.custom
          ? 'LegacyCF'
          : 'StdCF'
      : source.name;
    expect(selector(mask)).toBe(PDFName.of(maskName));
    if (options.shared) {
      const other = inspectImages(edited, 0)[1].object;
      expect(other.getContents()).toEqual(oldBytes);
      expect(other.dict.toString()).toBe(oldDict);
    }
    expect(session.undo()).toBe(true);
    expect(session.bytes).toEqual(opened.bytes);
    expect(session.redo()).toBe(true);
    expect(session.bytes).toEqual(editedBytes);
    const saved = await protectPdf(editedBytes, openedProtection(opened, source.password));
    const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
    for (const [stream, name] of [
      [image, source.name],
      [mask, maskName],
    ]) {
      const cipher = raw.context.lookup(edited.context.getObjectRef(stream));
      expect(selector(cipher)).toBe(PDFName.of(name));
      if (name === 'Identity') expect(cipher.getContents()).toEqual(stream.getContents());
      else expect(cipher.getContents()).not.toEqual(stream.getContents());
    }
    const expected = await pixels(editedBytes),
      actual = await pixels(saved, source.password);
    expect(actual).toEqual(expected);
    expect(actual).not.toEqual(before);
  });

for (const encrypted of [false, true])
  it(`keeps ordinary replacement images on the document default (encrypted=${encrypted})`, async () => {
    const doc = await PDFDocument.create(),
      page = doc.addPage([400, 300]);
    const image = await doc.embedPng(replacementPng());
    page.drawImage(image, { x: 20, y: 30, width: 30, height: 40 });
    const plain = await doc.save();
    const source = encrypted ? await protectPdf(plain, { open: 'reader' }) : plain;
    const opened = encrypted ? await unlockPdf(source, 'reader') : { bytes: source };
    const session = new PdfSession(opened.bytes);
    await session.change(
      (doc) => replaceImage(doc, 0, inspectImages(doc, 0)[0], replacementPng()),
      { streamProtection: opened.encryption },
    );
    const working = await PDFDocument.load(session.bytes, { updateMetadata: false });
    const replaced = inspectImages(working, 0)[0].object;
    const saved = encrypted
      ? await protectPdf(session.bytes, openedProtection(opened, 'reader'))
      : session.bytes;
    const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
    for (const stream of [replaced, replaced.dict.lookup(PDFName.of('SMask'))]) {
      const cipher = raw.context.lookup(working.context.getObjectRef(stream));
      expect(cipher.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
      if (encrypted) expect(cipher.getContents()).not.toEqual(stream.getContents());
      else expect(cipher.getContents()).toEqual(stream.getContents());
    }
    expect(await pixels(saved, encrypted ? 'reader' : undefined)).toEqual(
      await pixels(session.bytes),
    );
  });
