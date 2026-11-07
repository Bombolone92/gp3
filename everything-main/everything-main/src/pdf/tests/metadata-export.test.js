import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compressPdf } from '../src/core/compress.js';
import { documentDetails } from '../src/core/details.js';
import * as detailsApi from '../src/core/details.js';
import { validatePdf } from '../src/core/document.js';
import { copyPagesFrom, extractPages } from '../src/core/pages.js';
import { splitPdf, splitRanges } from '../src/core/split.js';
import { addCompressiblePage, addMetadata, infoDetails, xmpDetails } from './fixtures/metadata.js';

const n = PDFName.of;
const xmlOf = (doc) =>
  new TextDecoder().decode(decodePDFRawStream(doc.catalog.lookup(n('Metadata'))).decode());
async function readerMetadata(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    return await (await task.promise).getMetadata();
  } finally {
    await task.destroy();
  }
}

describe('metadata when reducing file size', () => {
  it.each([
    ['newer XMP', {}, xmpDetails],
    ['equal timestamps', { xmpYear: 2020 }, xmpDetails],
    ['newer Info', { xmpYear: 2019 }, infoDetails],
    ['XMP only', { info: false }, xmpDetails],
  ])('preserves %s values and synchronizes the modification date', async (_, options, expected) => {
    const source = await PDFDocument.create();
    addCompressiblePage(source);
    addMetadata(source, options);
    const bytes = await source.save();
    const before = bytes.slice();
    expect(documentDetails(source)).toMatchObject(expected);
    const result = await compressPdf(bytes);
    const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(documentDetails(doc)).toMatchObject(expected);
    expect(doc.getProducer()).toBe('Original PDF writer');
    const { info, metadata } = await readerMetadata(result.bytes);
    expect(info.Title).toBe(expected.title);
    expect(metadata.get('dc:title')).toBe(expected.title);
    expect(metadata.get('dc:creator')).toEqual([expected.author]);
    expect(metadata.get('dc:description')).toBe(expected.subject);
    expect(metadata.get('pdf:keywords')).toBe(expected.keywords);
    expect(new Date(metadata.get('xmp:modifydate')).getTime()).toBe(
      doc.getModificationDate().getTime(),
    );
    expect(xmlOf(doc)).toContain('record-123');
    expect(result.after).toBeLessThan(result.before / 4);
    expect(bytes).toEqual(before);
  });

  it('keeps malformed XMP intact while allowing compression', async () => {
    const source = await PDFDocument.create();
    addCompressiblePage(source);
    const xml = addMetadata(source, { malformed: true });
    const result = await compressPdf(await source.save());
    const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(documentDetails(doc)).toMatchObject(infoDetails);
    expect(doc.getProducer()).toBe('Original PDF writer');
    expect(xmlOf(doc)).toBe(xml);
    expect(result.after).toBeLessThan(result.before / 4);
  });

  it('retains the producer and creation date of an Info-only document', async () => {
    const source = await PDFDocument.create();
    addCompressiblePage(source);
    source.setProducer('Original PDF writer');
    source.setCreationDate(new Date('2010-01-01T00:00:00Z'));
    source.setModificationDate(new Date('2020-01-01T00:00:00Z'));
    const result = await compressPdf(await source.save());
    const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(doc.getProducer()).toBe('Original PDF writer');
    expect(doc.getCreationDate().toISOString()).toBe('2010-01-01T00:00:00.000Z');
    expect(+doc.getModificationDate()).toBeGreaterThan(Date.now() - 60000);
  });
});

describe('metadata on extracted pages', () => {
  it('validates a source without replacing its original metadata timestamps or producer', async () => {
    const source = await PDFDocument.create();
    source.addPage();
    addMetadata(source);
    const loaded = await validatePdf(await source.save());
    expect(loaded.getModificationDate().toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect(loaded.getProducer()).toBe('Original PDF writer');
    expect(documentDetails(loaded)).toMatchObject(xmpDetails);
  });

  it.each([
    ['newer XMP', {}, xmpDetails],
    ['equal timestamps', { xmpYear: 2020 }, xmpDetails],
    ['newer Info', { xmpYear: 2019 }, infoDetails],
    ['XMP only', { info: false }, xmpDetails],
    ['malformed XMP', { malformed: true }, infoDetails],
  ])(
    'carries the authoritative descriptive fields from %s into an extraction',
    async (_, options, expected) => {
      const source = await PDFDocument.create();
      for (let i = 0; i < 3; i++) source.addPage([300 + i, 400]);
      addMetadata(source, options);
      const original = await source.save();
      const extracted = await extractPages(original, [2, 0]);
      const doc = await PDFDocument.load(extracted, { updateMetadata: false });
      expect(documentDetails(doc)).toMatchObject(expected);
      expect(doc.getPages().map((page) => page.getWidth())).toEqual([302, 300]);
      const { info } = await readerMetadata(extracted);
      expect(info).toMatchObject({
        Title: expected.title,
        Author: expected.author,
        Subject: expected.subject,
        Keywords: expected.keywords,
      });
      expect(
        documentDetails(await PDFDocument.load(original, { updateMetadata: false })),
      ).toMatchObject(expected);
    },
  );

  it('does not revive an Info title when the authoritative XMP title was cleared', async () => {
    const source = await PDFDocument.create();
    source.addPage();
    const xml = addMetadata(source).replace('>XMP title<', '><');
    source.catalog.set(
      n('Metadata'),
      source.context.register(source.context.stream(xml, { Type: 'Metadata', Subtype: 'XML' })),
    );
    const doc = await PDFDocument.load(await extractPages(await source.save(), [0]), {
      updateMetadata: false,
    });
    expect(documentDetails(doc).title).toBe('');
  });

  it('reads current metadata for separate copies of a mutable source', async () => {
    const source = await PDFDocument.create();
    source.addPage();
    addMetadata(source);
    const first = await PDFDocument.load(await copyPagesFrom(source, [0]));
    expect(first.getTitle()).toBe('XMP title');
    expect(source.getTitle()).toBe('Info title');
    source.setTitle('Changed later');
    source.setModificationDate(new Date('2022-01-01T00:00:00Z'));
    const second = await PDFDocument.load(await copyPagesFrom(source, [0]));
    expect(second.getTitle()).toBe('Changed later');
  });

  it('reads XMP once for an entire split while giving every part the same details', async () => {
    const source = await PDFDocument.create();
    for (let i = 0; i < 12; i++) source.addPage([300 + i, 400]);
    addMetadata(source);
    const read = vi.spyOn(detailsApi, 'documentDetails');
    try {
      const files = await splitPdf(await source.save(), splitRanges(12));
      expect(read).toHaveBeenCalledTimes(1);
      expect(files).toHaveLength(12);
      for (const file of files) {
        const doc = await PDFDocument.load(file.bytes, { updateMetadata: false });
        expect(documentDetails(doc)).toMatchObject(xmpDetails);
      }
    } finally {
      read.mockRestore();
    }
  });
});
