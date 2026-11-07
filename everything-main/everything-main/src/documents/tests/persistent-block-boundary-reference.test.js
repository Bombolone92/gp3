import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { blockControlGroups } from '../src/engine/block-controls.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
import { TextDocument } from '../src/engine/model.js';

const root = 'tests/fixtures/persistent-block-controls/';
const reference = JSON.parse(readFileSync(root + 'boundary-matrix/reference.json', 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let dom;
beforeAll(() => {
  dom = new JSDOM();
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
});
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const title = control => new DOMParser().parseFromString(control.shell, 'application/xml')
  .getElementsByTagNameNS(W, 'alias')[0]?.getAttributeNS(W, 'val');

it('binds the native boundary matrix to its independently authored source', () => {
  expect(hash(readFileSync(root + 'control.docx'))).toBe(reference.sourceSha256);
});

// These checks validate native-result import/preservation independently of the
// editor mutations below. Native multi-paragraph results retain outer block
// boundaries even when replacement removes text on both sides of an edge.
for (const ref of reference.cases) it(`preserves the native reference ${ref.name} result`, async () => {
  const bytes = readFileSync(root + `boundary-matrix/${ref.name}.docx`);
  expect(hash(bytes)).toBe(ref.sha256);
  const p = await DocxPackage.open(bytes);
  expect(p.paragraphs.map(p => p.runs.map(r => r.text).join(''))).toEqual(ref.bodyParagraphs);
  const ranges = [...blockControlGroups(p.paragraphs), ...contentControlRanges(p.paragraphs)];
  const matching = ranges.filter(r => title(r.control) === ref.title);
  expect(matching).toHaveLength(1);
  const control = matching[0];
  expect(control.control.persistent).toBe(true);
  expect(control.paragraphs ? 'block' : 'inline').toBe(ref.kind);
  const text = control.paragraphs
    ? control.paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\r')
    : control.runs.map(r => r.text).join('');
  expect(text).toBe(ref.controlText || '');
  const saved = new Uint8Array(await p.export(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets).arrayBuffer());
  expect(unzipSync(saved)).toEqual(unzipSync(bytes));
}, 30000);

const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
for (const ref of reference.cases) it(`matches native ${ref.name}`, async () => {
  const p = await DocxPackage.open(readFileSync(root + 'control.docx')), d = model(p);
  const g = blockControlGroups(d.paragraphs).find(g => title(g.control) === ref.title);
  const [start,end] = {
    'join-start': [g.start-1,g.start], 'join-end': [g.end,g.end+1],
    'cross-start': [g.start-1,g.start+2], 'cross-end': [g.end-2,g.end+1],
    'split-cross-start': [g.start-1,g.start+2],
    'split-cross-end': [g.end-2,g.end+1], 'erase-cross-start': [g.start-1,g.end],
  }[ref.operation];
  expect(d.text.slice(start,end)).toBe(ref.selected.replaceAll('\r','\n'));
  d.select(start,end);
  const selection = { ...d.selection };
  if (ref.error) {
    const snapshot = d.snapshot();
    expect(() => d.replace(ref.replacement.replaceAll('\r','\n'))).toThrow('boundary');
    expect(d.snapshot()).toEqual(snapshot); expect(d.history).toHaveLength(0);
    return;
  }
  d.replace(ref.replacement.replaceAll('\r','\n'));
  const bytes = await save(p,d), reopened = model(await DocxPackage.open(bytes));
  for (const current of [d,reopened]) {
    expect(current.paragraphs.map(p => p.runs.map(r=>r.text).join(''))).toEqual(ref.bodyParagraphs);
    const ranges = [...blockControlGroups(current.paragraphs), ...contentControlRanges(current.paragraphs)];
    const matches = ranges.filter(g => title(g.control) === ref.title);
    expect(matches).toHaveLength(1);
    expect(matches[0].paragraphs ? 'block' : 'inline').toBe(ref.kind);
    expect(current.text.slice(matches[0].start,matches[0].end)).toBe((ref.controlText || '').replaceAll('\r','\n'));
  }
  for (const [name,data] of Object.entries(p.parts)) if (name !== 'word/document.xml') expect(unzipSync(bytes)[name]).toEqual(data);
  if (d.history.length) { d.undo(); expect(d.selection).toEqual(selection); expect(unzipSync(await save(p,d))).toEqual(p.parts); d.redo(); expect(d.text).toBe(reopened.text); }
  if (ref.kind === 'inline') {
    // Conversion must also enable the inline editing path in this live model,
    // even when the imported document had no inline controls at all.
    for (const current of [d,reopened]) {
      let r = contentControlRanges(current.paragraphs).find(g => title(g.control) === ref.title);
      current.select(r.start,r.end); current.replace('Entered');
      r = contentControlRanges(current.paragraphs).find(g => title(g.control) === ref.title);
      current.select(r.start,r.end); current.replace('');
      const prompt = contentControlRanges(current.paragraphs).find(g => title(g.control) === ref.title);
      expect(current.text.slice(prompt.start,prompt.end)).toBe('     ');
      expect(prompt.control.placeholder).toBe(true);
    }
    expect(model(await DocxPackage.open(await save(p,d))).text).toBe(d.text);
  }
}, 30000);

it('matches the native reference default-prompt restoration after reopening a converted placeholder', async () => {
  const bytes = readFileSync(root + 'boundary-matrix/converted-placeholder-restored.docx');
  expect(hash(bytes)).toBe(reference.restoredPlaceholderSha256);
  const p = await DocxPackage.open(bytes);
  const r = contentControlRanges(p.paragraphs).find(g => title(g.control) === 'placeholder');
  expect(r.runs.map(r => r.text).join('')).toBe('     ');
  expect(r.control.placeholder).toBe(true);
});

it('rejects a join that splits a grapheme without changing the caret or undo history', async () => {
  const p = await DocxPackage.open(readFileSync(root + 'control.docx')), d = model(p);
  const g = blockControlGroups(d.paragraphs).find(g => title(g.control) === 'replace');
  g.paragraphs[0].runs[0].text = '\u0301' + g.paragraphs[0].runs[0].text;
  d.select(g.start); const before = d.snapshot();
  expect(() => d.delete(-1)).toThrow('divide a persistent content control');
  expect(d.snapshot()).toEqual(before); expect(d.history).toHaveLength(0);
});
