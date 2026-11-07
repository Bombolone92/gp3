import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { listMarkers } from '../src/engine/numbering.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const folder = 'tests/fixtures/font-encoded-bullets', source = readFileSync(`${folder}/font-encoded-bullets.docx`);
const reference = JSON.parse(readFileSync(`${folder}/reference.json`, 'utf8'));
it('retains the independent native references', () => {
  for (const [name, hash] of Object.entries(reference.hashes)) expect(createHash('sha256').update(readFileSync(`${folder}/${name}`)).digest('hex')).toBe(hash);
});
it('preserves font-encoded markers through edit, numbering regeneration, reopen and exact undo', async () => {
  const pkg = await DocxPackage.open(source), doc = new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const check = p => {
    const markers = listMarkers(p.paragraphs, p.numbering); expect(markers).toHaveLength(reference.cases.length);
    for (const [i, m] of markers.entries()) { expect(m.text).toBe(reference.cases[i].label); expect(m.level.markerStyle.fontAscii).toBe(reference.cases[i].face); }
  };
  check(pkg);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
  doc.replace('Edited '); const edited = await save(); check(await DocxPackage.open(edited));
  const original = unzipSync(source), out = unzipSync(edited);
  for (const name of Object.keys(original)) if (name !== 'word/document.xml') expect(Buffer.from(original[name]).equals(Buffer.from(out[name])), name).toBe(true);
  doc.undo(); const undo = unzipSync(await save());
  for (const name of Object.keys(original)) expect(Buffer.from(original[name]).equals(Buffer.from(undo[name])), name).toBe(true);
  doc.numbering.abstracts['12'] = {...structuredClone(doc.numbering.abstracts['0']), generated: true};
  const reopened = await DocxPackage.open(await save());
  expect(reopened.numbering.abstracts['12'].levels[0]).toMatchObject({text: '\uf09f', markerStyle: {fontAscii: 'Wingdings'}});
});
