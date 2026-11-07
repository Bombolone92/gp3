import { expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cryptObjectStream } from './fixtures/crypt-object-stream.js';
import { openedProtection, protectPdf, unlockPdf } from '../src/core/security.js';

const variants = [
  ['Identity', {}],
  ['implicit Identity', { parameters: 'unnamed' }],
  ['Identity without parameters', { parameters: 'missing' }],
  ['Identity filter array', { array: true }],
  ['compressed Identity', { compressed: true }],
  ['indirect compressed Identity', { compressed: true, indirect: true }],
  [
    'Identity with chained Flate and LZW parameters',
    { compressed: true, lzw: true, indirect: true, title: 'Report ' + 'x'.repeat(1000) },
  ],
  ['AES-256 Crypt', { crypt: 'StdCF' }],
  ['compressed AES-256 Crypt', { crypt: 'StdCF', compressed: true, indirect: true }],
  ['compressed AES-128 Crypt', { crypt: 'StdCF', compressed: true, legacy: true }],
  ['ordinary compressed AES-256', { crypt: null, compressed: true }],
];
async function independent(bytes, password) {
  const task = pdfjs.getDocument({ data: bytes.slice(), password });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    return {
      title: (await doc.getMetadata()).info.Title,
      pages: doc.numPages,
      size: page.view.slice(2),
    };
  } finally {
    await task.destroy();
  }
}
for (const [label, options] of variants)
  it(`preserves objects in ${label} streams on opening and protected export`, async () => {
    const { bytes, title, password } = await cryptObjectStream(options);
    expect(await independent(bytes, password)).toEqual({ title, pages: 2, size: [510, 710] });
    const original = bytes.slice();
    const opened = await unlockPdf(bytes, password);
    const doc = await PDFDocument.load(opened.bytes);
    expect(doc.getTitle()).toBe(title);
    expect(doc.getAuthor()).toBe('Ada');
    expect(doc.getPage(0).getSize()).toEqual({ width: 510, height: 710 });
    expect(await independent(opened.bytes)).toEqual({ title, pages: 2, size: [510, 710] });
    expect(bytes).toEqual(original);
    const saved = await protectPdf(opened.bytes, openedProtection(opened, password));
    expect(await independent(saved, password)).toEqual({ title, pages: 2, size: [510, 710] });
  });

it('leaves large Identity object streams out of the native decryption path', async () => {
  const { bytes, title } = await cryptObjectStream({ title: 'x'.repeat(100000) });
  const native = vi.spyOn(crypto.subtle, 'decrypt');
  try {
    const opened = await unlockPdf(bytes, 'reader');
    expect(native.mock.calls.length).toBe(0);
    const actual = (await PDFDocument.load(opened.bytes)).getTitle();
    expect(actual?.length).toBe(title.length);
    expect(actual).toBe(title);
  } finally {
    native.mockRestore();
  }
});

it('decodes a large explicitly encrypted Crypt object stream after native decryption', async () => {
  const { bytes, title } = await cryptObjectStream({ crypt: 'StdCF', title: 'x'.repeat(100000) });
  const native = vi.spyOn(crypto.subtle, 'decrypt');
  try {
    const opened = await unlockPdf(bytes, 'reader');
    expect(native.mock.calls.length).toBe(1);
    const actual = (await PDFDocument.load(opened.bytes)).getTitle();
    expect(actual?.length).toBe(title.length);
    expect(actual).toBe(title);
  } finally {
    native.mockRestore();
  }
});
