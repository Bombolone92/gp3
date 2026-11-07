import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addHeaderFooter, addWatermark, addPageNumbers } from '../src/core/page-marks.js';
import { removePageMarks, stripPaginationArtifacts } from '../src/core/page-mark-removal.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

async function texts(bytes) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++)
    out.push((await (await pdf.getPage(i)).getTextContent()).items.map((t) => t.str).join(' '));
  await task.destroy();
  return out;
}

it('removes headers, footers, and watermarks and keeps the page content', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++)
    doc.addPage([400, 400]).drawText(`Body ${i + 1}`, { x: 50, y: 200, size: 14, font });
  await addHeaderFooter(doc, [0, 1], { slots: { topLeft: 'Report', bottomRight: 'Footer text' } });
  await addWatermark(doc, [0, 1], { text: 'DRAFT' });
  await addPageNumbers(doc, [0, 1], {});
  let reopened = await PDFDocument.load(await doc.save());
  expect(removePageMarks(reopened, [0], ['Watermark'])).toBe(1);
  let after = await texts(await reopened.save());
  expect(after[0]).not.toContain('DRAFT');
  expect(after[0]).toContain('Report');
  expect(after[1]).toContain('DRAFT');
  reopened = await PDFDocument.load(await reopened.save());
  expect(removePageMarks(reopened)).toBe(7);
  after = await texts(await reopened.save());
  expect(after.map((t) => t.trim())).toEqual(['Body 1', 'Body 2']);
});

it('leaves unbalanced or other marked content alone', () => {
  const source =
    '/Artifact <</Type /Layout>> BDC (x) Tj EMC /Artifact <</Type /Pagination /Subtype /Header>> BDC (y) Tj';
  expect(stripPaginationArtifacts(source)).toEqual({ source, removed: 0 });
});
