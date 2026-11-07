import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
import { moveInlineControlHomeEnd } from '../src/engine/content-control-caret.js';
const root = 'tests/fixtures/empty-control-home-end/';
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
for (const ref of reference.cases) it(`matches the native reference Home/End exit: ${ref.name}`, async () => {
  for (const [name, hash] of [[ref.source, ref.sourceSha256], [ref.result, ref.resultSha256]])
    expect(createHash('sha256').update(readFileSync(root + name)).digest('hex')).toBe(hash);
  const p = await DocxPackage.open(readFileSync(root + ref.source)), d = model(p), native = model(await DocxPackage.open(readFileSync(root + ref.result)));
  const r = contentControlRanges(d.paragraphs)[0]; d.select(r.start, r.start, { id: r.control.id, side: 'inside' });
  const snapshot = d.snapshot(), end = ref.key.endsWith('End');
  const next = moveInlineControlHomeEnd(d.paragraphs, d.selection, end ? d.text.length : 0, end ? 1 : -1);
  expect(next.restoreEmpty).toBe(true); d.leaveEmptyControl(next.controlCaret.side, next.destination); d.replace('X');
  expect(d.text).toBe(native.text); expect(d.text).toBe(ref.text);
  const control = contentControlRanges(d.paragraphs)[0];
  expect(d.text.slice(control.start, control.end)).toBe(ref.controlText); expect(!!control.control.placeholder).toBe(ref.placeholder);
  const typed = doc => doc.paragraphs.flatMap(p => p.runs).find(r => r.text.includes('X'));
  expect(!!typed(d).bold).toBe(!!typed(native).bold); expect(typed(d).contentControl).toBeUndefined();
  const output = await save(p, d), reopened = model(await DocxPackage.open(output)); expect(reopened.text).toBe(ref.text);
  for (const [name, data] of Object.entries(p.parts)) if (name !== 'word/document.xml') expect(unzipSync(output)[name]).toEqual(data);
  d.undo(); d.undo(); expect(d.snapshot()).toEqual(snapshot); expect(unzipSync(await save(p, d))).toEqual(p.parts);
});

it('rejects invalid destination requests atomically', async () => {
  const d = model(await DocxPackage.open(readFileSync(root + 'control.docx'))), r = contentControlRanges(d.paragraphs)[0];
  d.select(r.start, r.start, { id: r.control.id, side: 'inside' }); const snapshot = d.snapshot();
  for (const [side, target] of [['before', 2], ['after', 0], ['after', 3], ['before', -1], ['after', 1.5], ['after', NaN]]) {
    expect(() => d.leaveEmptyControl(side, target)).toThrow('destination'); expect(d.snapshot()).toEqual(snapshot); expect(d.history).toHaveLength(0);
  }
});

it('only requests restoration for a collapsed inside empty rich-text caret', async () => {
  const d = model(await DocxPackage.open(readFileSync(root + 'control.docx'))), r = contentControlRanges(d.paragraphs)[0];
  for (const side of ['before', 'after']) { d.select(1, 1, { id: r.control.id, side }); expect(moveInlineControlHomeEnd(d.paragraphs, d.selection, 0, -1)).toBeNull(); }
  d.select(0, 2); expect(moveInlineControlHomeEnd(d.paragraphs, d.selection, 0, -1)).toBeNull();
  d.select(1, 1, { id: r.control.id, side: 'inside' }); d.replace('filled');
  expect(moveInlineControlHomeEnd(d.paragraphs, d.selection, 0, -1)).toBeNull();
});
