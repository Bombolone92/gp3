import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';

const root = 'tests/fixtures/script-format-commands/';
const reference = JSON.parse(readFileSync(root + 'native-commands.json', 'utf8'));
let dom, source;
beforeAll(async () => {
  dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
  source = await DocxPackage.open(readFileSync(root + 'control.docx'), { bestEffort: true });
});
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const native = value => value === 9999999 ? null : value === -1;

it('binds the native command observations to the original source and saved reference files', () => {
  for (const [name, hash] of Object.entries(reference.hashes)) expect(createHash('sha256').update(readFileSync(root + name)).digest('hex')).toBe(hash);
});

it.each(['Bold', 'Italic'])('matches native %s on ordinary, forced-script and mixed selections in either direction', command => {
  const key = command.toLowerCase(), cs = key + 'Cs';
  for (const record of reference.records.filter(r => r.command === command)) for (const backwards of [false, true]) {
    // Component test only: active-script imports remain read-only in the app.
    const doc = new TextDocument([source.paragraphs[record.index]]);
    doc.select(...(backwards ? [doc.text.length, 0] : [0, doc.text.length]));
    expect(doc.runFormatting[key]).toBe(native(record.before[key]));
    expect(doc.runFormatting[cs]).toBe(native(record.before[cs]));
    const before = doc.snapshot();
    doc['toggle' + command]();
    expect(doc.runFormatting[key], `${command} case ${record.index}`).toBe(native(record.after[key]));
    expect(doc.runFormatting[cs], `${command} CS case ${record.index}`).toBe(native(record.after[cs]));
    doc.undo(); expect(doc.snapshot()).toEqual(before);
    doc.redo(); expect(doc.runFormatting[cs]).toBe(native(record.after[cs]));
  }
});

it('round-trips selected and pending commands while preserving independent direct-property edits and undo', async () => {
  const pkg = await DocxPackage.open(readFileSync('tests/fixtures/complex-script-properties/control.docx'));
  const doc = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());
  doc.select(0, 7); doc.toggleBold(); doc.toggleItalic();
  expect(doc.runFormatting).toMatchObject({ bold: true, boldCs: true, italic: true, italicCs: true });
  doc.setRunFormat({ bold: false }); expect(doc.runFormatting.boldCs).toBe(true);
  doc.select(2); doc.toggleItalic(); doc.replace('X');
  const bytes = await save(), reopened = await DocxPackage.open(bytes);
  expect(reopened.paragraphs[0].runs.map(r => [r.text, r.bold, r.boldCs, r.italic, r.italicCs])).toEqual(doc.paragraphs[0].runs.map(r => [r.text, r.bold, r.boldCs, r.italic, r.italicCs]));
  for (const [name, data] of Object.entries(pkg.parts)) if (name !== 'word/document.xml') expect(unzipSync(bytes)[name]).toEqual(data);
  while (doc.undo()) { /* restore source */ }
  expect(unzipSync(await save())).toEqual(pkg.parts);
});
