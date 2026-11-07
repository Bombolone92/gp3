import { PDFDocument, PDFName } from 'pdf-lib';
import { attachmentStream, encryptedAttachment } from './encrypted-attachment.js';

/** A custom Crypt name already accepted by both the editor and the independent reader. */
export async function renamedCrypt({
  compressed = true,
  single = false,
  indirect = false,
  shared = false,
  identity = false,
  algorithm = 'AES-256',
  payload,
} = {}) {
  const names = shared ? ['private.txt', 'second.txt', 'ordinary.txt'] : ['private.txt'];
  const source = await encryptedAttachment({
    crypt: identity ? 'Identity' : 'StdCF',
    compressed,
    algorithm,
    names,
    ...(payload ? { payload } : {}),
  });
  const raw = await PDFDocument.load(source.bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const ctx = raw.context;
  const cf = ctx.lookup(ctx.trailerInfo.Encrypt).lookup(PDFName.of('CF'));
  cf.set(PDFName.of('LegacyCF'), cf.lookup(PDFName.of('StdCF')));
  const name = PDFName.of(identity ? 'Identity' : 'LegacyCF');
  const param = ctx.obj({ Name: indirect ? ctx.register(name) : name, Extra: 42 });
  const paramValue = indirect || shared ? ctx.register(param) : param;
  const filters = ctx.obj([
    PDFName.of('Crypt'),
    ...(compressed ? [PDFName.of('FlateDecode')] : []),
  ]);
  const parms = ctx.obj([paramValue, ...(compressed ? [null] : [])]);
  const filterValue = indirect ? ctx.register(filters) : filters;
  const parmsValue = indirect || shared ? ctx.register(parms) : parms;
  for (let index = 0; index < (shared ? 2 : 1); index++) {
    const dict = attachmentStream(raw, index).dict;
    dict.set(PDFName.of('Filter'), single ? PDFName.of('Crypt') : filterValue);
    dict.set(PDFName.of('DecodeParms'), single ? paramValue : parmsValue);
  }
  if (shared) {
    // Flate ignores Name/Extra, but this third stream must keep its shared parameter dictionary.
    const dict = attachmentStream(raw, 2).dict;
    dict.set(PDFName.of('Filter'), ctx.obj([PDFName.of('FlateDecode')]));
    dict.set(PDFName.of('DecodeParms'), ctx.obj([paramValue]));
  }
  return {
    ...source,
    names,
    bytes: await raw.save({ useObjectStreams: false, updateFieldAppearances: false }),
  };
}
