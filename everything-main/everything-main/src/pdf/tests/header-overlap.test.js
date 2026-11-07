import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { addHeaderFooter } from '../src/core/page-marks.js';
import { embedFont, PdfSession } from '../src/core/document.js';

beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(await readFile(new URL('../public/fonts/NotoSans-Regular.ttf', import.meta.url))),
  );
});
afterEach(() => vi.restoreAllMocks());

for (const edge of ['top', 'bottom'])
  for (const pair of [
    ['Left', 'Center'],
    ['Center', 'Right'],
    ['Left', 'Right'],
  ])
    for (const rotation of [0, 90, 180, 270])
      for (const unit of [0.5, 1, 2])
        it(`rejects overlapping ${edge} ${pair.join('/')} text at rotation ${rotation}, unit ${unit}`, async () => {
          const doc = await PDFDocument.create();
          const page = doc.addPage([300 / unit, 300 / unit]);
          page.setRotation(degrees(rotation));
          page.node.set(PDFName.of('UserUnit'), doc.context.obj(unit));
          const slots = Object.fromEntries(pair.map((side) => [`${edge}${side}`, '{title}']));
          await expect(
            addHeaderFooter(doc, [0], {
              slots,
              title: 'Quarterly report summary',
              size: 12,
            }),
          ).rejects.toThrow('overlap on page 1');
          expect(page.node.Contents()).toBeUndefined();
        });

it('checks every page before drawing and leaves history unchanged until the overlap is corrected', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  doc.addPage([300, 400]);
  const options = {
    slots: { topLeft: '{title}', topCenter: 'Confidential' },
    title: 'Quarterly report summary',
    size: 12,
  };
  await expect(addHeaderFooter(doc, [0, 1], options)).rejects.toThrow('overlap on page 2');
  expect(doc.getPages().map((page) => page.node.Contents())).toEqual([undefined, undefined]);
  const bytes = await doc.save();
  const session = new PdfSession(bytes);
  await expect(session.change((d) => addHeaderFooter(d, [0, 1], options))).rejects.toThrow(
    'overlap on page 2',
  );
  expect(session.bytes).toEqual(bytes);
  expect(session.past).toHaveLength(0);
  await session.change((d) => addHeaderFooter(d, [0, 1], { ...options, size: 6 }));
  expect(session.past).toHaveLength(1);
  session.undo();
  expect(session.bytes).toEqual(bytes);
});

it('allows all six nonoverlapping positions and a wide single-position header', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 400]);
  await addHeaderFooter(doc, [0], {
    slots: {
      topLeft: 'Left',
      topCenter: 'Center',
      topRight: 'Right',
      bottomLeft: 'Left',
      bottomCenter: 'Center',
      bottomRight: 'Right',
    },
  });
  await addHeaderFooter(doc, [0], { slots: { topLeft: 'Quarterly report summary' }, size: 12 });
  expect(doc.getPage(0).node.Contents()).toBeDefined();
});

it('allows adjacent entries whose bounds meet without overlapping', async () => {
  const doc = await PDFDocument.create();
  const label = 'A'.repeat(10);
  const font = await embedFont(doc);
  const width = font.widthOfTextAtSize(label, 12);
  doc.addPage([2 * width + 56, 400]);
  await addHeaderFooter(doc, [0], { slots: { topLeft: label, topRight: label }, size: 12 });
  expect(doc.getPage(0).node.Contents()).toBeDefined();
});

it('detects a header overlapping the footer on a short page while allowing separate columns', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([300, 30]);
  await expect(
    addHeaderFooter(doc, [0], { slots: { topLeft: 'Hg', bottomLeft: 'Hg' }, size: 12 }),
  ).rejects.toThrow('overlap on page 1');
  expect(doc.getPage(0).node.Contents()).toBeUndefined();
  await addHeaderFooter(doc, [0], { slots: { topLeft: 'Hg', bottomRight: 'Hg' }, size: 12 });
  expect(doc.getPage(0).node.Contents()).toBeDefined();
});
