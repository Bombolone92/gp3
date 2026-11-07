import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/story-block-recovery/${name}.docx`);
it.each(['header', 'footer', 'combined'])('retains supported header/footer siblings around an unsupported block: %s', async name => {
 const bytes = source(name);
 await expect(DocxPackage.open(bytes)).rejects.toThrow('page story blocks not yet implemented');
 const pkg = await DocxPackage.open(bytes, { bestEffort: true });
 expect(pkg.readOnly).toBe(true); expect(pkg.parts).toEqual(unzipSync(bytes));
 expect(pkg.tables).toHaveLength(1); expect(Object.keys(pkg.assets)).toHaveLength(2);
 for (const kind of ['header', 'footer']) {
  const story = pkg.pageStories.stories[`word/${kind}1.xml`];
  expect(story.editable).toBe(false); expect(story.tables).toHaveLength(1);
  expect(story.paragraphs.map(p => p.runs.map(r => r.text).join(''))).toEqual(['Healthy ' + kind, kind + ' table', 'Retained ' + kind + ' tail']);
  expect(story.paragraphs[0].runs[0].bold).toBe(true);
 }
 expect(pkg.previewIssues).toContain('oMathPara'); expect(() => pkg.export()).toThrow('read-only');
});
it('preserves the supported control as editable source', async () => {
 const bytes = source('healthy'), pkg = await DocxPackage.open(bytes);
 expect(pkg.readOnly).not.toBe(true);
 expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
});
