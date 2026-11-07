import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = name => readFileSync(`public/fixtures/punctuation-kerning-${name}.docx`);
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => unzipSync(new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer()));
const same = (a, b, except = []) => { expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort()); for (const [n, bytes] of Object.entries(b)) if (!except.includes(n)) expect(Buffer.from(a[n]).equals(Buffer.from(bytes)), n).toBe(true); };

it.each(['on', 'off', 'omitted', 'asian-on', 'asian-off', 'asian-omitted'])('opens %s and retains settings through edit, export, reopen and undo', async name => {
  const p = await DocxPackage.open(source(name)), d = model(p);
  expect(p.readOnly).not.toBe(true); expect(d.text).toContain('T.A');
  const thresholds = d.paragraphs.flatMap(p => p.runs.map(r => r.kerning));
  expect(thresholds).toContain(1); expect(thresholds).toContain(0);
  same(await save(p, d), p.parts);
  d.select(d.text.indexOf('T.A') + 1); const initial = d.snapshot(); d.replace('V');
  const edited = await save(p, d); same(edited, p.parts, ['word/document.xml']);
  const reopened = model(await DocxPackage.open(zipSync(edited)));
  expect(reopened.text).toBe(d.text); expect(reopened.paragraphs.flatMap(p => p.runs.map(r => r.kerning))).toEqual(d.paragraphs.flatMap(p => p.runs.map(r => r.kerning)));
  d.undo(); expect(d.snapshot()).toEqual(initial); same(await save(p, d), p.parts);
});

it.each(['<w:noPunctuationKerning w:val="yes"/>', '<w:noPunctuationKerning/><w:noPunctuationKerning/>', '<w:noPunctuationKerning><w:b/></w:noPunctuationKerning>', '<w:noPunctuationKerning w:extra="1"/>'])('rejects malformed settings: %s', async declaration => {
  const parts = unzipSync(source('omitted'));
  parts['word/settings.xml'] = strToU8(strFromU8(parts['word/settings.xml']).replace('<w:compat>', declaration + '<w:compat>'));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toMatchObject({ name: 'UnsupportedDocumentError', message: expect.stringContaining('noPunctuationKerning') });
});
