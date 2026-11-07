import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
const folder = 'tests/fixtures/unknown-run-child-recovery/';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = name => readFileSync(folder + name + '.docx');
const all = p => [...p.paragraphs, ...Object.values(p.pageStories.stories).flatMap(s => s.paragraphs)];
it.each(['before', 'after', 'both'])('isolates unsupported children %s pictures in body, cells and stories', async position => {
  const bytes = source(position + '-unsupported');
  await expect(DocxPackage.open(bytes)).rejects.toThrow('ruby');
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  const control = await DocxPackage.open(source(position + '-matched'));
  expect(pkg.readOnly).toBe(true); expect(pkg.tables).toHaveLength(1);
  const model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets, { displayOnly: true });
  expect(model.text).toBe(new TextDocument(control.paragraphs, control.pageSettings, control.numbering, control.styles, control.tables, control.assets).text);
  const paragraphs = all(pkg);
  expect(paragraphs.flatMap(p => p.runs).filter(r => r.image && r.bold && r.link)).toHaveLength(4);
  for (const number of [10, 20, 30, 40]) {
    const p = paragraphs.find(p => paragraphText(p).includes(`Linked ${number}`));
    expect(p.format.indentLeft).toBe(360);
    expect(p.runs.find(r => r.text.startsWith(`Linked ${number}`))).toMatchObject({ bold: true, color: '803020', fontSize: 14 });
    expect(p.runs.find(r => r.text === 'Linked tail')).toMatchObject({ italic: true, link: { target: 'https://example.com/retained' } });
    expect(paragraphText(p).match(/readingBASE/g)).toHaveLength(position === 'both' ? 2 : 1);
  }
  for (const part of ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']) expect(pkg.previewIssues.some(s => s.includes(part) && s.includes('ruby') && s.includes('inline text'))).toBe(true);
  expect(pkg.parts).toEqual(unzipSync(bytes)); expect(() => pkg.export()).toThrow('read-only');
  expect(unzipSync(new Uint8Array(await control.export().arrayBuffer()))).toEqual(control.parts);
});
it('omits opaque child metadata without exposing field instructions or deleting healthy siblings', async () => {
  const parts = unzipSync(source('before-unsupported'));
  // A deliberately unknown extension verifies the generic boundary, not ruby-specific dispatch.
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replaceAll(/<w:ruby>.*?<\/w:ruby>/g,
    '<x:unknown xmlns:x="urn:recovery-test"><w:instrText>SECRET CODE</w:instrText><w:del><w:r><w:delText>DELETED</w:delText></w:r></w:del><w:r><w:t>visible</w:t></w:r></x:unknown>'));
  const p = await DocxPackage.open(zipSync(parts), { bestEffort: true });
  expect(p.readOnly).toBe(true);
  const text = p.paragraphs.map(paragraphText).join('\n');
  expect(text).toContain('visible'); expect(text).not.toMatch(/SECRET|DELETED/);
  expect(p.paragraphs.flatMap(p => p.runs).filter(r => r.image && r.bold && r.link)).toHaveLength(2);
});
