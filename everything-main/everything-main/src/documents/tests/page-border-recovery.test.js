import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
let dom;
beforeAll(() => { dom = new JSDOM(); for (const key of ['Node','document','DOMParser','XMLSerializer']) globalThis[key] = dom.window[key]; });
afterAll(() => { dom.window.close(); for (const key of ['Node','document','DOMParser','XMLSerializer']) delete globalThis[key]; });
const source = name => readFileSync(`tests/fixtures/page-border-recovery/${name}.docx`);
const sections = pkg => [...pkg.paragraphs.filter(p => p.sectionEnd).map(p => p.sectionEnd),pkg.pageSettings];
const change = transform => {
  const parts = unzipSync(source('healthy'));
  parts['word/document.xml'] = strToU8(transform(strFromU8(parts['word/document.xml'])));
  return zipSync(parts);
};
it.each(['top','left','bottom','right','combined'])('omits only rejected page-border sides: %s', async name => {
  const bytes = source(name), omitted = await DocxPackage.open(source(`${name}-omitted`));
  await expect(DocxPackage.open(bytes)).rejects.toThrow();
  const pkg = await DocxPackage.open(bytes, { bestEffort:true });
  expect(pkg.readOnly).toBe(true);
  expect(sections(pkg)).toEqual(sections(omitted)); expect(sections(pkg)).toHaveLength(2);
  expect(pkg.tables).toHaveLength(1); expect(Object.keys(pkg.assets)).toHaveLength(2);
  const failed = name === 'combined' ? ['top','right'] : [name];
  for (const side of failed) expect(pkg.previewIssues.some(s => s.includes(`page border ${side} omitted from preview`))).toBe(true);
  expect(pkg.parts).toEqual(unzipSync(bytes)); expect(() => pkg.export()).toThrow('read-only');
});
it.each([
  ['invalid size', xml => xml.replace('w:sz="48"','w:sz="bad"')],
  ['invalid color', xml => xml.replace('w:color="CC2233"','w:color="bad-color"')],
  ['unsupported shadow', xml => xml.replace('w:color="CC2233"','w:color="CC2233" w:shadow="1"')],
  ['nested content', xml => xml.replace(/(<w:top[^>]+)\/>/,'$1><w:p/></w:top>')],
])('retains other sides after %s on the first section top', async (_name, transform) => {
  const bytes = change(transform); await expect(DocxPackage.open(bytes)).rejects.toThrow();
  const pkg = await DocxPackage.open(bytes,{bestEffort:true}), healthy = await DocxPackage.open(source('healthy'));
  const expected = sections(healthy); delete expected[0].pageBorders.borders.top;
  expect(sections(pkg)).toEqual(expected); expect(pkg.readOnly).toBe(true);
});
it.each([
  ['container position', xml => xml.replace('w:offsetFrom="page"','w:offsetFrom="unknown"')],
  ['duplicate side', xml => xml.replace(/(<w:top[^>]+\/>)/,'$1$1')],
  ['container text', xml => xml.replace('</w:pgBorders>','bad text</w:pgBorders>')],
])('keeps ambiguous %s as a whole-border failure', async (_name, transform) => {
  const bytes = change(transform); await expect(DocxPackage.open(bytes)).rejects.toThrow();
  const pkg = await DocxPackage.open(bytes,{bestEffort:true});
  expect(sections(pkg)[0].pageBorders).toBeNull();
  expect(sections(pkg)[1].pageBorders).toEqual(sections(await DocxPackage.open(source('healthy')))[1].pageBorders);
});
