import { PDFDocument, PDFName } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { cryptEditing } from './crypt-editing.js';
import { inspectImages } from '../../src/core/image-edit.js';
import { pageSource, setPageSource } from '../../src/core/text-edit.js';
import { openedProtection, protectPdf, unlockPdf } from '../../src/core/security.js';

export function replacementPng() {
  const canvas = createCanvas(30, 40),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20,160,70,0.5)';
  ctx.fillRect(0, 0, 30, 40);
  ctx.fillStyle = '#ff8800';
  ctx.fillRect(0, 0, 12, 18);
  return canvas.toBuffer('image/png');
}

export async function cryptReplacement(options = {}) {
  const source = await cryptEditing(options);
  if (!options.shared && !options.mask && !options.defaultEncrypted) return source;
  const opened = await unlockPdf(source.bytes, source.password);
  const doc = await PDFDocument.load(opened.bytes, { updateMetadata: false });
  const image = inspectImages(doc, 0)[0];
  if (options.defaultEncrypted) {
    opened.encryption.dict.set(PDFName.of('StmF'), PDFName.of('StdCF'));
    opened.encryption.security.streamMethod = 'AESV3';
  }
  if (options.shared) {
    const name = image.source.trim().split(/\s+/)[0];
    setPageSource(
      doc,
      doc.getPage(0),
      pageSource(doc.getPage(0)) + `\nq 50 0 0 40 210 60 cm ${name} Do Q\n`,
    );
  }
  if (options.mask) {
    const name = options.maskIdentity ? 'Identity' : options.custom ? 'LegacyCF' : 'StdCF';
    const mask = doc.context.flateStream(Uint8Array.of(128), {
      Type: 'XObject',
      Subtype: 'Image',
      Width: 1,
      Height: 1,
      BitsPerComponent: options.mask === 'Mask' ? 1 : 8,
      ...(options.mask === 'Mask' ? { ImageMask: true } : { ColorSpace: 'DeviceGray' }),
    });
    mask.dict.set(PDFName.of('Filter'), doc.context.obj(['Crypt', 'FlateDecode']));
    mask.dict.set(PDFName.of('DecodeParms'), doc.context.obj([{ Name: name }, null]));
    image.object.dict.set(PDFName.of(options.mask), doc.context.register(mask));
  }
  return {
    ...source,
    bytes: await protectPdf(await doc.save(), openedProtection(opened, source.password)),
  };
}
