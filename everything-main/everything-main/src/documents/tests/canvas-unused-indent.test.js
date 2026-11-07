import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, caretRect } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/unused-continuation-indent.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const measure = (text, style) => ({ width: text.length * style.fontSize * .6, ascent: style.fontSize, descent: style.fontSize / 3 });
const layout = d => layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
it('lays out empty, short and space-only first lines without testing a nonexistent continuation', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), result = layout(doc);
  expect(result.pageCount).toBe(1);
  for (const row of doc.tables[0].rows) {
    const cell = row.cells[1], lines = result.lines.filter(l => l.cellId === cell.id);
    expect(lines).toHaveLength(1);
    expect(lines[0].height).toBeGreaterThan(0);
    const box = result.cells.find(c => c.id === cell.id);
    expect(lines[0].stops[0].x).toBeCloseTo(box.x + .5 * 4 / 3);
    expect(caretRect(result, lines[0].start).height).toBeGreaterThan(0);
  }
  const body = doc.paragraphs.find(p => p.runs.map(r => r.text).join('') === 'Body first line only');
  expect(result.lines.filter(l => l.paragraphId === body.id)).toHaveLength(1);
  expect(result.lines.find(l => l.paragraphId === body.id).stops[0].x).toBe(96);
  expect(unzipSync(await save(pkg, doc))).toEqual(pkg.parts);
});
it('preserves the unused indent through text edits, reopen and exact undo', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  const original = layout(doc);
  doc.select(doc.text.indexOf('Body first line only')); doc.replace('Edited ');
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(reopened.text).toBe(doc.text); expect(layout(reopened).pageCount).toBe(1);
  const parts = unzipSync(bytes);
  for (const [name, data] of Object.entries(pkg.parts)) if (name !== 'word/document.xml') expect(parts[name]).toEqual(data);
  doc.undo(); expect(layout(doc)).toEqual(original); expect(unzipSync(await save(pkg, doc))).toEqual(pkg.parts);
});
it.each(['A\vB', 'A long sentence that must wrap'])('retains exhausted cell continuations without rejecting the document: %s', async value => {
  const doc = model(await DocxPackage.open(source));
  const cell = doc.tables[0].rows[0].cells[1];
  const index = doc.paragraphs.findIndex(p => p.cellId === cell.id);
  doc.select(doc.paragraphOffset(index)); doc.replace(value);
  const lines = layout(doc).lines.filter(l => l.cellId === cell.id);
  expect(lines.length).toBeGreaterThan(1);
  expect(lines.slice(1).every(l => l.end - l.start <= 1)).toBe(true);
});
it('keeps an empty first line whose indent exhausts its cell', async () => {
  const doc = model(await DocxPackage.open(source));
  const cell = doc.tables[0].rows[0].cells[1];
  const index = doc.paragraphs.findIndex(p => p.cellId === cell.id);
  doc.select(doc.paragraphOffset(index)); doc.setParagraphFormat({ firstLine: 0 });
  expect(layout(doc).lines.filter(l => l.cellId === cell.id)).toHaveLength(1);
});
