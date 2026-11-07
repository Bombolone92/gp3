import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/style-run-recovery/${name}.docx`);
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
  parts['word/styles.xml'] = strToU8(strFromU8(parts['word/styles.xml']).replace('<w:sz w:val="22"/>', '<w:sz w:val="22"/><w:shd w:val="clear" w:fill="FFFFFF"/><w:shd w:val="solid" w:color="000000"/>'));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow('duplicate run shd');
  const pkg = await DocxPackage.open(zipSync(parts), { bestEffort: true });
  const control = await DocxPackage.open(source('healthy'));
  expect(pkg.styles).toEqual(control.styles);
  sameParts(pkg.parts, parts);
});
