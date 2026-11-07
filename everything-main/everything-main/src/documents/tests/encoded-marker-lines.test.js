import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const folder = 'tests/fixtures/encoded-marker-lines', source = readFileSync(`${folder}/encoded-marker-lines.docx`);
const measure = (text, style) => ({width: text.length * 5, ascent: style.fontSize * (style.fontAscii === 'Symbol' ? 1.5 : 1), descent: style.fontSize * .2});
it('retains the independently measured native reference hashes', () => {
  const hashes = JSON.parse(readFileSync(`${folder}/hashes.json`, 'utf8'));
  for (const [name, hash] of Object.entries(hashes)) expect(createHash('sha256').update(readFileSync(`${folder}/${name}`)).digest('hex')).toBe(hash);
});
it.each([0,1,2])('a taller label raises following lines without multiplying its extra ascent: spacing case %i', async spacing => {
  const p = await DocxPackage.open(source), layout = layoutDocument(p.paragraphs, measure, pageGeometry(p.pageSettings), p.numbering, p.tables);
  const small = layout.lines.filter(l => l.page === spacing), tall = layout.lines.filter(l => l.page === spacing + 3);
  expect(small).toHaveLength(4); expect(tall).toHaveLength(4);
  for (let i = 0; i < 4; i++) expect(tall[i].baseline - small[i].baseline).toBeCloseTo(15, 6);
  const caret = caretRect(layout, tall[1].start);
  expect(hitTest(layout, caret.page, caret.x, caret.y + caret.height / 2)).toBe(tall[1].start);
});
it('preserves numbering and unrelated XML across surrounding edits, reopening and exact undo', async () => {
  const p = await DocxPackage.open(source), d = new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets), parts = unzipSync(source);
  const save = async () => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  d.select(0); d.replace('EDIT '); const edited = await save(), output = unzipSync(edited);
  for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(Buffer.from(output[name]).equals(Buffer.from(parts[name])), name).toBe(true);
  expect((await DocxPackage.open(edited)).paragraphs[0].runs.map(r => r.text).join('')).toContain('EDIT ');
  d.undo(); const undo = unzipSync(await save());
  for (const name of Object.keys(parts)) expect(Buffer.from(undo[name]).equals(Buffer.from(parts[name])), name).toBe(true);
});
