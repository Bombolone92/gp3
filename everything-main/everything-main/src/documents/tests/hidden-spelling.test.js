import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const cases = JSON.parse(readFileSync('tests/fixtures/hidden-spelling/cases.json'));
it.each(cases)('reads $name and preserves the setting through edits and undo', async ({ name, hidden }) => {
  const source = readFileSync(`tests/fixtures/hidden-spelling/${name}.docx`), original = unzipSync(source);
  const pkg = await DocxPackage.open(source);
  expect(pkg.hideSpellingErrors).toBe(hidden);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  doc.select(0, 3); doc.replace('The');
  let bytes = await save(), parts = unzipSync(bytes);
  expect(parts['word/settings.xml']).toEqual(original['word/settings.xml']);
  expect((await DocxPackage.open(bytes)).hideSpellingErrors).toBe(hidden);
  doc.undo(); parts = unzipSync(await save());
  expect(Object.keys(parts).sort()).toEqual(Object.keys(original).sort());
  for (const key of Object.keys(parts)) expect(parts[key], key).toEqual(original[key]);
});
it.each(['<w:hideSpellingErrors w:val="yes"/>', '<w:hideSpellingErrors/><w:hideSpellingErrors/>', '<w:hideSpellingErrors><w:hideSpellingErrors/></w:hideSpellingErrors>'])('rejects malformed settings without losing other preview content: %s', async flag => {
  const parts = unzipSync(readFileSync('tests/fixtures/hidden-spelling/implicit.docx'));
  parts['word/settings.xml'] = strToU8(strFromU8(parts['word/settings.xml']).replace('<w:hideSpellingErrors/>', flag));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/hideSpellingErrors/);
  const preview = await DocxPackage.open(zipSync(parts), { bestEffort: true });
  expect(preview.readOnly).toBe(true);
  expect(preview.paragraphs.flatMap(p => p.runs).map(r => r.text).join('')).toContain('Teh quick fox jumpd.');
});
