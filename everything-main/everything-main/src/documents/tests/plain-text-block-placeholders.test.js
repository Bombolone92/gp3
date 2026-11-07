import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { plainTextControlRanges } from '../src/engine/plain-text-controls.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const folder = 'tests/fixtures/plain-text-block-placeholders';
const cases = ['body-placeholder', 'cell-placeholder', 'singleline-placeholder', 'mixed-placeholder'];
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const xml = bytes => new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']), 'application/xml');
function retained(source, output, edited = false) {
  const a = unzipSync(source), b = unzipSync(output);
  expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
  for (const name of Object.keys(a)) if (!edited || name !== 'word/document.xml')
    expect(Buffer.from(a[name]).equals(Buffer.from(b[name])), name).toBe(true);
}

for (const name of cases) {
  it(`${name}: retains the multi-paragraph cache and formats its full range like the native reference`, async () => {
    const source = readFileSync(`${folder}/${name}-source.docx`), p = await DocxPackage.open(source), d = model(p);
    const range = plainTextControlRanges(d.paragraphs)[0];
    expect(range.paragraphs).toHaveLength(3);
    expect(d.text.slice(range.start, range.end)).toBe('Alpha Bravo\nSecond line\nThird line');
    retained(source, await save(p, d));
    d.select(range.start + 2, range.start + 4); const selection = { ...d.selection }; d.setRunFormat({ bold: true });
    expect(d.selection).toEqual(selection);
    const output = await save(p, d), reopened = model(await DocxPackage.open(output));
    const actual = plainTextControlRanges(reopened.paragraphs)[0];
    expect(actual.paragraphs).toHaveLength(3);
    expect(actual.paragraphs.flatMap(p => p.runs).filter(r => r.text).every(r => r.bold)).toBe(true);
    const native = xml(readFileSync(`${folder}/${name}-format-native.docx`));
    const control = native.getElementsByTagNameNS(W, 'sdt')[0];
    for (const run of control.getElementsByTagNameNS(W, 'r')) expect(run.getElementsByTagNameNS(W, 'b')).toHaveLength(1);
    retained(source, output, true); d.undo(); retained(source, await save(p, d));
  }, 60000);

  it(`${name}: interior typing replaces the entire cache and unwraps, matching the native reference`, async () => {
    const source = readFileSync(`${folder}/${name}-source.docx`), p = await DocxPackage.open(source), d = model(p), original = d.text;
    const range = plainTextControlRanges(d.paragraphs)[0];
    d.select(range.start + 2); d.replace('Replacement');
    expect(d.text).toBe(original.slice(0, range.start) + 'Replacement' + original.slice(range.end));
    expect(plainTextControlRanges(d.paragraphs)).toHaveLength(0);
    const native = xml(readFileSync(`${folder}/${name}-replace-native.docx`));
    expect(native.getElementsByTagNameNS(W, 'sdt')).toHaveLength(0);
    expect([...native.getElementsByTagNameNS(W, 't')].map(n => n.textContent)).toContain('Replacement');
    const output = await save(p, d), reopened = model(await DocxPackage.open(output));
    expect(reopened.text).toBe(d.text); expectBodyEditParts(unzipSync(output), unzipSync(source));
    d.undo(); retained(source, await save(p, d));
  }, 60000);
}

it.each(['body-existing', 'cell-existing', 'persistent-existing'])('rejects actual multi-paragraph plain text as the native reference does: %s', async name => {
  await expect(DocxPackage.open(readFileSync(`${folder}/${name}-source.docx`))).rejects.toThrow(/content controls/);
});
it('replaces a persistent multi-paragraph plain-text cache while retaining its wrapper', async () => {
  const source=readFileSync(`${folder}/persistent-placeholder-source.docx`),p=await DocxPackage.open(source),d=model(p);
  const range=plainTextControlRanges(d.paragraphs)[0];
  d.select(range.start+2);d.replace('Replacement');
  const output=await save(p,d),reopened=model(await DocxPackage.open(output));
  const actual=plainTextControlRanges(reopened.paragraphs)[0];
  expect(actual.paragraphs).toHaveLength(1);expect(reopened.text.slice(actual.start,actual.end)).toBe('Replacement');
  const native=xml(readFileSync(`${folder}/persistent-placeholder-replace-native.docx`));
  expect(native.getElementsByTagNameNS(W,'sdt')).toHaveLength(1);
  expect(xml(output).getElementsByTagNameNS(W,'sdt')).toHaveLength(1);
  expect(xml(output).getElementsByTagNameNS(W,'showingPlcHdr')).toHaveLength(0);
  expectBodyEditParts(unzipSync(output),unzipSync(source));d.undo();retained(source,await save(p,d));
});
it('does not admit nested controls or drawings through the placeholder exception', async () => {
  for (const extra of ['<w:sdt/>', '<w:r><w:drawing/></w:r>']) {
    const parts = unzipSync(readFileSync(`${folder}/body-placeholder-source.docx`));
    parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<w:sdtContent><w:p>', '<w:sdtContent><w:p>' + extra));
    await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/content controls/);
  }
});
