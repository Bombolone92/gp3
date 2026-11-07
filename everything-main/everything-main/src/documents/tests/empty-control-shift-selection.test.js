import { beforeAll, afterAll, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
async function source() {
  const p = await DocxPackage.open(readFileSync('tests/fixtures/empty-control-home-end/control.docx'));
  return new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
}
it('rejects stale, nonboundary and invalid directional selections atomically', async () => {
  const d = await source(), id = contentControlRanges(d.paragraphs)[0].control.id, before = d.snapshot();
  for (const [anchor, meta] of [[1, { id: 'missing', direction: 1 }], [0, { id, direction: 1 }], [1, { id, direction: 0 }]]) {
    expect(() => d.select(anchor, 2, undefined, meta)).toThrow('Invalid inline content-control selection');
    expect(d.snapshot()).toEqual(before);
  }
});
it('typing and undo preserve the zero-length selection boundary without leaking it into the resulting caret', async () => {
  const d = await source(), id = contentControlRanges(d.paragraphs)[0].control.id;
  d.select(1, 1, { id, side: 'inside' }, { id, direction: 1 });
  const before = d.snapshot(); d.replace('x');
  expect(d.text).toBe('AxD');
  expect(d.selection.controlSelection).toBeUndefined();
  d.undo(); expect(d.snapshot()).toEqual(before);
  d.redo(); expect(d.text).toBe('AxD');
  expect(d.selection.controlSelection).toBeUndefined();
});
for (const [fixture, flag] of [['macro-buttons/editing.docx', 'hasMacroButtons'], ['inactive-note-marks/control.docx', 'hasNoteMarks']]) it(`preserves a control boundary when unrelated atomic fields exist: ${flag}`, async () => {
  const initial = await source(), extra = await DocxPackage.open(readFileSync('tests/fixtures/' + fixture));
  const d = new TextDocument([...initial.paragraphs, ...extra.paragraphs.filter(p => !p.cellId)], initial.pageSettings, initial.numbering, initial.styles, [], initial.assets);
  expect(d[flag]).toBe(true);
  const id = contentControlRanges(d.paragraphs)[0].control.id;
  d.select(1, 1, { id, side: 'inside' }, { id, direction: 1 });
  expect(d.selection.controlSelection).toEqual({ id, direction: 1 });
  const original = d.snapshot(); d.replace('x'); d.undo(); expect(d.snapshot()).toEqual(original);
});
