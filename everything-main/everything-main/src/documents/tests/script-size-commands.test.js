import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';

const root = 'tests/fixtures/script-size-commands/';
const reference = JSON.parse(readFileSync(root + 'native-commands.json', 'utf8'));
let dom, source;
beforeAll(async () => {
  dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
  source = await DocxPackage.open(readFileSync(root + 'control.docx'), { bestEffort: true });
});
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });

it('binds native command observations to the source and reference output', () => {
  for (const [name, hash] of Object.entries(reference.hashes)) expect(createHash('sha256').update(readFileSync(root + name)).digest('hex')).toBe(hash);
});

it('matches native displayed sizes and size commands across both selection directions', () => {
  for (const record of reference.records) for (const backwards of [false, true]) {
    // Component command evidence; source editing is tested separately.
    const doc = new TextDocument([source.paragraphs[record.index]]);
    doc.select(...(backwards ? [doc.text.length, 0] : [0, doc.text.length]));
    const before = doc.snapshot(), raw = doc.runFormatting;
    expect(doc.runCommandFormatting.fontSize, `case ${record.index}`).toBe(record.before.controlText === '' ? null : Number(record.before.controlText));
    expect(doc.runFormatting).toEqual(raw);
    doc.setFontSize(18.5);
    expect(doc.runFormatting).toMatchObject({ fontSize: record.after.size, fontSizeCs: record.after.sizeCs });
    expect(doc.runCommandFormatting.fontSize).toBe(Number(record.after.controlText));
    doc.undo(); expect(doc.snapshot()).toEqual(before);
    doc.redo(); expect(doc.runCommandFormatting.fontSize).toBe(18.5);
  }
});

it('handles pending sizes and empty paragraph marks without mutating neighboring runs', () => {
  const p = paragraph('ab'); Object.assign(p.runs[0], { rtl: true, fontSize: 10, fontSizeCs: 16 });
  const doc = new TextDocument([p]); doc.select(1);
  expect(doc.runCommandFormatting.fontSize).toBe(16);
  doc.setFontSize(12.5); expect(doc.runCommandFormatting.fontSize).toBe(12.5);
  doc.replace('X');
  expect(doc.paragraphs[0].runs.map(r => [r.text,r.fontSize,r.fontSizeCs])).toEqual([['a',10,16],['X',12.5,12.5],['b',10,16]]);
  const empty = paragraph(''); empty.markFormat = { cs: true, fontSize: 10, fontSizeCs: 16 };
  const blank = new TextDocument([empty]); expect(blank.runCommandFormatting.fontSize).toBe(16);
  blank.setFontSize(20); expect(blank.paragraphs[0].markFormat).toMatchObject({ fontSize: 20, fontSizeCs: 20 });
});

it('round-trips inherited properties, preserves scalar edits and unrelated parts, and restores exact source on undo', async () => {
  const pkg = await DocxPackage.open(readFileSync('tests/fixtures/complex-script-properties/control.docx'));
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  doc.select(0, 7);
  // Ordinary size already equals 10: the different CS size must still change.
  expect(doc.setFontSize(10)).toBe(true);
  expect(doc.runFormatting).toMatchObject({ fontSize: 10, fontSizeCs: 10 });
  doc.setRunFormat({ fontSize: 13 }); expect(doc.runFormatting.fontSizeCs).toBe(10);
  doc.select(2); doc.setFontSize(18.5); doc.replace('X');
  const bytes = await save(), reopened = await DocxPackage.open(bytes);
  expect(reopened.paragraphs[0].runs.map(r => [r.text,r.fontSize,r.fontSizeCs])).toEqual(doc.paragraphs[0].runs.map(r => [r.text,r.fontSize,r.fontSizeCs]));
  for (const [name,data] of Object.entries(pkg.parts)) if (name !== 'word/document.xml') expect(unzipSync(bytes)[name]).toEqual(data);
  while (doc.undo()) { /* restore source */ }
  expect(unzipSync(await save())).toEqual(pkg.parts);
});

it('rejects invalid size commands atomically and keeps a true no-op out of history', () => {
  const doc = new TextDocument([paragraph('text')]); doc.select(0,4);
  const initial = doc.snapshot();
  for (const size of [0,-1,12.25,1638.5,NaN,Infinity]) {
    expect(() => doc.setFontSize(size)).toThrow(); expect(doc.snapshot()).toEqual(initial);
  }
  doc.setFontSize(12.5); const history = doc.history.length;
  expect(doc.setFontSize(12.5)).toBe(false); expect(doc.history).toHaveLength(history);
});
