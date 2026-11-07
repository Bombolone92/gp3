import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { addHeaderFooter, addWatermark } from '../src/core/page-marks.js';
import { embedFont } from '../src/core/document.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

for (const text of ['\u0301', 'j'])
  for (const layout of ['horizontal', 'diagonal'])
    for (const rotation of [0, 90, 180, 270])
      for (const unit of [1, 10])
        it(`keeps overhanging ${JSON.stringify(text)} visible (${layout}, rotation ${rotation}, unit ${unit})`, async () => {
          const doc = await PDFDocument.create();
          const sideways = rotation % 180 !== 0;
          const width = (sideways ? 300 : 20) / unit,
            height = (sideways ? 20 : 300) / unit;
          const sheet = doc.addPage([width + 40 / unit, height + 40 / unit]);
          sheet.setCropBox(20 / unit, 20 / unit, width, height);
          sheet.setRotation(degrees(rotation));
          sheet.node.set(PDFName.of('UserUnit'), doc.context.obj(unit));
          await addWatermark(doc, [0], { text, layout, opacity: 1, size: 'large' });
          const task = pdfjs.getDocument({ data: await doc.save() });
          try {
            const page = await (await task.promise).getPage(1),
              viewport = page.getViewport({ scale: 4 });
            const canvas = createCanvas(viewport.width, viewport.height),
              ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let minX = canvas.width,
              maxX = -1;
            for (let y = 0; y < canvas.height; y++)
              for (let x = 0; x < canvas.width; x++)
                if (pixels[(y * canvas.width + x) * 4] < 200) {
                  minX = Math.min(minX, x);
                  maxX = Math.max(maxX, x);
                }
            expect(maxX).toBeGreaterThan(minX);
            expect(minX).toBeGreaterThan(0);
            expect(maxX).toBeLessThan(canvas.width - 1);
          } finally {
            await task.destroy();
          }
        });

for (const vertical of ['top', 'bottom'])
  for (const [alignment, text] of [
    ['Left', 'Final proof'],
    ['Right', 'january review'],
    ['Center', 'jazz proof'],
  ])
    for (const rotation of [0, 90, 180, 270])
      for (const unit of [1, 10])
        it(`rejects clipped glyph ink in ${vertical}${alignment}, rotation ${rotation}, unit ${unit}`, async () => {
          const doc = await PDFDocument.create(),
            font = await embedFont(doc);
          const width =
              (font.widthOfTextAtSize(text, 36) + (alignment === 'Center' ? 0 : 28)) / unit,
            height = 300 / unit;
          const page = doc.addPage(rotation % 180 ? [height, width] : [width, height]);
          page.setRotation(degrees(rotation));
          page.node.set(PDFName.of('UserUnit'), doc.context.obj(unit));
          await expect(
            addHeaderFooter(doc, [0], { slots: { [`${vertical}${alignment}`]: text }, size: 36 }),
          ).rejects.toThrow('too wide');
          expect(page.node.Contents()).toBeUndefined();
        });

it('rejects a clipped final f and renders it fully after reducing the size', async () => {
  const doc = await PDFDocument.create(),
    font = await embedFont(doc),
    text = 'Final proof';
  doc.addPage([font.widthOfTextAtSize(text, 36) + 28, 300]);
  await expect(addHeaderFooter(doc, [0], { slots: { topLeft: text }, size: 36 })).rejects.toThrow(
    'too wide',
  );
  await addHeaderFooter(doc, [0], { slots: { topLeft: text }, size: 35 });
  const task = pdfjs.getDocument({ data: await doc.save() });
  try {
    const page = await (await task.promise).getPage(1),
      viewport = page.getViewport({ scale: 3 });
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height)),
      ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const data = ctx.getImageData(canvas.width - 1, 0, 1, canvas.height).data;
    expect([...data].some((channel, i) => i % 4 !== 3 && channel < 200)).toBe(false);
  } finally {
    await task.destroy();
  }
});

it('checks a later page before adding any overhanging header content', async () => {
  const doc = await PDFDocument.create(),
    font = await embedFont(doc),
    text = 'Final proof';
  doc.addPage([500, 300]);
  doc.addPage([font.widthOfTextAtSize(text, 36) + 28, 300]);
  await expect(
    addHeaderFooter(doc, [0, 1], { slots: { topLeft: text }, size: 36 }),
  ).rejects.toThrow('too wide for page 2');
  expect(doc.getPages().map((page) => page.node.Contents())).toEqual([undefined, undefined]);
});
