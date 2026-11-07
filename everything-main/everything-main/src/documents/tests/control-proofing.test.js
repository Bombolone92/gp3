import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('tests/fixtures/control-proofing/source.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
function retained(bytes, edited = false, textEdited = edited) {
  const before = unzipSync(source), after = unzipSync(bytes);
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  if (textEdited) { expectBodyEditParts(after, before); return; }
  for (const name of Object.keys(before)) if (!edited || name !== 'word/document.xml') expect(after[name], name).toEqual(before[name]);
}

it('opens all proofing-annotated control types and retains the untouched package exactly', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  expect(pkg.readOnly).not.toBe(true);
  expect(contentControlRanges(doc.paragraphs)).toHaveLength(5);
  expect(doc.text).toContain('Case 4: Linked company tail');
  expect(doc.paragraphs.flatMap(p => p.runs).find(r => r.text === 'Linked company').link.target).toBe('https://example.com/');
  retained(await save(pkg, doc));
});

it.each([0, 1, 2, 3, 4])('edits annotated control %s with normal wrapper semantics and exact undo', async index => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), original = doc.text;
  const range = contentControlRanges(doc.paragraphs)[index];
  doc.select(range.start, range.end); doc.replace('Replacement');
  expect(doc.text).toBe(original.slice(0, range.start) + 'Replacement' + original.slice(range.end));
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(reopened.text).toBe(doc.text);
  expect(contentControlRanges(reopened.paragraphs)).toHaveLength(index === 4 ? 5 : 4);
  retained(bytes, true);
  const xml = new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']), 'application/xml');
  for (const control of xml.getElementsByTagNameNS(W, 'sdt')) {
    const tag = control.getElementsByTagNameNS(W, 'tag')[0]?.getAttributeNS(W, 'val');
    if (tag !== `original-${index + 1}`) expect(control.getElementsByTagNameNS(W, 'proofErr')).toHaveLength(4);
  }
  doc.undo(); retained(await save(pkg, doc));
});

it('retains the temporary wrapper on formatting-only edits', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), original = doc.text;
  const range = contentControlRanges(doc.paragraphs)[1];
  doc.select(range.start, range.start + 8); doc.toggleBold();
  const bytes = await save(pkg, doc), reopened = model(await DocxPackage.open(bytes));
  expect(reopened.text).toBe(original); expect(contentControlRanges(reopened.paragraphs)).toHaveLength(5);
  retained(bytes, true, false); doc.undo(); retained(await save(pkg, doc));
});

it.each(['missing', 'unknown', 'attribute', 'nested'])('rejects malformed proofing markers: %s', async kind => {
  const parts = unzipSync(source), xml = strFromU8(parts['word/document.xml']);
  const marker = '<w:proofErr w:type="spellStart"/>';
  const replacements = {
    missing: '<w:proofErr/>',
    unknown: '<w:proofErr w:type="unsupported"/>',
    attribute: '<w:proofErr w:type="spellStart" w:extra="1"/>',
    nested: '<w:proofErr w:type="spellStart"><w:r/></w:proofErr>',
  };
  expect(xml).toContain(marker);
  parts['word/document.xml'] = strToU8(xml.replace(marker, replacements[kind]));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/content controls/);
});
