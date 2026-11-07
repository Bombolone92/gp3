import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { addHeaderFooter, addPageNumbers } from '../src/core/page-marks.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

const add = (doc, indices, kind, edge, size) =>
  kind === 'header'
    ? addHeaderFooter(doc, indices, {
        slots: { [edge === 'top' ? 'topCenter' : 'bottomCenter']: 'Åg' },
        size,
      })
    : addPageNumbers(doc, indices, { format: 'plain', position: `${edge}-center`, size });

for (const kind of ['header', 'number'])
  for (const edge of ['top', 'bottom'])
    for (const rotation of [0, 90, 180, 270])
      for (const unit of [1, 10])
        it(`rejects vertically clipped ${kind} at ${edge}, rotation ${rotation}, unit ${unit}`, async () => {
          const doc = await PDFDocument.create();
          const sideways = rotation % 180 !== 0;
          const width = (sideways ? 30 : 300) / unit,
            height = (sideways ? 300 : 30) / unit;
          const page = doc.addPage([width + 40 / unit, height + 40 / unit]);
          page.setCropBox(20 / unit, 20 / unit, width, height);
          page.setRotation(degrees(rotation));
          page.node.set(PDFName.of('UserUnit'), doc.context.obj(unit));
          await expect(add(doc, [0], kind, edge, kind === 'header' ? 36 : 72)).rejects.toThrow(
            /too tall for page 1/,
          );
          expect(page.node.Contents()).toBeUndefined();
        });

for (const kind of ['header', 'number'])
  it(`preflights later short pages before drawing ${kind}`, async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    doc.addPage([300, 30]);
    await expect(add(doc, [0, 1], kind, 'bottom', kind === 'header' ? 36 : 72)).rejects.toThrow(
      /too tall for page 2/,
    );
    expect(doc.getPages().map((page) => page.node.Contents())).toEqual([undefined, undefined]);
  });

for (const kind of ['header', 'number'])
  for (const edge of ['top', 'bottom'])
    it(`a corrected ${kind} at ${edge} has visible ink clear of both page edges`, async () => {
      const doc = await PDFDocument.create();
      doc.addPage([300, 30]);
      await expect(add(doc, [0], kind, edge, kind === 'header' ? 36 : 72)).rejects.toThrow(
        'too tall',
      );
      await add(doc, [0], kind, edge, 6);
      const task = pdfjs.getDocument({ data: await doc.save() });
      try {
        const page = await (await task.promise).getPage(1),
          viewport = page.getViewport({ scale: 4 });
        const canvas = createCanvas(viewport.width, viewport.height),
          ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        const dark = (data) =>
          [...data].filter((value, index) => index % 4 !== 3 && value < 200).length;
        expect(dark(ctx.getImageData(0, 0, canvas.width, canvas.height).data)).toBeGreaterThan(0);
        expect(dark(ctx.getImageData(0, 0, canvas.width, 1).data)).toBe(0);
        expect(dark(ctx.getImageData(0, canvas.height - 1, canvas.width, 1).data)).toBe(0);
      } finally {
        await task.destroy();
      }
    });

for (const [text, height] of [
  ['Å', 40],
  ['g', 24],
])
  it(`accounts for the actual ink of ${text}, beyond a capital-height estimate`, async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, height]);
    await expect(
      addHeaderFooter(doc, [0], { slots: { bottomCenter: text }, size: 36 }),
    ).rejects.toThrow('too tall');
  });

it('accepts ink that fits even when the overall font ascender and descender would not', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 40]);
  await addHeaderFooter(doc, [0], { slots: { bottomCenter: 'A' }, size: 36 });
  expect(doc.getPage(0).node.Contents()).toBeDefined();
});
