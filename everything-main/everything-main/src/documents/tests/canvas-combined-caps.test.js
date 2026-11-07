import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { capitalizationParts } from '../src/engine/capitalization.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/combined-caps.docx');
const ref = JSON.parse(readFileSync('tests/fixtures/combined-caps/reference.json'));
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables).arrayBuffer());
function check(d) {
  for (const c of ref.cases) {
    const p = d.paragraphs.find(p => p.runs.map(r => r.text).join('').startsWith(c.id + ' '));
    const r = p.runs.find(r => r.text === 'Abc XYZ');
    const parts = capitalizationParts(r.text, r) || [{ text: r.text, fontSize: r.fontSize }];
    const glyphs = parts.flatMap(p => [...p.text].filter(c => !/\s/.test(c)).map(c => [c, p.fontSize]));
    expect(glyphs.map(g => g[0]), c.id).toEqual(c.glyphs.map(g => g[0]));
    for (const [i, g] of glyphs.entries()) expect(Math.abs(g[1] - c.glyphs[i][1]), c.id).toBeLessThan(.1);
  }
}
it('matches all 48 independently measured native reference capitalization controls', async () => {
  expect(createHash('sha256').update(source).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync('tests/fixtures/combined-caps/native.pdf')).digest('hex')).toBe(ref.pdfSha256);
  check(model(await DocxPackage.open(source)));
});
it('preserves combined declarations through edit, export, reopen and exact undo', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  d.select(d.text.length); d.replace('Edited');
  const bytes = await save(p, d); check(model(await DocxPackage.open(bytes)));
  for (const [n, b] of Object.entries(unzipSync(bytes))) if (n !== 'word/document.xml') expect(b).toEqual(p.parts[n]);
  d.undo(); expect(unzipSync(await save(p, d))).toEqual(p.parts);
});
it('serializes every combined style declaration when properties are rebuilt', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  for (const capitalization of ['bothCapsOff', 'capsSmallCapsOff', 'smallCapsCapsOff', 'bothCapsOn']) {
    d.editParagraphStyle('C12', { run: { capitalization } });
    const reopened = await DocxPackage.open(await save(p, d));
    expect(reopened.styles.definitions.C12.run.capitalization).toBe(capitalization);
  }
});
