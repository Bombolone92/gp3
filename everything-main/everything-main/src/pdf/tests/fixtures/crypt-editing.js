import { PDFDocument, PDFName, PDFRawStream, PDFStream, rgb } from 'pdf-lib';
import { cryptObjectStream } from './crypt-object-stream.js';
import { decode as pageSourceFromStream, pageSource } from '../../src/core/text-edit.js';
import { openedProtection, protectPdf, unlockPdf } from '../../src/core/security.js';

export async function cryptEditing({
  nested = false,
  identity = false,
  legacy = false,
  custom = false,
  indirect = false,
  single = false,
  mixed = false,
} = {}) {
  const base = await cryptObjectStream({ objectStream: false, legacy });
  const opened = await unlockPdf(base.bytes, base.password);
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  page.drawText('Original text', { x: 20, y: 220, size: 16 });
  page.drawRectangle({ x: 30, y: 60, width: 60, height: 40, color: rgb(1, 0, 0) });
  const image = await doc.embedPng(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  page.drawImage(image, { x: 130, y: 60, width: 50, height: 40 });
  const raw = await PDFDocument.load(await doc.save(), { updateMetadata: false });
  const ctx = raw.context;
  if (nested) {
    const page = raw.getPage(0);
    const form = ctx.register(
      ctx.flateStream(pageSource(page), {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 400, 300],
        Resources: page.node.Resources(),
      }),
    );
    page.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Form: form } }));
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('/Form Do')));
  }
  let name = identity ? 'Identity' : custom ? 'LegacyCF' : 'StdCF';
  if (custom) {
    const cf = opened.encryption.dict.lookup(PDFName.of('CF'));
    cf.set(PDFName.of('LegacyCF'), cf.lookup(PDFName.of('StdCF')));
  }
  opened.encryption.dict.set(PDFName.of('StmF'), PDFName.of('Identity'));
  for (const [ref, stream] of ctx.indirectObjects) {
    if (!(stream instanceof PDFStream)) continue;
    const filter = stream.dict.lookup(PDFName.of('Filter'));
    const cryptParams = ctx.obj({ Name: indirect ? ctx.register(PDFName.of(name)) : name });
    const params = indirect ? ctx.register(cryptParams) : cryptParams;
    if (single && stream.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Image')) {
      const source = pageSourceFromStream(stream);
      stream.dict.set(PDFName.of('Filter'), PDFName.of('Crypt'));
      stream.dict.set(PDFName.of('DecodeParms'), params);
      ctx.assign(
        ref,
        PDFRawStream.of(
          stream.dict,
          Uint8Array.from(source, (c) => c.charCodeAt(0)),
        ),
      );
    } else {
      const filters = ctx.obj(['Crypt', ...(filter ? [filter] : [])]);
      const parms = ctx.obj([params, ...(filter ? [null] : [])]);
      stream.dict.set(PDFName.of('Filter'), indirect ? ctx.register(filters) : filters);
      stream.dict.set(PDFName.of('DecodeParms'), indirect ? ctx.register(parms) : parms);
    }
  }
  if (mixed) {
    const page = raw.getPage(0);
    page.node
      .Contents()
      .lookup(0)
      .dict.set(PDFName.of('DecodeParms'), ctx.obj([{ Name: 'PublicCF' }, null]));
    const font = page.node.Resources().lookup(PDFName.of('Font')).keys()[0];
    const extra = ctx.register(ctx.flateStream(`BT ${font} 16 Tf 20 190 Td (Second secret) Tj ET`));
    page.node.set(PDFName.of('Contents'), ctx.obj([page.node.Contents().get(0), extra]));
    opened.encryption.dict
      .lookup(PDFName.of('CF'))
      .set(PDFName.of('PublicCF'), opened.encryption.dict.context.obj({ CFM: 'None' }));
    opened.encryption.dict.set(PDFName.of('StmF'), PDFName.of('StdCF'));
    opened.encryption.security.streamMethod = 'AESV3';
    name = null;
  }
  return {
    bytes: await protectPdf(await raw.save(), openedProtection(opened, base.password)),
    password: base.password,
    name,
    nested,
  };
}
