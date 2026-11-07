import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
import { blockControlGroups } from '../src/engine/block-controls.js';
import { assertPackageParts } from './helpers/assert-package-parts.js';
const root = 'tests/fixtures/glossary-bookmarks/', source = readFileSync(root + 'control.docx');
const refs = JSON.parse(readFileSync(root + 'native-ranges-cycle.json', 'utf8').replace(/^\uFEFF/, ''));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const title = c => new DOMParser().parseFromString(c.shell, 'application/xml').getElementsByTagNameNS(W, 'alias')[0].getAttributeNS(W, 'val');
const ranges = d => [...contentControlRanges(d.paragraphs), ...blockControlGroups(d.paragraphs)];
const range = (d, name) => ranges(d).find(r => title(r.control) === name);
const bookmarks = d => d.bookmarks.map(b => ({ name: b.name, text: d.text.slice(b.start, b.end) })).sort((a, b) => a.name.localeCompare(b.name));
it('binds all fifteen native edits to the independent original fixture', () => {
  expect(createHash('sha256').update(source).digest('hex')).toBe(refs.sourceSha256);
  expect(refs.cases).toHaveLength(15);
});
for (const [caseIndex, ref] of refs.cases.entries()) it(`matches the native reference ${ref.action} ${ref.name}, export, reopening and undo`, async () => {
  const p = await DocxPackage.open(source), d = model(p);
  expect(bookmarks(d)).toEqual([{ name: 'PromptWhole', text: 'Outside bookmark' }]);
  assertPackageParts(unzipSync(await save(p, d)), p.parts);
  for (const earlier of refs.cases.slice(0, caseIndex)) {
    const r = range(d, earlier.name); d.select(r.start, r.end); d.replace(earlier.action === 'replace' ? 'New value' : '');
  }
  {
    const r = range(d, ref.name), before = await save(p, d);
    d.select(r.start, r.end); d.replace(ref.action === 'replace' ? 'New value' : '');
    const edited = await save(p, d), reopened = model(await DocxPackage.open(edited));
    for (const current of [d, reopened]) {
      const actual = range(current, ref.name);
      expect(current.text.slice(actual.start, actual.end), ref.action + ' ' + ref.name).toBe(ref.text.replaceAll('\r', '\n'));
      expect(actual.control.placeholder).toBe(ref.placeholder);
      expect(bookmarks(current)).toEqual(ref.bookmarks.map(b => ({ name: b.name, text: (b.text || '').replaceAll('\r', '\n') })).sort((a, b) => a.name.localeCompare(b.name)));
      // Native story offsets include control boundary characters. Compare the
      // bookmark's position relative to its own control, which excludes them.
      for (const b of ref.bookmarks.filter(b => b.start >= ref.controlStart && b.end <= ref.controlEnd)) {
        const mark = current.bookmarks.find(m => m.name === b.name);
        expect(mark.start - actual.start).toBe(b.start - ref.controlStart);
        expect(mark.end - actual.start).toBe(b.end - ref.controlStart);
      }
    }
    for (const [n, bytes] of Object.entries(p.parts)) if (n !== 'word/document.xml') expect(Buffer.from(unzipSync(edited)[n]).equals(Buffer.from(bytes)), n).toBe(true);
    d.undo(); assertPackageParts(unzipSync(await save(p, d)), unzipSync(before));
    d.redo(); expect(bookmarks(d)).toEqual(bookmarks(reopened));
  }
});
it('restores shared names and multiparagraph ranges during replace all', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  expect(d.replaceMatches('Existing value', '', {}, true)).toBe(5);
  const ref = refs.cases.find(c => c.action === 'restore' && c.name === 'block');
  expect(bookmarks(d)).toEqual(ref.bookmarks.map(b => ({ name: b.name, text: (b.text || '').replaceAll('\r', '\n') })).sort((a, b) => a.name.localeCompare(b.name)));
  const shared = range(d, 'shared'); expect(d.bookmarks.find(b => b.name === 'PromptWhole').start).toBe(shared.start);
  expect(bookmarks(model(await DocxPackage.open(await save(p, d))))).toEqual(bookmarks(d));
  d.undo(); assertPackageParts(unzipSync(await save(p, d)), p.parts);
});
it('removes inline prompt bookmarks when search replaces their whole placeholder', async () => {
  const p = await DocxPackage.open(source), d = model(p);
  d.replaceMatches('Existing value', '', {}, true);
  expect(d.replaceMatches('Enter name', 'New value', {}, true)).toBe(4);
  expect(bookmarks(d).map(b => b.name)).toEqual(['PromptAcross', 'PromptSecond']);
  expect(bookmarks(model(await DocxPackage.open(await save(p, d))))).toEqual(bookmarks(d));
});
for (const [name, from, to] of [
  ['unpaired', '<w:bookmarkEnd w:id="0"/>', ''],
  ['unknown attributes', '<w:bookmarkStart w:id="0"', '<w:bookmarkStart w:unknown="x" w:id="0"'],
  ['invalid identifiers', '<w:bookmarkStart w:id="0"', '<w:bookmarkStart w:id="bad"'],
]) it('rejects ' + name + ' glossary markers without silently discarding them', async () => {
  const parts = unzipSync(source); parts['word/glossary/document.xml'] = strToU8(strFromU8(parts['word/glossary/document.xml']).replace(from, to));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/bookmark/);
});
