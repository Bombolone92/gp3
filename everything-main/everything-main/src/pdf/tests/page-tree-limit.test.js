import { expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, PDFPageTree } from 'pdf-lib';
import { validatePdf, MAX_PAGES } from '../src/core/document.js';
import { expandingPageTree } from './fixtures/page-tree-expansion.js';
import { protectPdf, unlockPdf } from '../src/core/security.js';

it('decrypts without expanding pages before bounded validation', async () => {
  const encrypted = await protectPdf(await expandingPageTree(14), { open: 'reader' });
  const traverse = vi.spyOn(PDFPageTree.prototype, 'traverse');
  try {
    const opened = await unlockPdf(encrypted, 'reader');
    await expect(validatePdf(opened.bytes)).rejects.toThrow('1,000 pages');
    expect(traverse.mock.calls.length).toBe(0);
  } finally {
    traverse.mockRestore();
  }
});

it('enforces the page limit before expanding a compact shared page tree', async () => {
  const bytes = await expandingPageTree(14);
  expect(bytes.length).toBeLessThan(2000);
  const traverse = vi.spyOn(PDFPageTree.prototype, 'traverse');
  try {
    await expect(validatePdf(bytes)).rejects.toThrow('1,000 pages');
    expect(traverse.mock.calls.length).toBeLessThan(MAX_PAGES);
  } finally {
    traverse.mockRestore();
  }
});

it('retains shared page occurrences that fit the document limit', async () => {
  const bytes = await expandingPageTree(3);
  const doc = await validatePdf(bytes);
  expect(doc.getPageCount()).toBe(8);
  expect(doc.getPages().map((page) => page.getSize())).toEqual(
    Array.from({ length: 8 }, () => ({ width: 200, height: 300 })),
  );
});

it.each([32, 60])('rejects a %i-level expansion without enumerating its pages', async (depth) => {
  const bytes = await expandingPageTree(depth);
  const traverse = vi.spyOn(PDFPageTree.prototype, 'traverse');
  try {
    await expect(validatePdf(bytes)).rejects.toThrow('1,000 pages');
    expect(traverse.mock.calls.length).toBe(0);
  } finally {
    traverse.mockRestore();
  }
});

it.each([
  { depth: 1, cycle: true },
  { depth: 60, empty: true, keepPage: true },
])('bounds malformed page trees even without excess pages: %j', async ({ depth, ...options }) => {
  const bytes = await expandingPageTree(depth, options);
  const traverse = vi.spyOn(PDFPageTree.prototype, 'traverse');
  try {
    await expect(validatePdf(bytes)).rejects.toThrow('damaged or unsupported');
    expect(traverse.mock.calls.length).toBe(0);
  } finally {
    traverse.mockRestore();
  }
});

it('keeps a modest shared empty subtree with a usable page', async () => {
  const doc = await validatePdf(await expandingPageTree(3, { empty: true, keepPage: true }));
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getPage(0).getSize()).toEqual({ width: 200, height: 300 });
});

it.each([0, 1, 999999])('counts actual pages when the declared count is %i', async (declared) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < MAX_PAGES; i++) doc.addPage([200 + i, 300]);
  doc.catalog.Pages().set(PDFName.of('Count'), PDFNumber.of(declared));
  const bytes = await doc.save();
  const validated = await validatePdf(bytes);
  expect(validated.getPageCount()).toBe(MAX_PAGES);
  expect(validated.getPage(0).getWidth()).toBe(200);
  expect(validated.getPage(MAX_PAGES - 1).getWidth()).toBe(200 + MAX_PAGES - 1);
});
