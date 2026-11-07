import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cryptEditing } from './fixtures/crypt-editing.js';
import { inspectText, replaceText, pageSource, setPageSource } from '../src/core/text-edit.js';
import { PdfSession } from '../src/core/document.js';
import { inspectImages, editImage } from '../src/core/image-edit.js';
import { inspectPaths, editPath } from '../src/core/path-edit.js';
import { openedProtection, protectPdf, unlockPdf } from '../src/core/security.js';

function task(bytes, password) {
  return pdfjs.getDocument({
    data: bytes.slice(),
    password,
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)
      .pathname,
  });
}
for (const [label, options] of [
  ['named array', {}],
  ['named single', { single: true }],
  ['Identity', { identity: true }],
  ['AES-128', { legacy: true }],
  ['indirect custom filter', { custom: true, indirect: true }],
  ['nested Form', { nested: true }],
])
  it(`edits text, images, and paths in content using ${label}`, async () => {
    const { bytes, password, name } = await cryptEditing(options);
    const input = task(bytes, password);
    try {
      expect(
        (await (await (await input.promise).getPage(1)).getTextContent()).items
          .map((x) => x.str)
          .join(''),
      ).toBe('Original text');
    } finally {
      await input.destroy();
    }
    const opened = await unlockPdf(bytes, password);
    const doc = await PDFDocument.load(opened.bytes, { updateMetadata: false });
    const snapshots = [...doc.context.indirectObjects.values()]
      .filter((x) => x instanceof PDFRawStream)
      .map((stream) => ({
        stream,
        dict: stream.dict.toString(),
        bytes: stream.getContents().slice(),
      }));
    const plain = task(opened.bytes);
    try {
      const page = await (await plain.promise).getPage(1);
      const runs = await inspectText(doc, 0, page, pdfjs.OPS);
      expect(runs.map((x) => x.text)).toEqual(['Original text']);
      expect(inspectImages(doc, 0)).toHaveLength(1);
      expect(inspectPaths(doc, 0)).toHaveLength(1);
      for (const { stream, dict, bytes } of snapshots) {
        expect(stream.dict.toString()).toBe(dict);
        expect(stream.getContents()).toEqual(bytes);
      }
      await replaceText(doc, 0, runs[0], 'Edited text');
      const image = inspectImages(doc, 0)[0];
      editImage(doc, 0, image, { transform: [...image.transform.slice(0, 4), 180, 60] });
      const path = inspectPaths(doc, 0)[0];
      editPath(doc, 0, path, { transform: [...path.transform.slice(0, 4), 45, 60] });
    } finally {
      await plain.destroy();
    }
    const saved = await protectPdf(await doc.save(), openedProtection(opened, password));
    const output = task(saved, password);
    try {
      expect(
        (await (await (await output.promise).getPage(1)).getTextContent()).items
          .map((x) => x.str)
          .join(''),
      ).toBe('Edited text');
    } finally {
      await output.destroy();
    }
    const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
    const streams = raw.getPage(0).node.Contents();
    const content = streams.lookup(0);
    expect(content.dict.lookup(PDFName.of('Filter')).lookup(0)).toBe(PDFName.of('Crypt'));
    expect(
      content.dict.lookup(PDFName.of('DecodeParms')).lookup(0).lookup(PDFName.of('Name')),
    ).toBe(PDFName.of(name));
    if (options.nested) {
      const forms = [...raw.context.indirectObjects.values()].filter(
        (stream) =>
          stream instanceof PDFRawStream &&
          stream.dict.lookup(PDFName.of('Subtype')) === PDFName.of('Form'),
      );
      expect(forms.length).toBeGreaterThan(0);
      for (const form of forms)
        expect(
          form.dict.lookup(PDFName.of('DecodeParms')).lookup(0).lookup(PDFName.of('Name')),
        ).toBe(PDFName.of(name));
    }
    const again = await unlockPdf(saved, password);
    const edited = await PDFDocument.load(again.bytes);
    expect(inspectImages(edited, 0)[0].transform.slice(4)).toEqual([180, 60]);
    expect(inspectPaths(edited, 0)[0].transform.slice(4)).toEqual([45, 60]);
  });

for (const [label, first, second, defaultName, selected] of [
  ['encrypted and Identity', 'StdCF', 'Identity', 'Identity', 'StdCF'],
  ['Identity and implicit encryption', 'Identity', null, 'StdCF', null],
  ['named cleartext and implicit encryption', 'PublicCF', null, 'StdCF', null],
  ['named cleartext and explicit encryption', 'PublicCF', 'StdCF', 'Identity', 'StdCF'],
])
  it(`retains protection when merging ${label} content streams`, async () => {
    const source = await cryptEditing();
    const opened = await unlockPdf(source.bytes, source.password);
    const doc = await PDFDocument.load(opened.bytes, { updateMetadata: false });
    const page = doc.getPage(0);
    const original = page.node.Contents().lookup(0);
    original.dict.set(PDFName.of('DecodeParms'), doc.context.obj([{ Name: first }, null]));
    opened.encryption.dict.set(PDFName.of('StmF'), PDFName.of(defaultName));
    opened.encryption.security.streamMethod = defaultName === 'Identity' ? 'None' : 'AESV3';
    opened.encryption.dict
      .lookup(PDFName.of('CF'))
      .set(PDFName.of('PublicCF'), opened.encryption.dict.context.obj({ CFM: 'None' }));
    const font = page.node.Resources().lookup(PDFName.of('Font')).keys()[0];
    const extra = doc.context.flateStream(`BT ${font} 16 Tf 20 190 Td (Second secret) Tj ET`);
    if (second) {
      extra.dict.set(PDFName.of('Filter'), doc.context.obj(['Crypt', 'FlateDecode']));
      extra.dict.set(PDFName.of('DecodeParms'), doc.context.obj([{ Name: second }, null]));
    }
    page.node.set(
      PDFName.of('Contents'),
      doc.context.obj([page.node.Contents().get(0), doc.context.register(extra)]),
    );
    const bytes = await protectPdf(await doc.save(), openedProtection(opened, source.password));
    const input = task(bytes, source.password);
    try {
      expect(
        (await (await (await input.promise).getPage(1)).getTextContent()).items
          .map((x) => x.str)
          .filter(Boolean),
      ).toEqual(['Original text', 'Second secret']);
    } finally {
      await input.destroy();
    }
    const working = await unlockPdf(bytes, source.password);
    const session = new PdfSession(working.bytes);
    await session.change(
      (current) =>
        setPageSource(
          current,
          current.getPage(0),
          pageSource(current.getPage(0)) + `\nBT ${font} 16 Tf 20 160 Td (Combined secret) Tj ET`,
        ),
      { streamProtection: working.encryption },
    );
    const saved = await protectPdf(session.bytes, openedProtection(working, source.password));
    const output = task(saved, source.password);
    try {
      expect(
        (await (await (await output.promise).getPage(1)).getTextContent()).items
          .map((x) => x.str)
          .filter(Boolean),
      ).toEqual(['Original text', 'Second secret', 'Combined secret']);
    } finally {
      await output.destroy();
    }
    const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
    const dict = raw.getPage(0).node.Contents().lookup(0).dict;
    if (selected)
      expect(dict.lookup(PDFName.of('DecodeParms')).lookup(0).lookup(PDFName.of('Name'))).toBe(
        PDFName.of(selected),
      );
    else expect(dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
  });
