import { expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cryptMetadata } from './fixtures/crypt-metadata.js';
import { documentDetails, setDocumentDetails } from '../src/core/details.js';
import { readXmp } from '../src/core/xmp.js';
import { openedProtection, protectPdf, unlockPdf } from '../src/core/security.js';

async function reader(bytes, password) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password });
  try {
    return (await (await task.promise).getMetadata()).metadata;
  } finally {
    await task.destroy();
  }
}
for (const [label, options] of [
  ['named filter', {}],
  ['custom name', { crypt: 'LegacyCF' }],
  ['AES-128 filter', { legacy: true }],
  ['Identity array', { crypt: 'Identity' }],
  ['Identity single filter', { crypt: 'Identity', compressed: false }],
  ['implicit Identity', { missing: true }],
  ['absent parameters', { omitted: true, compressed: false }],
  ['indirect filters and parameters', { indirect: true }],
  ['shared parameters', { crypt: 'LegacyCF', indirect: true, shared: true }],
])
  it(`reads and edits metadata with an already handled ${label}`, async () => {
    const { bytes, password, title } = await cryptMetadata(options);
    expect((await reader(bytes, password)).get('dc:title')).toBe(title);
    const opened = await unlockPdf(bytes, password);
    const doc = await PDFDocument.load(opened.bytes, { updateMetadata: false });
    const oldStream = doc.catalog.lookup(PDFName.of('Metadata'));
    const oldDict = oldStream.dict.toString();
    const oldContents = oldStream.getContents().slice();
    expect(documentDetails(doc).title).toBe(title);
    expect(readXmp(doc).error).toBeFalsy();
    expect(oldStream.dict.toString()).toBe(oldDict);
    expect(oldStream.getContents()).toEqual(oldContents);
    setDocumentDetails(doc, { author: 'New author' });
    expect(documentDetails(doc)).toMatchObject({ title, author: 'New author' });
    expect(oldStream.dict.toString()).toBe(oldDict);
    expect(oldStream.getContents()).toEqual(oldContents);
    if (options.shared)
      expect(doc.catalog.lookup(PDFName.of('AuditShared')).lookup(PDFName.of('Name'))).toBe(
        PDFName.of('LegacyCF'),
      );
    const saved = await protectPdf(await doc.save(), openedProtection(opened, password));
    const metadata = await reader(saved, password);
    expect(metadata.get('dc:title')).toBe(title);
    expect(metadata.get('dc:creator')).toEqual(['New author']);
    expect(metadata.get('custom:reference')).toBe('record-123');
    const raw = await PDFDocument.load(saved, { ignoreEncryption: true, updateMetadata: false });
    const dict = raw.catalog.lookup(PDFName.of('Metadata')).dict;
    expect(dict.lookup(PDFName.of('Filter')).lookup(0)).toBe(PDFName.of('Crypt'));
    const params = dict.lookup(PDFName.of('DecodeParms')).lookup(0);
    expect(params?.lookup?.(PDFName.of('Name'))).toBe(
      options.missing || options.omitted ? undefined : PDFName.of(options.crypt ?? 'StdCF'),
    );
    const again = await unlockPdf(saved, password);
    expect(
      documentDetails(await PDFDocument.load(again.bytes, { updateMetadata: false })).author,
    ).toBe('New author');
  });

for (const [label, xml] of [
  ['malformed XML', '<broken>'],
  ['oversized decompressed metadata', `<x:xmpmeta>${' '.repeat(9 * 1024 * 1024)}</x:xmpmeta>`],
])
  it(`keeps the metadata safety check for Crypt followed by ${label}`, async () => {
    const { bytes, password } = await cryptMetadata({ xml });
    const opened = await unlockPdf(bytes, password);
    const doc = await PDFDocument.load(opened.bytes, { updateMetadata: false });
    const stream = doc.catalog.lookup(PDFName.of('Metadata'));
    const dict = stream.dict.toString(),
      contents = stream.getContents().slice();
    expect(readXmp(doc).error).toBe(true);
    expect(() => setDocumentDetails(doc, { author: 'New author' })).toThrow(
      'could not be updated safely',
    );
    expect(stream.dict.toString()).toBe(dict);
    expect(stream.getContents()).toEqual(contents);
  });
