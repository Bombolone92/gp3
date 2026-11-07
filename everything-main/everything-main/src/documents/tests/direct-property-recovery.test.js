import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/direct-property-recovery/${name}.docx`);
const sameParts = (a, b) => { expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort()); for (const name of Object.keys(a)) expect(Buffer.from(a[name]).equals(Buffer.from(b[name])), name).toBe(true); };

it.each(['run', 'paragraph', 'mark', 'combined'])('retains mixed run content and paragraph formatting: %s', async name => {
  const bytes = source(name);
  await expect(DocxPackage.open(bytes)).rejects.toThrow('shading');
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true); sameParts(pkg.parts, unzipSync(bytes));
  expect(pkg.previewIssues.some(issue => issue.includes('shading'))).toBe(true);
  expect(pkg.tables).toHaveLength(1);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets, { displayOnly: true });
  const all = [...doc.paragraphs, ...pkg.pageStories.stories['word/header1.xml'].paragraphs];
  for (const number of [1, 3, 4]) {
    const p = all.find(p => paragraphText(p).startsWith(`Before picture ${number} `));
    expect(p).toBeDefined();
    expect(p.format.indentLeft).toBe(360);
    expect(p.runs.filter(r => r.image)).toHaveLength(1);
    expect(p.runs.map(r => r.text).join('')).toContain(' after picture');
    for (const run of p.runs) expect(run).toMatchObject({ bold: true, color: '803020', fontSize: 14 });
  }
  expect(doc.paragraphs.flatMap(p => p.runs).filter(r => r.image)).toHaveLength(3);
  expect(() => pkg.export()).toThrow('read-only');
});

it('preserves the supported control without making it read-only', async () => {
  const pkg = await DocxPackage.open(source('healthy'));
  expect(pkg.readOnly).not.toBe(true);
  sameParts(unzipSync(new Uint8Array(await pkg.export().arrayBuffer())), unzipSync(source('healthy')));
});
