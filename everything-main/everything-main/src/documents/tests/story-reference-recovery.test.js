import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { parseXml } from '../src/engine/docx-xml.js';
import { readPageStories, pageStoryPath } from '../src/engine/page-stories.js';
let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/story-reference-recovery/${name}.docx`);
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main', R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
it.each(['missing-header', 'external-header', 'duplicate-header', 'missing-footer'])('retains the healthy story when one reference fails: %s', async name => {
 const bytes = source(name); await expect(DocxPackage.open(bytes)).rejects.toThrow();
 const pkg = await DocxPackage.open(bytes, { bestEffort: true });
 expect(pkg.readOnly).toBe(true); expect(pkg.pageStories).toBeTruthy();
 const bad = name.endsWith('footer') ? 'footer' : 'header', good = bad === 'header' ? 'footer' : 'header';
 expect(pageStoryPath(pkg.pageStories, 0, bad, 1, true)).toBeNull();
 expect(pageStoryPath(pkg.pageStories, 0, good, 1, true)).toBe(`word/${good}1.xml`);
 expect(pkg.pageStories.stories[`word/${good}1.xml`].tables).toHaveLength(1);
 expect(pkg.pageStories.stories[`word/${bad}1.xml`]).toBeUndefined();
 expect(pkg.tables).toHaveLength(1); expect(Object.keys(pkg.assets)).toHaveLength(2);
 expect(pkg.parts).toEqual(unzipSync(bytes)); expect(pkg.previewIssues.length).toBeGreaterThan(0); expect(() => pkg.export()).toThrow('read-only');
});
it('does not revive an earlier header after an explicit broken replacement', () => {
 const parts = unzipSync(source('healthy')), sections = [...parseXml(parts['word/document.xml']).getElementsByTagNameNS(W, 'sectPr')];
 const section = content => parseXml(`<w:sectPr xmlns:w="${W}" xmlns:r="${R}">${content}</w:sectPr>`).documentElement;
 sections.push(section('<w:headerReference w:type="default" r:id="missing"/>'), section(''));
 const issues = [], definition = readPageStories(parts, sections, null, error => issues.push(error.feature));
 expect(issues).toEqual(['invalid or external header relationship']);
 expect([0, 1, 2].map(i => pageStoryPath(definition, i, 'header', i + 1, true))).toEqual(['word/header1.xml', null, null]);
 expect([0, 1, 2].map(i => pageStoryPath(definition, i, 'footer', i + 1, true))).toEqual(['word/footer1.xml', 'word/footer1.xml', 'word/footer1.xml']);
});
it('keeps invalid XML errors outside the unsupported-reference recovery contract', () => {
 const parts = unzipSync(source('healthy')), sections = [...parseXml(parts['word/document.xml']).getElementsByTagNameNS(W, 'sectPr')];
 parts['word/header1.xml'] = strToU8('<unclosed>'); const issues = [];
 expect(() => readPageStories(parts, sections, null, error => issues.push(error))).toThrow('invalid XML'); expect(issues).toEqual([]);
});
it('retains first and even variants when only the default reference is broken', () => {
 const parts = unzipSync(readFileSync('tests/fixtures/page-stories/footer-variants.docx'));
 const sections = [...parseXml(parts['word/document.xml']).getElementsByTagNameNS(W, 'sectPr')];
 const settings = parseXml(parts['word/settings.xml']).documentElement;
 delete parts['word/footer-default.xml']; const issues = [];
 const definition = readPageStories(parts, sections, settings, error => issues.push(error.feature));
 expect([1, 2, 3].map(n => pageStoryPath(definition, 0, 'footer', n, n === 1))).toEqual(['word/footer-first.xml', 'word/footer-even.xml', null]);
 expect(issues).toEqual(['a missing footer part']);
});
