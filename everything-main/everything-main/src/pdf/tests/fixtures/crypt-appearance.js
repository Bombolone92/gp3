import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { deflateSync } from 'node:zlib';
import { cryptEditing } from './crypt-editing.js';
import { decode } from '../../src/core/text-edit.js';
import { openedProtection, protectPdf, unlockPdf } from '../../src/core/security.js';

export async function cryptAppearance({
  type = 'field',
  identity = false,
  legacy = false,
  custom = false,
  indirect = false,
  compressed = true,
  shared = false,
  pages = 1,
  kind = 'text',
} = {}) {
  const base = await cryptEditing({ identity, legacy, custom });
  const opened = await unlockPdf(base.bytes, base.password);
  const doc = await PDFDocument.load(opened.bytes, { updateMetadata: false });
  for (let i = 1; i < pages; i++) doc.addPage([400, 300]);
  const ctx = doc.context,
    page = doc.getPage(0);
  let stream;
  const fields = type === 'field' ? (shared ? 2 : 1) : 0;
  if (type === 'field') {
    const form = doc.getForm();
    for (let i = 0; i < fields; i++) {
      const field =
        kind === 'dropdown'
          ? form.createDropdown('private' + i)
          : kind === 'list'
            ? form.createOptionList('private' + i)
            : form.createTextField('private' + i);
      if (kind === 'dropdown' || kind === 'list') {
        field.setOptions(['Private field', 'Changed secret']);
        field.select('Private field');
      } else {
        field.setText('Private field');
        if (kind === 'password') field.enablePassword();
      }
      field.addToPage(page, { x: 20, y: 130 + i * 40, width: 150, height: 30 });
    }
    form.updateFieldAppearances();
    stream = form
      .getField('private0')
      .acroField.getWidgets()[0]
      .dict.lookup(PDFName.of('AP'))
      .lookup(PDFName.of('N'));
    if (shared)
      form
        .getField('private1')
        .acroField.getWidgets()[0]
        .dict.lookup(PDFName.of('AP'))
        .set(PDFName.of('N'), ctx.register(stream));
  } else {
    stream = ctx.stream('q 1 0 0 rg 0 0 80 30 re f Q', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 80, 30],
    });
    const ref = ctx.register(stream);
    page.node.addAnnot(
      ctx.register(
        ctx.obj({
          Type: 'Annot',
          Subtype: 'Stamp',
          Rect: [20, 130, 100, 160],
          F: 4,
          Contents: 'Private stamp',
          AP: { N: ref },
          P: page.ref,
        }),
      ),
    );
  }
  const plaintext = Uint8Array.from(decode(stream), (c) => c.charCodeAt(0));
  const name = identity ? 'Identity' : custom ? 'LegacyCF' : 'StdCF';
  const params = ctx.obj({ Name: indirect ? ctx.register(PDFName.of(name)) : name });
  const paramValue = indirect || shared ? ctx.register(params) : params;
  const filters = compressed ? ctx.obj(['Crypt', 'FlateDecode']) : PDFName.of('Crypt');
  const parms = compressed ? ctx.obj([paramValue, { Predictor: 1, Extra: 42 }]) : paramValue;
  stream.dict.set(PDFName.of('Filter'), indirect ? ctx.register(filters) : filters);
  stream.dict.set(PDFName.of('DecodeParms'), indirect ? ctx.register(parms) : parms);
  // Replace the generated stream with raw encoded contents while keeping every AP reference.
  const contents = compressed ? new Uint8Array(deflateSync(plaintext)) : plaintext;
  for (const [ref, value] of ctx.indirectObjects)
    if (value === stream) ctx.assign(ref, PDFRawStream.of(stream.dict, contents));
  if (shared) doc.catalog.set(PDFName.of('AuditAPParameters'), paramValue);
  return {
    bytes: await protectPdf(
      await doc.save({ updateFieldAppearances: false }),
      openedProtection(opened, base.password),
    ),
    password: base.password,
    name,
    fields,
    annotations: type === 'field' ? 0 : 1,
  };
}
