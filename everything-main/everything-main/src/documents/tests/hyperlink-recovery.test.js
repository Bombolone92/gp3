import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/hyperlink-recovery/${name}.docx`);

it.each([
  ['location', 'hyperlink document locations'],
  ['missing', 'hyperlink relationship'],
])('preserves mixed hyperlink contents when the destination cannot be used: %s', async (name, issue) => {
  const bytes = source(name);
  await expect(DocxPackage.open(bytes)).rejects.toThrow(issue);
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true);
  expect(pkg.previewIssues.some(message => message.includes(issue))).toBe(true);
  const original = unzipSync(bytes);
  expect(Object.keys(pkg.parts).sort()).toEqual(Object.keys(original).sort());
  for (const part of Object.keys(original)) expect(Buffer.from(pkg.parts[part]).equals(Buffer.from(original[part])), part).toBe(true);
  expect(pkg.tables).toHaveLength(1);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets, { displayOnly: true });
  const all = [...doc.paragraphs, ...pkg.pageStories.stories['word/header1.xml'].paragraphs];
  for (const number of [10, 20, 30]) {
    const p = all.find(p => paragraphText(p).includes(`Linked ${number}`));
    expect(p.format.indentLeft).toBe(360);
    expect(p.runs.filter(run => run.image)).toHaveLength(1);
    expect(p.runs.filter(run => !run.image).map(run => run.text).join('')).toBe(`Before Linked ${number}After picture End`);
    expect(p.runs.some(run => run.link)).toBe(false);
    expect(p.runs.find(run => run.text === `Linked ${number}`)).toMatchObject({ bold: true, color: '803020', fontSize: 14 });
  }
  expect(() => pkg.export()).toThrow('read-only');
});

it('keeps the supported mixed-content control editable', async () => {
  const pkg = await DocxPackage.open(source('healthy'));
  expect(pkg.readOnly).not.toBe(true);
});

it('keeps an unopenable destination as an editable, unopened link', async () => {
  const bytes = source('unsafe'), pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const linked = doc.paragraphs.flatMap(p => p.runs).filter(run => run.link);
  expect(linked.length).toBeGreaterThan(0);
  for (const run of linked) expect(run.link).toMatchObject({ target: 'javascript:alert(1)', retainedTarget: true });
});
