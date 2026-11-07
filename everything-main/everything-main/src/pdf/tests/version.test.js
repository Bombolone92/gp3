import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PdfSession, rotatePage, insertPdfPages } from '../src/core/document.js';
import { compressPdf } from '../src/core/compress.js';
import { copyPagesFrom } from '../src/core/pages.js';
import { openedProtection, protectPdf, unlockPdf } from '../src/core/security.js';

const title = 'EFBBBF5064662032207469746C65';
async function fixture(header = '2.0', catalog) {
  const doc = await PDFDocument.create();
  doc.addPage([200, 300]);
  doc.getInfoDict().set(PDFName.of('Title'), PDFHexString.of(title));
  if (catalog) doc.catalog.set(PDFName.of('Version'), PDFName.of(catalog));
  const bytes = await doc.save();
  bytes.set(new TextEncoder().encode(`%PDF-${header}`));
  return bytes;
}
async function expectVersion(bytes, version = '2.0') {
  const doc = await PDFDocument.load(bytes);
  const declared = doc.catalog.lookup(PDFName.of('Version'))?.decodeText();
  const header = `${doc.context.header.major}.${doc.context.header.minor}`;
  expect([header, declared]).toContain(version);
  return doc;
}

describe('PDF version requirements', () => {
  it.each([
    ['2.0', undefined, '2.0'],
    ['1.7', '2.0', '2.0'],
    ['2.0', '1.7', '2.0'],
    ['2.0', '2.1', '2.1'],
    ['1.7', undefined, '1.7'],
  ])(
    'preserves header %s and catalog %s through edits and history',
    async (header, catalog, version) => {
      const bytes = await fixture(header, catalog);
      const session = new PdfSession(bytes);
      await session.change((doc) => rotatePage(doc, 0));
      const saved = await expectVersion(session.bytes, version);
      expect(saved.getPage(0).getRotation().angle).toBe(90);
      expect(saved.getInfoDict().get(PDFName.of('Title')).toString()).toBe(`<${title}>`);
      session.undo();
      expect(session.bytes).toEqual(bytes);
      session.redo();
      await expectVersion(session.bytes, version);
      await session.change((doc) => rotatePage(doc, 0));
      await expectVersion(session.bytes, version);
    },
  );
  it('keeps the version when compressing, extracting, and merging newer pages', async () => {
    const bytes = await fixture();
    await expectVersion((await compressPdf(bytes)).bytes);
    await expectVersion(await copyPagesFrom(await PDFDocument.load(bytes), [0]));
    const target = await PDFDocument.create();
    target.addPage();
    const session = new PdfSession(await target.save());
    await session.change((doc) => insertPdfPages(doc, bytes));
    expect((await expectVersion(session.bytes)).getPageCount()).toBe(2);
  });
  it('keeps the version through protection, unlocking, and re-encryption', async () => {
    const protectedBytes = await protectPdf(await fixture(), {
      open: 'reader',
      permissions: 'owner',
    });
    const raw = await PDFDocument.load(protectedBytes, { ignoreEncryption: true });
    expect(raw.catalog.lookup(PDFName.of('Version'))?.decodeText()).toBe('2.0');
    const opened = await unlockPdf(protectedBytes, 'reader');
    await expectVersion(opened.bytes);
    const session = new PdfSession(opened.bytes);
    await session.change((doc) => rotatePage(doc, 0));
    const saved = await protectPdf(session.bytes, openedProtection(opened, 'reader'));
    await expectVersion((await unlockPdf(saved, 'owner')).bytes);
  });
  it('reports PDF 2.0 and reads the UTF-8 metadata with an independent reader after an edit', async () => {
    const session = new PdfSession(await fixture());
    await session.change((doc) => rotatePage(doc, 0));
    const task = pdfjs.getDocument({ data: session.bytes.slice() });
    try {
      const pdf = await task.promise;
      const { info } = await pdf.getMetadata();
      expect(info.PDFFormatVersion).toBe('2.0');
      expect(info.Title).toBe('Pdf 2 title');
      expect((await pdf.getPage(1)).rotate).toBe(90);
    } finally {
      await task.destroy();
    }
  });
});
