import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addWatermark } from '../src/core/page-marks.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

async function measure({
  layout = 'diagonal',
  rotation = 0,
  unit = 1,
  size = 'medium',
  label = 'W'.repeat(200),
} = {}) {
  const doc = await PDFDocument.create();
  const sheet = doc.addPage([300 / unit, 340 / unit]);
  sheet.setCropBox(50 / unit, 50 / unit, 200 / unit, 240 / unit);
  sheet.setRotation(degrees(rotation));
  sheet.node.set(PDFName.of('UserUnit'), doc.context.obj(unit));
  await addWatermark(doc, [0], { text: label, layout, size, opacity: 1 });
  const task = pdfjs.getDocument({ data: await doc.save() });
  try {
    const page = await (await task.promise).getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const items = (await page.getTextContent()).items.filter((item) => item.str);
    expect(items.map((item) => item.str).join('')).toBe(label);
    for (const item of items) {
      const [a, b, , , x, y] = item.transform;
      const scale = Math.hypot(a, b);
      const w = item.width,
        h = item.height * 0.714;
      for (const [u, v] of [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h],
      ]) {
        const [px, py] = viewport.convertToViewportPoint(
          x + (u * a - v * b) / scale,
          y + (u * b + v * a) / scale,
        );
        expect(px).toBeGreaterThanOrEqual(0);
        expect(px).toBeLessThanOrEqual(viewport.width);
        expect(py).toBeGreaterThanOrEqual(0);
        expect(py).toBeLessThanOrEqual(viewport.height);
      }
    }
    return items[0].height * unit;
  } finally {
    await task.destroy();
  }
}

for (const layout of ['horizontal', 'diagonal'])
  for (const rotation of [0, 90, 180, 270])
    for (const unit of [1, 10])
      it(`fits every character of a long watermark (${layout}, rotation=${rotation}, unit=${unit})`, async () => {
        await measure({ layout, rotation, unit });
      });

for (const layout of ['horizontal', 'diagonal'])
  it(`keeps the small, medium, and large watermark settings distinct for long text (${layout})`, async () => {
    const sizes = [];
    for (const size of ['small', 'medium', 'large']) sizes.push(await measure({ layout, size }));
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[1]).toBeLessThan(sizes[2]);
  });

it('keeps the same physical watermark size when a PDF changes its user-space unit', async () => {
  const ordinary = await measure({ label: 'CONFIDENTIAL' });
  const scaled = await measure({ label: 'CONFIDENTIAL', unit: 10 });
  expect(scaled).toBeCloseTo(ordinary, 5);
});
