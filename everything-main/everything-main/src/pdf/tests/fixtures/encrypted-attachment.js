import { PDFArray, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { deflateSync } from 'node:zlib';
import { cryptObjectStream } from './crypt-object-stream.js';
import { openedProtection, protectPdf, unlockPdf } from '../../src/core/security.js';

export function attachmentStream(doc, index = 0) {
  return doc.catalog
    .lookup(PDFName.of('Names'))
    .lookup(PDFName.of('EmbeddedFiles'))
    .lookup(PDFName.of('Names'))
    .lookup(index * 2 + 1)
    .lookup(PDFName.of('EF'))
    .lookup(PDFName.of('F'));
}

/** Keep other streams valid while independently changing the embedded-file default. */
export async function encryptedAttachment({
  algorithm = 'AES-256',
  stream = 'Identity',
  eff = 'StdCF',
  crypt = null,
  indirect = false,
  compressed = true,
  names = ['private.txt'],
  payload = new TextEncoder().encode('Private attachment that must retain its contents.'),
} = {}) {
  const base = await cryptObjectStream({
    objectStream: false,
    legacy: algorithm === 'AES-128',
    rc4: algorithm === 'RC4',
  });
  const opened = await unlockPdf(base.bytes, base.password);
  const doc = await PDFDocument.load(opened.bytes);
  for (const name of names) await doc.attach(payload, name, { mimeType: 'text/plain' });
  await doc.flush();
  if (!compressed) {
    for (let index = 0; index < names.length; index++) {
      const embedded = attachmentStream(doc, index);
      embedded.contents = payload;
      embedded.dict.delete(PDFName.of('Filter'));
    }
  }
  const encoded = compressed ? new Uint8Array(deflateSync(payload)) : payload;
  const protectedBytes = await protectPdf(
    await doc.save(),
    openedProtection(opened, base.password),
  );
  const raw = await PDFDocument.load(protectedBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const ctx = raw.context;
  const encrypt = ctx.lookup(ctx.trailerInfo.Encrypt);
  if (stream === 'Identity') {
    for (const [, object] of ctx.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream)) continue;
      const type = object.dict.lookup(PDFName.of('Type'));
      if (type === PDFName.of('XRef') || type === PDFName.of('EmbeddedFile')) continue;
      const filters = object.dict.lookup(PDFName.of('Filter'));
      const list = filters instanceof PDFArray ? filters.asArray() : filters ? [filters] : [];
      const parms = object.dict.lookup(PDFName.of('DecodeParms'));
      const parameters =
        parms instanceof PDFArray
          ? parms.asArray()
          : list.map((_, i) => (i === 0 ? (parms ?? null) : null));
      object.dict.set(PDFName.of('Filter'), ctx.obj([PDFName.of('Crypt'), ...list]));
      object.dict.set(
        PDFName.of('DecodeParms'),
        ctx.obj([ctx.obj({ Name: 'StdCF' }), ...parameters]),
      );
    }
  }
  encrypt.set(PDFName.of('StmF'), PDFName.of(stream));
  if (eff === null) encrypt.delete(PDFName.of('EFF'));
  else encrypt.set(PDFName.of('EFF'), indirect ? ctx.register(PDFName.of(eff)) : PDFName.of(eff));
  const selected = crypt ?? eff ?? stream;
  for (let index = 0; index < names.length; index++) {
    const embedded = attachmentStream(raw, index);
    if (selected === 'Identity') embedded.contents = encoded;
    if (crypt) {
      embedded.dict.set(
        PDFName.of('Filter'),
        ctx.obj([PDFName.of('Crypt'), ...(compressed ? [PDFName.of('FlateDecode')] : [])]),
      );
      embedded.dict.set(
        PDFName.of('DecodeParms'),
        ctx.obj([ctx.obj({ Name: crypt }), ...(compressed ? [null] : [])]),
      );
    }
  }
  return {
    bytes: await raw.save({ useObjectStreams: false, updateFieldAppearances: false }),
    payload,
    password: base.password,
  };
}
