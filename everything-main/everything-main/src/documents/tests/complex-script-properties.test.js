import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = () => readFileSync('tests/fixtures/complex-script-properties/control.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
const properties = doc => doc.paragraphs.map(p => p.runs.map(r => [r.boldCs, r.italicCs, r.fontSizeCs]));

it('resolves independent complex-script declarations without changing Latin formatting', async () => {
  const pkg = await DocxPackage.open(source()), doc = model(pkg);
  expect(properties(doc)).toEqual([[[false,false,14]], [[true,true,16]], [[false,true,16]], [[false,false,19.5]]]);
  for (const p of doc.paragraphs) for (const r of p.runs) expect(r).toMatchObject({ bold: false, italic: false, fontSize: 10 });
  expect(unzipSync(await save(pkg, doc))).toEqual(pkg.parts);
});

it('preserves dormant properties through run splitting, typing, style edits, reopening and exact undo', async () => {
  const pkg = await DocxPackage.open(source()), doc = model(pkg);
  const at = doc.text.indexOf('Direct'); doc.select(at + 2, at + 5); doc.setRunFormat({ bold: true });
  expect(doc.paragraphs[3].runs).toHaveLength(3);
  expect(properties(doc)[3]).toEqual(Array(3).fill([false,false,19.5]));
  doc.select(at + 3); doc.replace('X');
  doc.editParagraphStyle('Complex', { run: { fontSizeCs: 22, boldCs: null, italicCs: false } });
  doc.editCharacterStyle('Toggle', { run: { italicCs: null } });
  doc.select(0, 3); doc.setRunFormat({ boldCs: true, italicCs: true, fontSizeCs: 18.5 });
  const edited = await save(pkg, doc), reopened = model(await DocxPackage.open(edited));
  expect(properties(reopened)).toEqual(properties(doc));
  expect(reopened.text).toBe(doc.text);
  expect(reopened.styles.definitions.Complex.run.boldCs).toBeUndefined();
  expect(reopened.styles.definitions.Toggle.run.italicCs).toBeUndefined();
  for (const [name, bytes] of Object.entries(pkg.parts)) if (!['word/document.xml','word/styles.xml'].includes(name)) expect(unzipSync(edited)[name]).toEqual(bytes);
  while (doc.undo()) { /* return to original XML */ }
  expect(unzipSync(await save(pkg, doc))).toEqual(pkg.parts);
});

it('rejects invalid complex-script sizes before changing the document', async () => {
  const doc = model(await DocxPackage.open(source())); doc.select(0, 5);
  const initial = doc.snapshot();
  for (const value of [0, -1, 12.25, 1638.5, NaN, Infinity]) {
    expect(() => doc.setRunFormat({ fontSizeCs: value })).toThrow();
    expect(() => doc.editParagraphStyle('Complex', { run: { fontSizeCs: value } })).toThrow();
    expect(doc.snapshot()).toEqual(initial);
  }
});

it('opens active RTL after ordering and source editing support', async () => {
  expect((await DocxPackage.open(readFileSync('tests/fixtures/rtl-runs/control.docx'))).readOnly).not.toBe(true);
});
