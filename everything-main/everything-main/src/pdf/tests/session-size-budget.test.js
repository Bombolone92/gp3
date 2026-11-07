import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { blankPdf, duplicatePage, MAX_FILE_SIZE, PdfSession } from '../src/core/document.js';

let original;
beforeAll(async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 400]);
  // Whitespace is legal empty PDF content. Its uncompressed stream is copied by
  // the ordinary page-duplication command, without needing a large bitmap fixture.
  const content = new Uint8Array(60 * 1024 * 1024).fill(32);
  page.node.addContentStream(doc.context.register(doc.context.stream(content)));
  original = await doc.save();
  expect(original.length).toBeLessThan(MAX_FILE_SIZE);
});
afterEach(() => vi.restoreAllMocks());

it('rejects oversized duplicated page streams before serialization and preserves the session', async () => {
  const session = new PdfSession(original);
  const bytes = session.bytes;
  const save = vi.spyOn(PDFDocument.prototype, 'save').mockImplementation(async () => {
    throw new Error('Oversized edit reached serialization');
  });
  await expect(session.change((doc) => duplicatePage(doc, 0))).rejects.toThrow(
    'This edit would exceed the 100 MB PDF limit.',
  );
  expect(save).not.toHaveBeenCalled();
  expect(session.bytes).toBe(bytes);
  expect(session.past).toEqual([]);
  expect(session.future).toEqual([]);
  expect(session.revision).toBe(0);
  expect(session.dirty).toBe(false);
});

it('counts encoded stream bytes so highly compressible content still fits', async () => {
  const session = new PdfSession(await blankPdf());
  const content = new Uint8Array(110 * 1024 * 1024).fill(32);
  expect(content.length).toBeGreaterThan(MAX_FILE_SIZE);
  await session.change((doc) => {
    const stream = doc.context.flateStream(content);
    doc.getPage(0).node.addContentStream(doc.context.register(stream));
  });
  expect(session.bytes.length).toBeLessThan(1024 * 1024);
  const saved = await PDFDocument.load(session.bytes);
  const streams = saved.getPage(0).node.Contents().asArray();
  const added = saved.context.lookup(streams.at(-1));
  expect(added.dict.lookup(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
  expect(session.past).toHaveLength(1);
  expect(session.dirty).toBe(true);
});

it('quietly retires an oversized stale candidate before serialization', async () => {
  const session = new PdfSession(original);
  const bytes = session.bytes;
  const save = vi.spyOn(PDFDocument.prototype, 'save');
  expect(await session.change((doc) => duplicatePage(doc, 0), { canCommit: () => false })).toBe(
    false,
  );
  expect(save).not.toHaveBeenCalled();
  expect(session.bytes).toBe(bytes);
  expect(session.past).toEqual([]);
  expect(session.dirty).toBe(false);
});
