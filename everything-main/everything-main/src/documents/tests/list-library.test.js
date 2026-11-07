import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { DocxPackage, createDocx, WRITING_STYLES } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { listMarkers, levelFor } from '../src/engine/numbering.js';
import { applyListLibrary, libraryIndex, BULLET_LIBRARY, NUMBER_LIBRARY } from '../src/engine/list-library.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
function listDocument(lines) {
  const pkg = createDocx([paragraph()], undefined, undefined, undefined, [], {}, WRITING_STYLES);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  lines.forEach((line, i) => { if (i) doc.insertParagraph(); doc.replace(line); });
  return { pkg, doc };
}
const labels = doc => listMarkers(doc.paragraphs, doc.numbering).map(m => m?.text ?? null);

it('starts a list with a library marker and changes the whole list from one paragraph', async () => {
  const { pkg, doc } = listDocument(['one', 'two', 'three']);
  doc.select(0, doc.text.length);
  expect(applyListLibrary(doc, 'number', 2)).toBe(true);
  expect(labels(doc)).toEqual(['I.', 'II.', 'III.']);
  doc.select(5);
  applyListLibrary(doc, 'number', 4);
  expect(labels(doc)).toEqual(['a)', 'b)', 'c)']);
  expect(libraryIndex(levelFor(doc.numbering, doc.paragraphs[0].list), 'number')).toBe(4);
  const blob = await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets);
  const reopened = await DocxPackage.open(new Uint8Array(await blob.arrayBuffer()));
  expect(listMarkers(reopened.paragraphs, reopened.numbering).map(m => m?.text)).toEqual(['a)', 'b)', 'c)']);
});

it('switches between bullets and numbers and keeps nested levels and a restart', () => {
  const { doc } = listDocument(['top', 'nested', 'next']);
  doc.select(0, doc.text.length); doc.toggleList('number');
  doc.select(4); doc.changeListLevel(1);
  doc.select(4);
  applyListLibrary(doc, 'bullet', BULLET_LIBRARY.findIndex(([, ch]) => ch === '✓'));
  expect(labels(doc)).toEqual(['1.', '✓', '2.']);
  doc.select(0);
  applyListLibrary(doc, 'number', NUMBER_LIBRARY.findIndex(([name]) => name === 'A. B. C.'));
  expect(labels(doc)).toEqual(['A.', '✓', 'B.']);
  expect(applyListLibrary(doc, 'number', NUMBER_LIBRARY.findIndex(([name]) => name === 'A. B. C.'))).toBe(false);
});

it('applies a multilevel definition to every level of a list', async () => {
  const { applyMultilevelList } = await import('../src/engine/list-library.js');
  const { doc } = listDocument(['one', 'one.one', 'two']);
  doc.select(0, doc.text.length); doc.toggleList('bullet');
  doc.select(4); doc.changeListLevel(1);
  doc.select(0);
  applyMultilevelList(doc, 0);
  expect(labels(doc)).toEqual(['1.', '1.1.', '2.']);
  applyMultilevelList(doc, 2);
  expect(labels(doc)).toEqual(['I.', 'A.', 'II.']);
});
