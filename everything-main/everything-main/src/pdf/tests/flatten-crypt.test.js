import { expect, it } from 'vitest';
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { cryptAppearance } from './fixtures/crypt-appearance.js';
import { flattenDocument } from '../src/core/flatten.js';
import { extractPages } from '../src/core/pages.js';
import { splitPdf } from '../src/core/split.js';
import { openedProtection, protectPdf, unlockPdf } from '../src/core/security.js';

async function view(bytes, password) {
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
      context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    return {
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
      annotations: await page.getAnnotations(),
    };
  } finally {
    await task.destroy();
  }
}
function difference(a, b) {
  let sum = 0;
  expect(a.pixels.length).toBe(b.pixels.length);
  for (let i = 0; i < a.pixels.length; i++) sum += Math.abs(a.pixels[i] - b.pixels[i]);
  return sum / a.pixels.length;
}
for (const [label, options] of [
  ['named array', {}],
  ['single filter', { compressed: false }],
  ['Identity', { identity: true }],
  ['AES-128', { legacy: true }],
  ['indirect custom filter', { custom: true, indirect: true }],
  ['shared appearance', { shared: true, indirect: true }],
  ['Stamp appearance', { type: 'stamp' }],
  ['Identity Stamp', { type: 'stamp', identity: true }],
])
  it(`flattens ${label} appearances without changing their drawing or cipher`, async () => {
    const { bytes, password, name, fields, annotations } = await cryptAppearance(options);
    const before = await view(bytes, password);
    expect(before.annotations).toHaveLength(fields + annotations);
    expect(before.annotations.every((annotation) => annotation.hasAppearance)).toBe(true);
    const opened = await unlockPdf(bytes, password);
    const doc = await PDFDocument.load(opened.bytes, { updateMetadata: false });
    const appearances = [...doc.context.indirectObjects.values()]
      .filter(
        (stream) =>
          stream instanceof PDFRawStream &&
          stream.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Form'),
      )
      .map((stream) => ({
        stream,
        dict: stream.dict.toString(),
        bytes: stream.getContents().slice(),
      }));
    expect(flattenDocument(doc)).toEqual({ fields, annotations });
    expect(doc.getForm().getFields()).toHaveLength(0);
    for (const { stream, dict, bytes } of appearances) {
      expect(stream.dict.toString()).toBe(dict);
      expect(stream.getContents()).toEqual(bytes);
    }
    const saved = await protectPdf(
      await doc.save({ updateFieldAppearances: false }),
      openedProtection(opened, password),
    );
    const after = await view(saved, password);
    expect(after.annotations).toHaveLength(0);
    expect(difference(before, after)).toBeLessThan(1.5);
    const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
    const objects = raw.getPage(0).node.Resources().lookup(PDFName.of('XObject'));
    const flattened = objects.entries().filter(([key]) => key.decodeText().startsWith('Flat'));
    expect(flattened.length).toBeGreaterThan(0);
    for (const [, ref] of flattened) {
      const dict = raw.context.lookup(ref).dict,
        parms = dict.lookup(PDFName.of('DecodeParms'));
      const params = parms instanceof PDFArray ? parms.lookup(0) : parms;
      expect(params.lookup(PDFName.of('Name'))).toBe(PDFName.of(name));
    }
    const extracted = await extractPages(opened.bytes, [0]);
    expect((await view(extracted)).annotations).toHaveLength(annotations);
    expect(difference(before, await view(extracted))).toBeLessThan(1.5);
    const split = await splitPdf(opened.bytes, [[0]]);
    expect((await view(split[0].bytes)).annotations).toHaveLength(annotations);
    expect(difference(before, await view(split[0].bytes))).toBeLessThan(1.5);
  });

for (const [label, filter] of [
  ['broken Flate', 'FlateDecode'],
  ['unsupported encoding', 'UnsupportedFilter'],
])
  it(`keeps fields with Crypt followed by ${label} unflattened`, async () => {
    const { bytes, password } = await cryptAppearance();
    const opened = await unlockPdf(bytes, password);
    const doc = await PDFDocument.load(opened.bytes, { updateMetadata: false });
    const stream = doc
      .getForm()
      .getTextField('private0')
      .acroField.getWidgets()[0]
      .dict.lookup(PDFName.of('AP'))
      .lookup(PDFName.of('N'));
    stream.dict.set(PDFName.of('Filter'), doc.context.obj(['Crypt', filter]));
    stream.contents = Uint8Array.from([1, 2, 3]);
    const dict = stream.dict.toString(),
      contents = stream.getContents().slice();
    expect(flattenDocument(doc)).toEqual({
      fields: 0,
      annotations: 0,
      unflattened: { fields: 1, annotations: 0 },
    });
    expect(doc.getForm().getTextField('private0').getText()).toBe('Private field');
    expect(stream.dict.toString()).toBe(dict);
    expect(stream.getContents()).toEqual(contents);
  });
