import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { addWatermark } from '../src/core/page-marks.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

for (const label of ['Åg', 'g'])
  for (const layout of ['horizontal', 'diagonal'])
    for (const rotation of [0, 90, 180, 270])
      for (const unit of [1, 10])
        it(`keeps ${label} ink inside the page (${layout}, rotation ${rotation}, unit ${unit})`, async () => {
          const doc = await PDFDocument.create();
          const sideways = rotation % 180 !== 0;
          const width = (sideways ? 20 : 300) / unit,
            height = (sideways ? 300 : 20) / unit;
          const sheet = doc.addPage([width + 40 / unit, height + 40 / unit]);
          sheet.setCropBox(20 / unit, 20 / unit, width, height);
          sheet.setRotation(degrees(rotation));
          sheet.node.set(PDFName.of('UserUnit'), doc.context.obj(unit));
          await addWatermark(doc, [0], { text: label, layout, opacity: 1 });
          const task = pdfjs.getDocument({ data: await doc.save() });
          try {
            const page = await (await task.promise).getPage(1),
              viewport = page.getViewport({ scale: 4 });
            const canvas = createCanvas(viewport.width, viewport.height),
              ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let minY = canvas.height,
              maxY = -1;
            for (let y = 0; y < canvas.height; y++)
              for (let x = 0; x < canvas.width; x++)
                if (pixels[(y * canvas.width + x) * 4] < 200) {
                  minY = Math.min(minY, y);
                  maxY = Math.max(maxY, y);
                }
            expect(maxY).toBeGreaterThan(minY);
            expect(minY).toBeGreaterThan(0);
            expect(maxY).toBeLessThan(canvas.height - 1);
            if (layout === 'horizontal')
              expect(Math.abs(minY - (canvas.height - 1 - maxY))).toBeLessThanOrEqual(2);
          } finally {
            await task.destroy();
          }
        });
