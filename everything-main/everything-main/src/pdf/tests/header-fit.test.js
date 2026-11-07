import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import {
  addHeaderFooter,
  addPageNumbers,
  HEADER_SLOTS,
  NUMBER_POSITIONS,
} from '../src/core/page-marks.js';
import { embedFont, PdfSession } from '../src/core/document.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

for (const rotation of [0, 90, 180, 270])
  for (const unit of [1, 10])
    for (const kind of ['header', 'number'])
      it(`rejects running text that would leave the crop box (${kind}, rotation=${rotation}, unit=${unit})`, async () => {
        const doc = await PDFDocument.create();
        const page = doc.addPage([300 / unit, 300 / unit]);
        page.setCropBox(50 / unit, 50 / unit, 150 / unit, 200 / unit);
        page.setRotation(degrees(rotation));
        page.node.set(PDFName.of('UserUnit'), doc.context.obj(unit));
        await expect(
          kind === 'header'
            ? addHeaderFooter(doc, [0], {
                slots: { topLeft: '{title}' },
                title: 'Quarterly report '.repeat(10).trim(),
              })
            : addPageNumbers(doc, [0], { size: 72, start: 99999 }),
        ).rejects.toThrow(/too wide for page 1/);
        expect(page.node.Contents()).toBeUndefined();
      });

for (const slot of HEADER_SLOTS)
  it(`checks expanded text in the ${slot} slot`, async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 300]);
    await expect(
      addHeaderFooter(doc, [0], {
        slots: { [slot]: '{file}' },
        file: 'Long file name '.repeat(15),
      }),
    ).rejects.toThrow(/too wide for page 1/);
  });

for (const position of NUMBER_POSITIONS)
  it(`checks the ${position} page-number alignment`, async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 300]);
    await expect(addPageNumbers(doc, [0], { position, size: 72, start: 99999 })).rejects.toThrow(
      /too wide for page 1/,
    );
  });

for (const kind of ['header', 'number'])
  it(`preflights every page before adding ${kind} content`, async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([60, 100]);
    await expect(
      kind === 'header'
        ? addHeaderFooter(doc, [0, 1], { slots: { topLeft: 'Quarterly report' } })
        : addPageNumbers(doc, [0, 1], { size: 20 }),
    ).rejects.toThrow(/too wide for page 2/);
    expect(doc.getPages().map((page) => page.node.Contents())).toEqual([undefined, undefined]);
  });

it('keeps the document and history unchanged after a rejected header and accepts a smaller size', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const source = await doc.save();
  const session = new PdfSession(source);
  const options = { slots: { topLeft: '{title}' }, title: 'Quarterly report '.repeat(10).trim() };
  await expect(session.change((doc) => addHeaderFooter(doc, [0], options))).rejects.toThrow(
    'too wide',
  );
  expect(session.bytes).toEqual(source);
  expect(session.past).toHaveLength(0);
  await session.change((doc) => addHeaderFooter(doc, [0], { ...options, size: 6 }));
  expect(session.past).toHaveLength(1);
  expect(session.undo()).toBe(true);
  expect(session.bytes).toEqual(source);
});

for (const slot of ['topLeft', 'topCenter', 'topRight'])
  it(`keeps a fitting ${slot} header at its requested size, including the page boundary`, async () => {
    const doc = await PDFDocument.create();
    const text = 'A'.repeat(20),
      size = 10;
    const font = await embedFont(doc);
    const width = font.widthOfTextAtSize(text, size);
    const page = doc.addPage([width + (slot === 'topCenter' ? 0 : 28), 600]);
    await addHeaderFooter(doc, [0], { slots: { [slot]: text }, size });
    expect(page.node.Contents()).toBeDefined();
  });
