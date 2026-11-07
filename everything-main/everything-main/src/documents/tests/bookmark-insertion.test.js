import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = readFileSync('public/fixtures/bookmark-insertion.docx');
const reference = JSON.parse(readFileSync('tests/fixtures/bookmark-insertion/native-ranges.json', 'utf8'));
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const ranges = d => Object.fromEntries(d.bookmarks.map(b => [b.name, { start: b.start, end: b.end, text: d.text.slice(b.start, b.end) }]));
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());

it('reads precise cell, row and point markers from the independently authored native reference probe', async () => {
  expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
  expect(ranges(model(await DocxPackage.open(source)))).toEqual(reference.cases.original.bookmarks);
});

for (const mode of ['append-row', 'middle-row', 'append-column', 'middle-column']) {
  it(`matches the native reference serialized bookmark positions after ${mode}, reopen and undo`, async () => {
    const p = await DocxPackage.open(source), d = model(p);
    const oldCells = new Set(d.tables[0].rows.flatMap(row => row.cells.map(cell => cell.id)));
    const rowEdit = mode.endsWith('row');
    const label = rowEdit ? mode.startsWith('append') ? 'A2' : 'A1' : mode.startsWith('append') ? 'B1' : 'A1';
    d.select(d.text.indexOf(label));
    if (rowEdit) d.insertTableRow(); else d.insertTableColumn();
    const inserted = d.tables[0].rows.flatMap(row => row.cells.filter(cell => !oldCells.has(cell.id)));
    expect(inserted).toHaveLength(2);
    for (const [index, text] of (rowEdit ? ['New L', 'New R'] : ['New top', 'New bottom']).entries()) {
      d.selectCell(inserted[index].id); d.replace(text);
    }
    expect(d.text + '\n').toBe(reference.cases[mode].text);
    expect(ranges(d)).toEqual(reference.cases[mode].bookmarks);
    const bytes = await save(p, d), reopened = model(await DocxPackage.open(bytes));
    expect(ranges(reopened)).toEqual(reference.cases[mode].bookmarks);
    expect(reopened.text).toBe(d.text);
    for (const [name, data] of Object.entries(unzipSync(source))) {
      if (name !== 'word/document.xml') expect(Buffer.from(unzipSync(bytes)[name]).equals(Buffer.from(data)), name).toBe(true);
    }
    d.undo(); d.undo(); d.undo();
    expect(ranges(d)).toEqual(reference.cases.original.bookmarks);
    const restored = unzipSync(await save(p, d));
    for (const [name, data] of Object.entries(unzipSync(source))) expect(Buffer.from(restored[name]).equals(Buffer.from(data)), name).toBe(true);
    d.redo(); d.redo(); d.redo();
    expect(ranges(d)).toEqual(reference.cases[mode].bookmarks);
  });
}
