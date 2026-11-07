import { beforeAll, afterAll, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { CanvasEditor } from '../src/engine/canvas-editor.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
const root = 'tests/fixtures/adjacent-control-selection/';
const refs = JSON.parse(readFileSync(root + 'reference.json'));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const state = d => ({ text: d.text, controls: contentControlRanges(d.paragraphs).map(r => ({ text: d.text.slice(r.start, r.end), placeholder: !!r.control.placeholder })) });
// Exercise the real keyboard dispatcher; geometry/painting are irrelevant to
// horizontal logical boundary stops and are checked in the browser suite.
const editor = d => ({ model: d, selectionLayout: {}, syncInput() {}, paint() {}, revealCaret() {}, onSelection() {} });
const farRefs = JSON.parse(readFileSync(root + 'far-boundary-reference.json'));
for (const ref of farRefs.cases) it(`matches the saved native reference far-boundary replacement: ${ref.name}`, async () => {
  const pkg = await DocxPackage.open(readFileSync(root + 'control.docx')), d = model(pkg);
  for (const kind of ['source', 'result']) expect(createHash('sha256').update(readFileSync(root + ref[kind])).digest('hex')).toBe(ref[kind + 'Sha256']);
  const native = model(await DocxPackage.open(readFileSync(root + ref.result)));
  expect(state(native)).toEqual({text:ref.text,controls:ref.controls});
  const r = contentControlRanges(d.paragraphs)[ref.name === 'right' ? 0 : 1], at = ref.name === 'right' ? r.end : r.start;
  d.select(at, at, { id: r.control.id, side: 'inside' });
  const e = editor(d);
  for (const key of ref.keys.slice(0,-1)) CanvasEditor.prototype.move.call(e, key.slice('Shift+'.length), true, false, false);
  expect([d.selection.anchor,d.selection.focus]).toEqual(ref.selection);
  const selected = d.snapshot(); d.replace('x'); expect(state(d)).toEqual(state(native));
  const edited = new Uint8Array(await pkg.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  expect(state(model(await DocxPackage.open(edited)))).toEqual(state(native));
  d.undo(); expect(d.snapshot()).toEqual(selected);
  const output = new Uint8Array(await pkg.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
  expect(unzipSync(output)).toEqual(pkg.parts);
});
it('rejects a stale or displaced selection focus without changing the model', async () => {
  const pkg = await DocxPackage.open(readFileSync(root + 'control.docx')), d = model(pkg);
  const [first, second] = contentControlRanges(d.paragraphs), before = d.snapshot();
  for (const caret of [{id:'absent',side:'inside'},{id:second.control.id,side:'before'},{id:second.control.id,side:'invalid'}]) {
    expect(() => d.select(first.end, second.end, undefined, {id:first.control.id,direction:1,focusCaret:caret})).toThrow('Invalid inline content-control selection focus');
    expect(d.snapshot()).toEqual(before);
  }
});
for (const ref of refs.cases) it(`matches the saved native reference adjacent boundary selection: ${ref.name}`, async () => {
  for (const kind of ['source', 'result']) expect(createHash('sha256').update(readFileSync(root + ref[kind])).digest('hex')).toBe(ref[kind + 'Sha256']);
  const pkg = await DocxPackage.open(readFileSync(root + ref.source)), d = model(pkg), native = model(await DocxPackage.open(readFileSync(root + ref.result)));
  const r = contentControlRanges(d.paragraphs)[ref.name.startsWith('right') ? 0 : 1], at = ref.name.startsWith('right') ? r.end : r.start;
  d.select(at, at, { id: r.control.id, side: 'inside' });
  const e = editor(d);
  for (const key of ref.keys) {
    if (key === 'x') d.replace('x');
    else if (key === 'Control+z') d.undo();
    else CanvasEditor.prototype.move.call(e, key.slice('Shift+'.length), true, false, false);
  }
  expect(state(native)).toEqual({ text: ref.text, controls: ref.controls });
  expect(state(d)).toEqual(state(native));
  const save = async () => new Uint8Array(await pkg.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
  const output = await save(); expect(state(model(await DocxPackage.open(output)))).toEqual(state(native));
  const parts = unzipSync(readFileSync(root + ref.source)), edited = unzipSync(output);
  for (const [name, bytes] of Object.entries(parts)) if (name !== 'word/document.xml') expect(edited[name]).toEqual(bytes);
  d.undo(); expect(unzipSync(await save())).toEqual(parts);
  d.redo(); expect(unzipSync(await save())).toEqual(edited);
});
