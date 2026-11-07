import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isTextDoc, isPdfDoc, isImageDoc, isReadableDoc, willNeedOcr,
  documentText, readSummary,
} from '../src/lib/doctext.js';

const doc = (name, mime = '') => ({ id: 'd1', name, mime, path: `docs/${name}`, size: 10 });

describe('document kinds', () => {
  it('recognizes text by mime or extension', () => {
    expect(isTextDoc(doc('msa.txt', 'text/plain'))).toBe(true);
    expect(isTextDoc(doc('notes.md'))).toBe(true);
    expect(isTextDoc(doc('scan.pdf', 'application/pdf'))).toBe(false);
  });

  it('recognizes PDFs even when the mime is missing', () => {
    expect(isPdfDoc(doc('agreement.pdf'))).toBe(true);
    expect(isPdfDoc(doc('AGREEMENT.PDF'))).toBe(true);
    expect(isPdfDoc(doc('agreement.docx'))).toBe(false);
  });

  it('recognizes images, including phone photos of a signed page', () => {
    expect(isImageDoc(doc('page1.jpg'))).toBe(true);
    expect(isImageDoc(doc('shot.HEIC'))).toBe(true);
    expect(isImageDoc(doc('anything', 'image/webp'))).toBe(true);
    expect(isImageDoc(doc('msa.txt', 'text/plain'))).toBe(false);
  });

  it('knows what it cannot read', () => {
    expect(isReadableDoc(doc('agreement.pdf'))).toBe(true);
    expect(isReadableDoc(doc('terms.docx'))).toBe(false);
    expect(isReadableDoc(doc('archive.zip', 'application/zip'))).toBe(false);
  });
});

describe('willNeedOcr', () => {
  it('is certain only for images', () => {
    expect(willNeedOcr(doc('scan.jpg'))).toBe(true);
    // A PDF might have a text layer; that is only knowable once it is open.
    expect(willNeedOcr(doc('scan.pdf'))).toBe(false);
    expect(willNeedOcr(doc('msa.txt', 'text/plain'))).toBe(false);
  });
});

describe('documentText', () => {
  const read = (text) => async () => new Blob([text]);

  it('reads a text document directly', async () => {
    const status = [];
    const result = await documentText(doc('msa.txt', 'text/plain'), {
      read: read('The Vendor shall deliver monthly reports.'),
      onStatus: (m) => status.push(m),
    });
    expect(result.method).toBe('text');
    expect(result.text).toContain('monthly reports');
    expect(result.truncated).toBe(false);
    expect(status.length).toBeGreaterThan(0);
  });

  it('clips a very long document and says so', async () => {
    const result = await documentText(doc('msa.txt', 'text/plain'), {
      read: read('x'.repeat(500)),
      maxChars: 100,
    });
    expect(result.text).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it('refuses a file type it cannot turn into text', async () => {
    await expect(documentText(doc('terms.docx'), { read: read('x') }))
      .rejects.toThrow('UNREADABLE_DOC');
  });

  describe('with OCR', () => {
    beforeEach(() => {
      globalThis.puter = { ai: { async img2txt() { return 'SIGNED AGREEMENT read by OCR'; } } };
    });
    afterEach(() => { delete globalThis.puter; });

    it('reads an image through OCR', async () => {
      const result = await documentText(doc('page1.jpg'), { read: read('binary') });
      expect(result.method).toBe('ocr');
      expect(result.text).toContain('read by OCR');
    });

    it('will not OCR when OCR has not been allowed', async () => {
      await expect(documentText(doc('page1.jpg'), { read: read('binary'), allowOcr: false }))
        .rejects.toThrow('OCR_NOT_ALLOWED');
    });

    it('asks before OCR, and stops when the answer is no', async () => {
      const asked = [];
      await expect(documentText(doc('page1.jpg'), {
        read: read('binary'),
        confirmOcr: async (d) => { asked.push(d.name); return false; },
      })).rejects.toThrow('OCR_DECLINED');
      expect(asked).toEqual(['page1.jpg']);
    });

    it('never asks for a text document, which stays in the browser', async () => {
      let asked = false;
      const result = await documentText(doc('msa.txt', 'text/plain'), {
        read: read('Some clauses'),
        confirmOcr: async () => { asked = true; return true; },
      });
      expect(asked).toBe(false);
      expect(result.method).toBe('text');
    });
  });
});

describe('readSummary', () => {
  it('says how the text was read, and warns about OCR', () => {
    expect(readSummary({ method: 'pdf', pages: 8, pagesRead: 8, truncated: false }))
      .toBe('Read 8 pages.');
    expect(readSummary({ method: 'pdf', pages: 60, pagesRead: 12, truncated: true }))
      .toBe('Read 12 of 60 pages; the rest was too long to send.');
    expect(readSummary({ method: 'ocr', pages: 3, pagesRead: 3, truncated: false }))
      .toContain('Check the suggestions carefully');
    expect(readSummary({ method: 'text', truncated: false })).toBe('Read the document.');
    expect(readSummary(null)).toBe('');
  });
});
