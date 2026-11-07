import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { listMarkers } from '../src/engine/numbering.js';
const folder = 'tests/fixtures/numbering-override-index/';
const refs = JSON.parse(readFileSync(folder + 'reference.json', 'utf8'));
let dom, control, matched, markers;
beforeAll(async () => {
 dom = new JSDOM();
 for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name];
 control = await DocxPackage.open(readFileSync(folder + 'control.docx'), {bestEffort:true});
 matched = await DocxPackage.open(readFileSync(folder + 'matched.docx'));
 const doc = new TextDocument(matched.paragraphs, matched.pageSettings, matched.numbering, matched.styles, matched.tables, matched.assets);
 markers = listMarkers(doc.paragraphs, doc.numbering).map(m => m?.text);
 expect(control.paragraphs).toHaveLength(16);
 expect(markers).toHaveLength(16);
 expect(matched.readOnly).not.toBe(true);
});
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
it.each(refs)('binds native rows to the exact independent source and PDF: $name', ref => {
 for (const [suffix, key] of [['.docx','sourceSha256'],['-native.pdf','pdfSha256'],['-native.png','pngSha256']])
  expect(createHash('sha256').update(readFileSync(folder + ref.name + suffix)).digest('hex')).toBe(ref[key]);
 expect(ref.rows).toHaveLength(16);
});
it('retains the same native markers when abstract identities are made explicit', () => {
 expect(refs[1].rows).toEqual(refs[2].rows);
 expect(refs[0].rows.every(row => row.marker === '')).toBe(true);
});
// Setup and reference integrity checks above are ordinary required checks.
// Native marker checks also cover counter starts and ignored full overrides.
it('conflicting child indexes should retain editable empty native levels', () => {
 expect(control.readOnly).not.toBe(true);
});
it('full override counter starts should match the native values', () => {
 const indexes = [0, 2, 4, 6, 8, 10, 12, 14];
 expect(indexes.map(i => markers[i])).toEqual(indexes.map(i => refs[1].rows[i].marker));
});
it('deeper references in a full override should retain native abstract labels', () => {
 const indexes = [1, 3, 9, 11, 13, 15];
 expect(indexes.map(i => markers[i])).toEqual(indexes.map(i => refs[1].rows[i].marker));
});
