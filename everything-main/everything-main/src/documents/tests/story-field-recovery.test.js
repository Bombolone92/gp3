import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { projectCachedFieldResults, cachedFieldTree } from '../src/engine/docx-field-results.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/story-field-recovery/${name}.docx`);
const sameParts = (a, b) => { expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort()); for (const name of Object.keys(a)) expect(Buffer.from(a[name]).equals(Buffer.from(b[name])), name).toBe(true); };

it.each(['simple', 'complex', 'nested', 'combined'])('retains rich cached results and live header/footer page fields: %s', async name => {
  const bytes = source(name);
  await expect(DocxPackage.open(bytes)).rejects.toThrow();
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true); sameParts(pkg.parts, unzipSync(bytes));
  expect(pkg.previewIssues.some(issue => issue.includes('field'))).toBe(true);
  expect(pkg.tables).toHaveLength(1);
  for (const kind of ['header', 'footer']) {
    const story = pkg.pageStories.stories[`word/${kind}1.xml`], p = story.paragraphs[0];
    expect(story.editable).toBe(false);
    expect(p.runs.filter(r => r.image)).toHaveLength(1);
    expect(p.runs.filter(r => r.field).map(r => r.field.type)).toEqual(['PAGE', 'NUMPAGES']);
    expect(p.runs[0]).toMatchObject({ bold: true, color: '204080', fontSize: 18 });
    expect(p.runs.find(r => r.text === 'September 29, 2026').italic).toBe(true);
    expect(p.runs.map(r => r.text).join('')).not.toMatch(/COMPARE|DATE|NUMPAGES/);
  }
  expect(() => pkg.export()).toThrow('read-only');
});

it('keeps the supported control editable and byte-preserving', async () => {
  const bytes = source('healthy'), pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true);
  sameParts(unzipSync(new Uint8Array(await pkg.export().arrayBuffer())), unzipSync(bytes));
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const parse = content => new DOMParser().parseFromString(`<w:p xmlns:w="${W}">${content}</w:p>`, 'application/xml').documentElement;
it('leaves incomplete fields and orphan delimiters unchanged in selective recovery', () => {
  const root = parse('<w:r><w:fldChar w:fldCharType="end"/><w:fldChar w:fldCharType="begin"/><w:instrText>DATE</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>Cached</w:t></w:r>');
  const before = new XMLSerializer().serializeToString(root);
  projectCachedFieldResults(root, undefined, () => true);
  expect(new XMLSerializer().serializeToString(root)).toBe(before);
});
it('retains supported nested simple fields while projecting their outer cache', () => {
  const root = parse('<w:fldSimple w:instr="DATE"><w:r><w:t>Date</w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>9</w:t></w:r></w:fldSimple></w:fldSimple>');
  projectCachedFieldResults(root, undefined, field => field.instruction === 'DATE');
  expect(cachedFieldTree(root).fields.map(f => f.instruction)).toEqual(['PAGE']);
  expect(root.textContent).toBe('Date9');
});
it('propagates unexpected selector failures before changing the tree', () => {
  const root = parse('<w:fldSimple w:instr="DATE"><w:r><w:t>Date</w:t></w:r></w:fldSimple>');
  const before = new XMLSerializer().serializeToString(root);
  expect(() => projectCachedFieldResults(root, undefined, () => { throw new Error('probe failure'); })).toThrow('probe failure');
  expect(new XMLSerializer().serializeToString(root)).toBe(before);
});
it('hides supported nested fields in an unsupported instruction instead of evaluating them visibly', () => {
  const root = parse('<w:r><w:fldChar w:fldCharType="begin"/><w:instrText>IF</w:instrText></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>9</w:t></w:r></w:fldSimple><w:r><w:fldChar w:fldCharType="separate"/><w:t>Result</w:t><w:fldChar w:fldCharType="end"/></w:r>');
  projectCachedFieldResults(root, undefined, field => field.instruction === 'IF');
  expect(root.textContent).toBe('Result');
  expect(cachedFieldTree(root).fields).toEqual([]);
});
