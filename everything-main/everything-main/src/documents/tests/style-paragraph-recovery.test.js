import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
import { listMarkers } from '../src/engine/numbering.js';
let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/style-paragraph-recovery/${name}.docx`);
const sameParts = (a, b) => { expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort()); for (const name of Object.keys(a)) expect(Buffer.from(a[name]).equals(Buffer.from(b[name])), name).toBe(true); };

it.each(['defaults', 'named', 'conditional', 'combined'])('retains supported style properties around rejected shading: %s', async name => {
  const bytes = source(name);
  await expect(DocxPackage.open(bytes)).rejects.toThrow('shading');
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  const control = await DocxPackage.open(source('healthy'));
  expect(pkg.readOnly).toBe(true);
  expect(pkg.styles).toEqual(control.styles);
  sameParts(pkg.parts, unzipSync(bytes));
  expect(pkg.previewIssues.some(issue => issue.includes('shading'))).toBe(true);
  expect(pkg.tables).toHaveLength(1); expect(Object.keys(pkg.assets)).toHaveLength(2);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets, { displayOnly: true });
  const heading = doc.paragraphs.find(p => paragraphText(p) === 'Styled heading');
  expect(heading.runs[0]).toMatchObject({ bold: true, fontSize: 18, color: '204080' });
  expect(() => pkg.export()).toThrow('read-only');
});

it('keeps the supported control editable and byte-preserving', async () => {
  const pkg = await DocxPackage.open(source('healthy'));
  expect(pkg.readOnly).not.toBe(true);
  sameParts(unzipSync(new Uint8Array(await pkg.export().arrayBuffer())), unzipSync(source('healthy')));
});

it('omits an entire duplicate property group rather than choosing one declaration', async () => {
  const parts = unzipSync(source('healthy'));
  parts['word/styles.xml'] = strToU8(strFromU8(parts['word/styles.xml']).replace('<w:spacing w:after="240" w:line="300" w:lineRule="auto"/>', '<w:spacing w:after="240" w:line="300" w:lineRule="auto"/><w:shd w:val="clear" w:fill="FFFFFF"/><w:shd w:val="solid" w:color="000000"/>'));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow('duplicate paragraph shading');
  const pkg = await DocxPackage.open(zipSync(parts), { bestEffort: true });
  const control = await DocxPackage.open(source('healthy'));
  expect(pkg.styles).toEqual(control.styles);
  sameParts(pkg.parts, parts);
});

it('retains a valid inherited list reference when another paragraph property fails', async () => {
  const parts = unzipSync(source('named'));
  parts['word/styles.xml'] = strToU8(strFromU8(parts['word/styles.xml']).replace('<w:name w:val="Heading"/><w:pPr>', '<w:name w:val="Heading"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr>'));
  const pkg = await DocxPackage.open(zipSync(parts), { bestEffort: true });
  expect(pkg.readOnly).toBe(true);
  expect(pkg.styles.definitions.Heading.reference.numId).toBe('1');
  expect(listMarkers(pkg.paragraphs, pkg.numbering).filter(Boolean).map(m => m.text)).toEqual(['1.', '2.']);
  sameParts(pkg.parts, parts);
});

it('contains a rejected numbering reference without losing sibling paragraph defaults', async () => {
  const parts = unzipSync(source('healthy'));
  parts['word/styles.xml'] = strToU8(strFromU8(parts['word/styles.xml']).replace('<w:pPrDefault><w:pPr>', '<w:pPrDefault><w:pPr><w:numPr><w:ins w:id="1" w:author="Control"/></w:numPr>'));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow('numbering reference');
  const pkg = await DocxPackage.open(zipSync(parts), { bestEffort: true });
  const control = await DocxPackage.open(source('healthy'));
  expect(pkg.readOnly).toBe(true);
  expect(pkg.styles).toEqual(control.styles);
  sameParts(pkg.parts, parts);
});
