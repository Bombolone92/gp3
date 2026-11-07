import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
const folder = 'tests/fixtures/column-bookmarks/';
const hash = b => createHash('sha256').update(b).digest('hex');
const text = p => p.runs.map(r => r.text).join('');
const tokens = value => value.match(/R\dC\d|Inner[AB]/g) || [];
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());

it.each(['limits', 'geometry'])('matches independently recorded native reference %s column selections', async kind => {
  const source = readFileSync(folder + kind + '-control.docx');
  const native = JSON.parse(readFileSync(folder + kind + '-native-ranges.json', 'utf8').replace(/^\uFEFF/, ''));
  expect(hash(source)).toBe(native.sourceSha256);
  expect(hash(readFileSync(folder + kind + '-native.pdf'))).toBe(native.pdfSha256);
  const p = await DocxPackage.open(source), d = new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
  expect(d.bookmarks).toHaveLength(native.bookmarks.length);
  for (const expected of native.bookmarks) {
    expect(expected.selectedCells).toHaveLength(expected.selectedCellCount);
    const b = d.bookmarks.find(b => b.name === expected.name);
    expect(!!b.columnRange, expected.name).toBe(expected.column);
    if (!expected.column) continue;
    expect(b.columnRange.cellIds, expected.name).toHaveLength(expected.selectedCellCount);
    const coveredText = b.columnRange.ranges.map(r => text(d.paragraphs.find(p => p.id === r.paragraphId))).join('\n');
    expect(tokens(coveredText), expected.name).toEqual(tokens(expected.selectedCells.map(c => c.text).join('\n')));
  }
  expect(unzipSync(new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer()))).toEqual(unzipSync(source));
});
