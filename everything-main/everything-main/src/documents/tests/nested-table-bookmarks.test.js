import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = readFileSync('public/fixtures/nested-bookmarks.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const open = async () => { const p = await DocxPackage.open(source); return [p, model(p)]; };
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const ranges = d => Object.fromEntries(d.bookmarks.map(b => [b.name, d.text.slice(b.start, b.end)]));
const xml = bytes => new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']), 'application/xml');
const markers = bytes => {
  const found = [], walk = (node, path) => {
    for (const [index, child] of [...node.children].entries()) {
      if (['bookmarkStart', 'bookmarkEnd'].includes(child.localName)) found.push([path, index, child.localName, child.getAttributeNS(W, 'id')]);
      walk(child, path + '/' + child.localName + '[' + index + ']');
    }
  };
  walk(xml(bytes).documentElement, 'document'); return found;
};

it('maps ancestor boundaries to descendant text at three levels, including the first child table', async () => {
  const [, d] = await open();
  expect(d.tables).toHaveLength(3);
  expect(ranges(d)).toEqual({
    WholeOuter: 'Deep value\nInner tail\nInner two\nOuter tail\nOuter second\n',
    OuterRow: 'Deep value\nInner tail\nInner two\nOuter tail\n',
    OuterCell: 'Deep value\nInner tail\nInner two\nOuter tail\n',
    InnerRows: 'Deep value\nInner tail\nInner two\n',
    InnerCell: 'Deep value\nInner tail\n',
    DeepRow: 'Deep value\n',
    AfterInner: '',
  });
});

it('preserves every XML marker scope through deep text edits, reopen and byte-exact undo', async () => {
  const [p, d] = await open(); d.select(d.text.indexOf('value')); d.replace('edited ');
  const bytes = await save(p, d), again = model(await DocxPackage.open(bytes));
  expect(again.text).toBe(d.text); expect(ranges(again)).toEqual(ranges(d));
  expect(markers(bytes)).toEqual(markers(source));
  d.undo(); const restored = unzipSync(await save(p, d));
  for (const [name, bytes] of Object.entries(unzipSync(source))) expect(Buffer.from(restored[name]).equals(Buffer.from(bytes)), name).toBe(true);
});

it('extends enclosing bookmarks when an inner row is inserted and preserves outer row structure', async () => {
  const [p, d] = await open(); d.select(d.text.indexOf('Inner two')); d.insertTableRow();
  const again = model(await DocxPackage.open(await save(p, d)));
  expect(ranges(again)).toEqual(ranges(d));
  expect(ranges(again).InnerRows).toBe('Deep value\nInner tail\nInner two\n\n');
  expect(ranges(again).OuterRow).toBe('Deep value\nInner tail\nInner two\n\nOuter tail\n');
  expect(again.tables.find(t => !t.parentCellId).rows).toHaveLength(2);
  expect(ranges(again).AfterInner).toBe('');
});

it('keeps the outer table bookmark on the first surviving descendant when an inner row is deleted', async () => {
  const [p, d] = await open(); d.select(d.text.indexOf('Inner tail')); d.deleteTablePart('row');
  const again = model(await DocxPackage.open(await save(p, d)));
  expect(again.tables).toHaveLength(2); expect(ranges(again)).toEqual(ranges(d));
  expect(ranges(again).WholeOuter).toBe('Inner two\nOuter tail\nOuter second\n');
  expect(ranges(again).OuterRow).toBe('Inner two\nOuter tail\n');
});
