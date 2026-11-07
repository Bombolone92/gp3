import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import { createCipheriv, createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { protectPdf, rc4 as rc4Cipher, unlockPdf } from '../../src/core/security.js';

/** Literal LZW codes with EarlyChange=0, including code-width transitions. */
function lzwLiterals(bytes) {
  const output = [];
  let pending = 0,
    bits = 0,
    width = 9,
    next = 258,
    previous = false;
  const write = (code) => {
    pending = (pending << width) | code;
    bits += width;
    while (bits >= 8) {
      bits -= 8;
      output.push((pending >>> bits) & 255);
    }
  };
  write(256);
  for (const byte of bytes) {
    write(byte);
    if (previous && ++next === 1 << width && width < 12) width++;
    previous = true;
  }
  write(257);
  if (bits) output.push((pending << (8 - bits)) & 255);
  return Buffer.from(output);
}

/** A valid incremental update with compressed-object xref entries, readable by PDF.js. */
export async function cryptObjectStream({
  crypt = 'Identity',
  compressed = false,
  lzw = false,
  array = compressed || lzw,
  indirect = false,
  parameters = 'named',
  legacy = false,
  rc4 = false,
  defaultIdentity = false,
  objectStream = true,
  text = false,
  privateData = null,
  title = 'Crypt object stream report',
} = {}) {
  let saved;
  const password = legacy || rc4 ? 'user' : 'reader';
  if (legacy || rc4)
    saved = new Uint8Array(
      await readFile(new URL(`./security/${rc4 ? 'rc4-128' : 'aes-128'}.pdf`, import.meta.url)),
    );
  else {
    const doc = await PDFDocument.create();
    doc.addPage([400, 300]);
    doc.addPage([400, 300]);
    if (!objectStream) {
      doc.setTitle(title);
      doc.setAuthor('Ada');
    }
    if (text) doc.getPage(0).drawText('Named filter content', { x: 20, y: 200, size: 12 });
    if (privateData) {
      const ref = doc.context.register(doc.context.stream(privateData));
      const date = doc
        .getInfoDict()
        .entries()
        .find(([key]) => key.decodeText() === 'CreationDate')[1];
      doc
        .getPage(0)
        .node.set(
          PDFName.of('PieceInfo'),
          doc.context.obj({ PDFEditor: { LastModified: date, Private: ref } }),
        );
    }
    saved = await protectPdf(await doc.save(), { open: password, permissions: 'owner' });
  }
  const { encryption } = await unlockPdf(saved, password);
  const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
  const ctx = raw.context;
  if (rc4) {
    // Revisions 3 and 4 share these password/key checks when metadata stays encrypted.
    const encrypt = ctx.lookup(ctx.trailerInfo.Encrypt);
    for (const [key, value] of ctx
      .obj({
        V: 4,
        R: 4,
        CF: { StdCF: { CFM: 'V2', Length: 16, AuthEvent: 'DocOpen' } },
        StmF: 'StdCF',
        StrF: 'StdCF',
      })
      .entries())
      encrypt.set(key, value);
  }
  if (defaultIdentity) {
    const encrypt = ctx.lookup(ctx.trailerInfo.Encrypt);
    const name = encrypt.lookup(PDFName.of('StmF'));
    // Existing ciphertext must gain explicit Crypt selectors when changing the default.
    for (const [, object] of ctx.enumerateIndirectObjects()) {
      if (!(object instanceof PDFRawStream)) continue;
      const type = object.dict.lookup(PDFName.of('Type'));
      if (
        type === PDFName.of('XRef') ||
        (type === PDFName.of('Metadata') && !encryption.security.encryptMetadata)
      )
        continue;
      const filters = object.dict.lookup(PDFName.of('Filter'));
      const list = filters instanceof PDFArray ? filters.asArray() : filters ? [filters] : [];
      const parms = object.dict.lookup(PDFName.of('DecodeParms'));
      const parameters =
        parms instanceof PDFArray
          ? parms.asArray()
          : list.map((_, i) => (i === 0 ? (parms ?? null) : null));
      object.dict.set(PDFName.of('Filter'), ctx.obj([PDFName.of('Crypt'), ...list]));
      object.dict.set(PDFName.of('DecodeParms'), ctx.obj([ctx.obj({ Name: name }), ...parameters]));
    }
    encrypt.set(PDFName.of('StmF'), PDFName.of('Identity'));
  }
  if (!objectStream)
    return {
      bytes: await raw.save({ useObjectStreams: false, updateFieldAppearances: false }),
      title,
      password,
    };
  const inner = ctx.trailerInfo.Info;
  const pageRef = raw.getPage(0).ref;
  const page = raw.getPage(0).node.clone(ctx);
  page.set(PDFName.of('MediaBox'), ctx.obj([0, 0, 510, 710]));
  const info = ctx.obj({ Title: PDFString.of(title), Author: PDFString.of('Ada') }).toString();
  const header = `${inner.objectNumber} 0 ${pageRef.objectNumber} ${Buffer.byteLength(info) + 1} `;
  let contents = Buffer.from(`${header}${info}\n${page}`);
  if (lzw) contents = lzwLiterals(contents);
  if (compressed) contents = deflateSync(contents);
  const filters = crypt === null ? [] : [PDFName.of('Crypt')];
  const parms =
    crypt === null
      ? []
      : [
          parameters === 'missing'
            ? null
            : ctx.obj(parameters === 'unnamed' ? {} : { Name: crypt }),
        ];
  if (compressed) {
    filters.push(PDFName.of('FlateDecode'));
    parms.push(null);
  }
  if (lzw) {
    filters.push(PDFName.of('LZWDecode'));
    parms.push(ctx.obj({ EarlyChange: 0 }));
  }
  const filter = array ? ctx.obj(filters) : filters[0];
  const decodeParms = array ? ctx.obj(parms) : parms[0];
  const streamDict = { Type: 'ObjStm', N: 2, First: Buffer.byteLength(header) };
  if (filter) streamDict.Filter = indirect ? ctx.register(filter) : filter;
  if (decodeParms) streamDict.DecodeParms = indirect ? ctx.register(decodeParms) : decodeParms;
  // The referenced filter/parameter objects are ordinary direct definitions in the base file.
  const base = await raw.save({ useObjectStreams: false, updateFieldAppearances: false });
  const outer = ctx.nextRef();
  const xref = ctx.nextRef();
  if (crypt !== 'Identity' && parameters === 'named') {
    let key = encryption.fileKey;
    if (encryption.security.streamMethod === 'AESV2' || rc4) {
      const num = outer.objectNumber;
      key = createHash('md5')
        .update(key)
        .update(
          Buffer.from([
            num & 255,
            (num >> 8) & 255,
            (num >> 16) & 255,
            0,
            0,
            ...(rc4 ? [] : [0x73, 0x41, 0x6c, 0x54]),
          ]),
        )
        .digest()
        .subarray(0, 16);
    }
    if (rc4) contents = Buffer.from(rc4Cipher(key, contents));
    else {
      const iv = Buffer.alloc(16, 73);
      const cipher = createCipheriv(`aes-${key.length * 8}-cbc`, key, iv);
      contents = Buffer.concat([iv, cipher.update(contents), cipher.final()]);
    }
  }
  const objectBytes = (ref, object) => {
    const bytes = new Uint8Array(object.sizeInBytes());
    object.copyBytesInto(bytes, 0);
    return Buffer.concat([
      Buffer.from(`\n${ref.objectNumber} ${ref.generationNumber} obj\n`),
      bytes,
      Buffer.from('\nendobj\n'),
    ]);
  };
  const stream = objectBytes(outer, ctx.stream(contents, streamDict));
  const streamOffset = base.length + 1;
  const xrefOffset = base.length + stream.length + 1;
  const rows = [
    [inner, 2, outer.objectNumber, 0],
    [pageRef, 2, outer.objectNumber, 1],
    [outer, 1, streamOffset, 0],
    [xref, 1, xrefOffset, 0],
  ].sort((a, b) => a[0].objectNumber - b[0].objectNumber);
  const index = [],
    entries = [];
  let previous;
  for (const [ref, type, offset, generation] of rows) {
    if (ref.objectNumber === previous + 1) index[index.length - 1]++;
    else index.push(ref.objectNumber, 1);
    previous = ref.objectNumber;
    const entry = Buffer.alloc(7);
    entry[0] = type;
    entry.writeUInt32BE(offset, 1);
    entry.writeUInt16BE(generation, 5);
    entries.push(entry);
  }
  const prev = Number(/startxref\s+(\d+)\s+%%EOF/.exec(Buffer.from(base).toString('latin1'))[1]);
  const crossReference = objectBytes(
    xref,
    ctx.stream(Buffer.concat(entries), {
      Type: 'XRef',
      Size: xref.objectNumber + 1,
      W: [1, 4, 2],
      Index: index,
      Root: ctx.trailerInfo.Root,
      Info: inner,
      Encrypt: ctx.trailerInfo.Encrypt,
      ID: ctx.lookup(ctx.trailerInfo.ID),
      Prev: prev,
    }),
  );
  const bytes = new Uint8Array(
    Buffer.concat([base, stream, crossReference, Buffer.from(`startxref\n${xrefOffset}\n%%EOF\n`)]),
  );
  return { bytes, title, password };
}
