import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { deflateSync } from 'node:zlib';
import { cryptObjectStream } from './crypt-object-stream.js';
import { addMetadata } from './metadata.js';
import { openedProtection, protectPdf, unlockPdf } from '../../src/core/security.js';

export async function cryptMetadata({
  crypt = 'StdCF',
  compressed = true,
  indirect = false,
  shared = false,
  missing = false,
  omitted = false,
  legacy = false,
  xml: replacement,
} = {}) {
  const base = await cryptObjectStream({ objectStream: false, legacy });
  const opened = await unlockPdf(base.bytes, base.password);
  const doc = await PDFDocument.load(opened.bytes, { updateMetadata: false });
  const xml = replacement ?? addMetadata(doc);
  const ctx = doc.context;
  const params = ctx.obj(missing ? {} : { Name: crypt });
  const paramValue = indirect || shared ? ctx.register(params) : params;
  const filters = compressed ? ctx.obj(['Crypt', 'FlateDecode']) : PDFName.of('Crypt');
  const parms = compressed ? ctx.obj([paramValue, { Predictor: 1, Extra: 42 }]) : paramValue;
  const contents = new TextEncoder().encode(xml);
  const ref = ctx.register(
    PDFRawStream.of(
      ctx.obj({
        Type: 'Metadata',
        Subtype: 'XML',
        Filter: indirect ? ctx.register(filters) : filters,
        DecodeParms: indirect ? ctx.register(parms) : parms,
      }),
      compressed ? new Uint8Array(deflateSync(contents)) : contents,
    ),
  );
  if (omitted) ctx.lookup(ref).dict.delete(PDFName.of('DecodeParms'));
  doc.catalog.set(PDFName.of('Metadata'), ref);
  if (shared) {
    // An unrelated dictionary shares Crypt parameters and must not be rewritten by a read/edit.
    doc.catalog.set(PDFName.of('AuditShared'), paramValue);
  }
  if (crypt === 'LegacyCF') {
    const cf = opened.encryption.dict.lookup(PDFName.of('CF'));
    cf.set(PDFName.of('LegacyCF'), cf.lookup(PDFName.of('StdCF')));
  }
  return {
    bytes: await protectPdf(
      await doc.save({ useObjectStreams: false }),
      openedProtection(opened, base.password),
    ),
    password: base.password,
    title: 'XMP title',
    xml,
  };
}
