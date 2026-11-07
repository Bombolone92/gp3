import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addNote, listNotes, parsePdfDate } from '../src/core/notes.js';
import { collectComments } from '../src/core/comments.js';

describe('PDF comment dates', () => {
  for (const [input, expected] of [
    ['D:2026', '2026-01-01T00:00:00.000Z'],
    ['D:202609', '2026-09-01T00:00:00.000Z'],
    ['D:20260914', '2026-09-14T00:00:00.000Z'],
    ['D:2026091412', '2026-09-14T12:00:00.000Z'],
    ['D:202609141234', '2026-09-14T12:34:00.000Z'],
    ['D:20260914123456', '2026-09-14T12:34:56.000Z'],
    ['D:20240229123456Z', '2024-02-29T12:34:56.000Z'],
    ['D:20000229123456Z', '2000-02-29T12:34:56.000Z'],
    ['D:00990101000000Z', '0099-01-01T00:00:00.000Z'],
    ['D:00000229000000Z', '0000-02-29T00:00:00.000Z'],
    ["D:20260101003000+01'00'", '2025-12-31T23:30:00.000Z'],
    ["D:20261231233000-01'00", '2027-01-01T00:30:00.000Z'],
    ['D:20260914120000+0530', '2026-09-14T06:30:00.000Z'],
    [' D:20260914120000z ', '2026-09-14T12:00:00.000Z'],
  ]) {
    it(`reads ${input} without changing its calendar fields`, () => {
      expect(parsePdfDate(input)?.toISOString()).toBe(expected);
    });
  }
  for (const input of [
    'D:20260230120000Z',
    'D:20260229120000Z',
    'D:19000229120000Z',
    'D:20260431120000Z',
    'D:20261301120000Z',
    'D:20260001120000Z',
    'D:20260100120000Z',
    'D:20260132120000Z',
    'D:20260914240000Z',
    'D:20260914126000Z',
    'D:20260914120060Z',
    "D:20260914120000+24'00'",
    "D:20260914120000-01'60'",
    'D:20260914120000garbage',
    'D:20261',
    'D:202609141200001',
    '',
    null,
  ]) {
    it(`does not invent a date from ${JSON.stringify(input)}`, () => {
      expect(parsePdfDate(input)).toBeNull();
    });
  }
  it('uses a valid creation date for the comment list when its modification date is invalid', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    addNote(doc, 0, { x: 50, y: 300, text: 'Check this date', author: 'Ada' });
    const note = doc.context.lookup(page.node.Annots().get(0));
    note.set(PDFName.of('M'), PDFString.of('D:20260230120000Z'));
    note.set(PDFName.of('CreationDate'), PDFString.of('D:20260101120000Z'));
    expect(listNotes(doc, 0)[0].modified).toBeNull();
    const task = pdfjs.getDocument({ data: await doc.save() });
    try {
      const comments = await collectComments(await task.promise);
      expect(comments[0].date?.toISOString()).toBe('2026-01-01T12:00:00.000Z');
    } finally {
      await task.destroy();
    }
  });
});
