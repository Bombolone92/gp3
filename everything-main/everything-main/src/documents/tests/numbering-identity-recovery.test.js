import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { listMarkers } from '../src/engine/numbering.js';
import { readNumbering } from '../src/engine/docx-numbering.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/numbering-identity-recovery/${name}.docx`);
const variants = ['duplicate-abstract', 'duplicate-instance', 'invalid-abstract', 'missing-abstract', 'invalid-instance', 'missing-instance', 'zero-instance', 'combined'];

it.each(variants)('isolates a malformed numbering identity and preserves healthy lists: %s', async name => {
  const bytes = source(name);
  await expect(DocxPackage.open(bytes)).rejects.toThrow();
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true);
  expect(pkg.previewIssues.some(message => message.includes('word/numbering.xml'))).toBe(true);
  const args = [pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets];
  const doc = new TextDocument(...args, { displayOnly: true });
  expect(listMarkers(doc.paragraphs, pkg.numbering).filter(Boolean).map(marker => marker.text)).toEqual(['1.', '2.']);
  const header = pkg.pageStories.stories['word/header1.xml'];
  const story = new TextDocument(header.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, header.tables, pkg.assets, { displayOnly: true });
  expect(listMarkers(story.paragraphs, pkg.numbering).filter(Boolean).map(marker => marker.text)).toEqual(['1.']);
  const retained = [...doc.paragraphs, ...story.paragraphs].filter(p => p.runs[0]?.text.startsWith('Retained ') && p.runs.some(r => r.image));
  expect(retained).toHaveLength(3);
  for (const p of retained) {
    expect(p.list).toBeNull();
    expect(p.runs[0]).toMatchObject({ bold: true, color: '204080', fontSize: 18 });
    expect(p.runs.at(-1).italic).toBe(true);
  }
  const original = unzipSync(bytes);
  expect(Object.keys(pkg.parts).sort()).toEqual(Object.keys(original).sort());
  for (const part of Object.keys(original)) expect(pkg.parts[part], part).toEqual(original[part]);
  expect(() => pkg.export()).toThrow('read-only');
});

it('treats equivalent numeric IDs as ambiguous regardless of declaration order', async () => {
  const parts = unzipSync(source('duplicate-instance'));
  let xml = strFromU8(parts['word/numbering.xml']);
  const instances = xml.match(/<w:num w:numId="2">.*?<\/w:num>/g);
  expect(instances).toHaveLength(2);
  xml = xml.replace(instances.join(''), instances[1].replace('w:numId="2"', 'w:numId="02"') + instances[0]);
  parts['word/numbering.xml'] = strToU8(xml);
  const pkg = await DocxPackage.open(zipSync(parts), {bestEffort:true});
  expect(pkg.numbering.instances['2'].error).toContain('duplicate numId 2');
  expect(pkg.numbering.instances['1'].abstractId).toBe('0');
});

it.each(['duplicate-abstract', 'invalid-abstract'])('does not reinterpret an invalid linked abstract using local levels: %s', name => {
  const parts = unzipSync(source(name));
  const numbering = strFromU8(parts['word/numbering.xml']);
  // Retain backlinks even on records with invalid/ambiguous identities.
  parts['word/numbering.xml'] = strToU8(numbering.replace(/(<w:abstractNum(?: w:abstractNumId="(?:1|bogus)")?>)/g, '$1<w:styleLink w:val="Linked"/>')
    .replace('<w:num w:numId="1">', '<w:abstractNum w:abstractNumId="9"><w:numStyleLink w:val="Linked"/></w:abstractNum><w:num w:numId="1">'));
  parts['word/styles.xml'] = strToU8(strFromU8(parts['word/styles.xml']).replace('</w:styles>', '<w:style w:type="numbering" w:styleId="Linked"><w:name w:val="Linked"/></w:style></w:styles>'));
  const errors = [];
  const result = readNumbering(parts, () => ({}), undefined, undefined, error => errors.push(error));
  expect(errors.length).toBeGreaterThan(0);
  expect(result.abstracts['0'].levels[0].format).toBe('decimal');
  expect(result.abstracts['9'].error).toMatch(/Ambiguous|invalid definition identity/);
});

it('rejects unused malformed identities strictly and keeps their preview diagnostic', async () => {
  const parts = unzipSync(source('invalid-instance'));
  for (const name of ['word/document.xml', 'word/header1.xml']) parts[name] = strToU8(strFromU8(parts[name]).replaceAll('w:numId w:val="2"', 'w:numId w:val="1"'));
  const bytes = zipSync(parts);
  await expect(DocxPackage.open(bytes)).rejects.toThrow();
  const pkg = await DocxPackage.open(bytes, {bestEffort:true});
  expect(pkg.readOnly).toBe(true);
  expect(pkg.previewIssues.join(' ')).toContain('numId is missing or invalid');
  expect(pkg.numbering.instances['1'].abstractId).toBe('0');
});
