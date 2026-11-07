import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { resolvedFormat } from '../src/engine/formatting.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/paragraph-line-units.docx');
const ref = JSON.parse(readFileSync('tests/fixtures/paragraph-line-units/reference.json'));
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables).arrayBuffer());
const find = (d, label) => d.paragraphs.find(p => p.runs.map(r => r.text).join('') === label);
it('resolves all line-unit gaps with zero and point precedence', async () => {
  const d = model(await DocxPackage.open(source));
  for (const c of ref.cases) {
    const p = find(d, c.id + (c.side === 'before' ? 'C' : 'B'));
    expect(Math.abs(p.format[c.side === 'before' ? 'spaceBefore' : 'spaceAfter'] - c.gap), c.id).toBeLessThan(.2);
  }
});
it.each(['before', 'after'])('point edits override inherited %s line units through reopen and exact undo', async side => {
  const p = await DocxPackage.open(source), d = model(p);
  const c = ref.cases.find(c => c.inherited && c.side === side), label = c.id + (side === 'before' ? 'C' : 'B');
  const at = d.text.indexOf(label), key = side === 'before' ? 'spaceBefore' : 'spaceAfter';
  d.select(at, at + label.length); d.setParagraphFormat({ [key]: 7 });
  const bytes = await save(p, d), reopened = model(await DocxPackage.open(bytes));
  expect(find(reopened, label).format[key]).toBe(7);
  for (const [n, b] of Object.entries(unzipSync(bytes))) if (n !== 'word/document.xml') expect(b).toEqual(p.parts[n]);
  d.undo(); expect(unzipSync(await save(p, d))).toEqual(p.parts);
});
it('style point edits clear competing units, and inheritance restores source spacing', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  const c = ref.cases.find(c => c.inherited && c.side === 'before'), id = 'S' + Number(c.id.slice(1)), label = c.id + 'C';
  d.editParagraphStyle(id, { paragraph: { spaceBefore: 7 } });
  expect(find(d, label).format.spaceBefore).toBe(7);
  expect(find(model(await DocxPackage.open(await save(p, d))), label).format.spaceBefore).toBe(7);
  d.undo(); expect(unzipSync(await save(p, d))).toEqual(p.parts);
});
it('retains bounds and gives automatic spacing precedence over line units', () => {
  expect(() => resolvedFormat({ spacing: { beforeLines: '5001' } })).toThrow();
  expect(resolvedFormat({ spacing: { beforeAutospacing: '1', beforeLines: '200' } }).spaceBefore).toBe(14);
  expect(resolvedFormat({ spacing: { beforeLines: '0', before: '720' } }).spaceBefore).toBe(36);
});
