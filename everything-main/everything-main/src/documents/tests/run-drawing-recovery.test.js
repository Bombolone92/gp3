import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText } from '../src/engine/model.js';
let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/run-drawing-recovery/${name}.docx`);
const sameParts = (a, b) => { expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort()); for (const name of Object.keys(a)) expect(Buffer.from(a[name]).equals(Buffer.from(b[name])), name).toBe(true); };

it.each(['drawing', 'alternate'])('omits only the failing drawing inside mixed runs: %s', async name => {
  const bytes = source(name);
  await expect(DocxPackage.open(bytes)).rejects.toThrow('alphaBiLevel');
  const pkg = await DocxPackage.open(bytes, { bestEffort: true });
  expect(pkg.readOnly).toBe(true); sameParts(pkg.parts, unzipSync(bytes));
  expect(pkg.previewIssues.some(issue => issue.includes('alphaBiLevel'))).toBe(true);
  expect(pkg.tables).toHaveLength(1);
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets, { displayOnly: true });
  const all = [...doc.paragraphs, ...pkg.pageStories.stories['word/header1.xml'].paragraphs];
  for (const number of [10, 20, 30]) {
    const p = all.find(p => paragraphText(p).startsWith(`Start ${number}`));
    expect(p.format.indentLeft).toBe(360);
    expect(p.runs.filter(r => r.image && !r.image.previewPlaceholder)).toHaveLength(2);
    expect(p.runs.filter(r => r.image?.previewPlaceholder)).toHaveLength(1);
    expect(p.runs.filter(r => !r.image).map(r => r.text).join('')).toBe(`Start ${number}MiddleFollowingEnd`);
    for (const run of p.runs) expect(run).toMatchObject({ bold: true, color: '803020', fontSize: 14 });
  }
  expect(() => pkg.export()).toThrow('read-only');
});

it('keeps supported mixed runs editable and preserves the package', async () => {
  const pkg = await DocxPackage.open(source('healthy'));
  expect(pkg.readOnly).not.toBe(true);
  sameParts(unzipSync(new Uint8Array(await pkg.export().arrayBuffer())), unzipSync(source('healthy')));
});
