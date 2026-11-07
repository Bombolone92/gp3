import { beforeAll, afterAll, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { CanvasEditor } from '../src/engine/canvas-editor.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
const root = 'tests/fixtures/nonempty-control-shift-selection/';
const refs = JSON.parse(readFileSync(root + 'reference.json'));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const state = d => ({ text: d.text, controls: contentControlRanges(d.paragraphs).map(r => ({ text: d.text.slice(r.start, r.end), placeholder: !!r.control.placeholder })) });
// Exercise the real keyboard dispatcher; geometry/painting are irrelevant to
// horizontal logical boundary stops and are checked in the browser suite.
const editor = d => ({ model: d, selectionLayout: {}, syncInput() {}, paint() {}, revealCaret() {}, onSelection() {} });
for (const ref of refs.cases) it(`matches the saved native reference nonempty boundary selection: ${ref.name}`, async () => {
  for (const kind of ['source', 'result']) expect(createHash('sha256').update(readFileSync(root + ref[kind])).digest('hex')).toBe(ref[kind + 'Sha256']);
  const pkg = await DocxPackage.open(readFileSync(root + ref.source)), d = model(pkg), native = model(await DocxPackage.open(readFileSync(root + ref.result)));
  const r = contentControlRanges(d.paragraphs)[0], at = ref.name.startsWith('right') ? r.end : r.start;
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

it('keeps inward, interior, outside and read-only extensions as text selections', async () => {
  for (const [at, side, key, readOnly, expected] of [
    [1, 'inside', 'ArrowRight', false, 2], [3, 'inside', 'ArrowLeft', false, 2],
    [2, 'inside', 'ArrowRight', false, 3], [1, 'before', 'ArrowLeft', false, 0],
    [3, 'after', 'ArrowRight', false, 4], [3, 'inside', 'ArrowRight', true, 4],
  ]) {
    const d = model(await DocxPackage.open(readFileSync(root + 'control.docx'))), id = contentControlRanges(d.paragraphs)[0].control.id;
    d.select(at, at, { id, side });
    CanvasEditor.prototype.move.call({ ...editor(d), readOnly }, key, true, false, false);
    expect(d.selection).toEqual({ anchor: at, focus: expected }); expect(d.history).toHaveLength(0);
  }
});
