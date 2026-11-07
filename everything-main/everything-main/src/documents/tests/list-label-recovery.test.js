import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraphText, paragraphFormat } from '../src/engine/model.js';
import { listMarkers } from '../src/engine/numbering.js';
let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/list-label-recovery/${name}.docx`);
it('omits only failed labels while preserving other lists and shared counter progress', async () => {
 const bytes = source('unsupported'); await expect(DocxPackage.open(bytes)).rejects.toThrow('Roman list numbers');
 const pkg = await DocxPackage.open(bytes, { bestEffort: true });
 expect(pkg.readOnly).toBe(true); expect(pkg.parts).toEqual(unzipSync(bytes));
 const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets, { displayOnly: true });
 const markers = listMarkers(doc.paragraphs, doc.numbering);
 const label = text => markers[doc.paragraphs.findIndex(p => paragraphText(p) === text)]?.text ?? '';
 expect(label('Healthy first')).toBe('1.'); expect(label('Healthy second')).toBe('2.');
 expect(label('Unsupported label only')).toBe(''); expect(label('Shared counter continues')).toBe('4001.');
 const bad = doc.paragraphs.find(p => paragraphText(p) === 'Unsupported label only');
 expect(paragraphFormat(bad, doc.numbering)).toMatchObject({ indentLeft: 720, firstLine: -360 });
 expect(pkg.tables).toHaveLength(1); expect(Object.keys(pkg.assets)).toHaveLength(2);
 expect(pkg.previewIssues.some(issue => issue.includes('Roman list numbers'))).toBe(true);
 expect(() => pkg.export()).toThrow('read-only');
});
it.each(['healthy', 'header-healthy'])('does not enable marker recovery for supported editable lists: %s', async name => {
 const pkg = await DocxPackage.open(source(name));
 expect(pkg.readOnly).not.toBe(true); expect(pkg.numbering.previewMarkerRecovery).toBeUndefined();
 expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(source(name)));
});

it('detects failing labels in headers before handing the package to layout', async () => {
 const bytes = source('header-unsupported'); await expect(DocxPackage.open(bytes)).rejects.toThrow('Roman list numbers');
 const pkg = await DocxPackage.open(bytes, { bestEffort: true });
 expect(pkg.readOnly).toBe(true); expect(pkg.parts).toEqual(unzipSync(bytes));
 const story = pkg.pageStories.stories['word/header1.xml'];
 expect(listMarkers(story.paragraphs, pkg.numbering).map(m => m?.text ?? '')).toEqual(['', '', '4001.']);
 expect(listMarkers(pkg.paragraphs, pkg.numbering).filter(Boolean).map(m => m.text)).toEqual(['1.', '2.']);
 expect(pkg.previewIssues.some(issue => issue.includes('Roman list numbers'))).toBe(true);
 const strictNumbering = { ...pkg.numbering }; delete strictNumbering.previewMarkerRecovery;
 expect(() => listMarkers(story.paragraphs, strictNumbering)).toThrow('Roman list numbers');
});
