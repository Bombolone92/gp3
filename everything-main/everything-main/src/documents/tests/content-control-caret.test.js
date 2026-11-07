import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage, W } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
import { pointerControlSelection } from '../src/engine/content-control-caret.js';

it('retains the SDT anchor while clearing ownership at an old pointer destination', () => {
  const selection = { anchor: 3, focus: 4, controlSelection: {
    id: 'owner', direction: 1, adjacent: 'neighbor', focusCaret: { id: 'neighbor', side: 'inside' }
  } };
  const original = structuredClone(selection);
  expect(pointerControlSelection(selection, 5)).toEqual({ id: 'owner', direction: 1 });
  expect(pointerControlSelection(selection, 4)).toEqual(selection.controlSelection);
  expect(pointerControlSelection(selection, 4)).not.toBe(selection.controlSelection);
  expect(pointerControlSelection({ anchor: 3, focus: 4 }, 5)).toBeUndefined();
  expect(selection).toEqual(original);
});

it('starts pointer ownership only from a collapsed inside control caret', () => {
  const inside = { anchor: 3, focus: 3, controlCaret: { id: 'owner', side: 'inside' } };
  expect(pointerControlSelection(inside, 4)).toEqual({ id: 'owner', direction: 1 });
  expect(pointerControlSelection(inside, 1)).toEqual({ id: 'owner', direction: -1 });
  expect(pointerControlSelection(inside, 3)).toBeUndefined();
  for (const side of ['before', 'after'])
    expect(pointerControlSelection({ ...inside, controlCaret: { id: 'owner', side } }, 4)).toBeUndefined();
  expect(pointerControlSelection({ ...inside, focus: 4 }, 5)).toBeUndefined();
  expect(inside).toEqual({ anchor: 3, focus: 3, controlCaret: { id: 'owner', side: 'inside' } });
});

const root = 'tests/fixtures/empty-inline-controls/';
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const title = c => new DOMParser().parseFromString(c.shell, 'application/xml').getElementsByTagNameNS(W, 'alias')[0].getAttributeNS(W, 'val');
const ranges = d => contentControlRanges(d.paragraphs);
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });

const native = JSON.parse(readFileSync(root + 'native/native-results.json', 'utf8').replace(/^\uFEFF/, ''));
it('binds the actual native reference keyboard result to its original source', () => {
  const reference = JSON.parse(readFileSync(root + 'navigation/reference.json', 'utf8'));
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  expect(hash(root + 'control.docx')).toBe(reference.sourceSha256);
  expect(hash(root + 'navigation/native-keyboard.docx')).toBe(reference.resultSha256);
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(unzipSync(readFileSync(root + 'navigation/native-keyboard.docx'))['word/document.xml']), 'application/xml');
  const controls = [...xml.getElementsByTagNameNS(W, 'sdt')].map(c => ({ title: c.getElementsByTagNameNS(W, 'alias')[0].getAttributeNS(W, 'val'),
    text: [...c.getElementsByTagNameNS(W, 'sdtContent')[0].getElementsByTagNameNS(W, 't')].map(t => t.textContent).join(''),
    placeholder: c.getElementsByTagNameNS(W, 'showingPlcHdr').length > 0 }));
  expect(controls).toEqual(reference.controls);
});
for (const side of ['inside', 'before', 'after']) it(`matches native insertion ${side} an empty control`, async () => {
  const p = await DocxPackage.open(readFileSync('tests/fixtures/persistent-block-controls/boundary-matrix/replace-erase-cross-start.docx'));
  const d = model(p), r = ranges(d).find(r => title(r.control) === 'replace');
  const ref = native.find(r => r.name === (side === 'inside' ? side : 'outside-' + side));
  d.select(r.start, r.start, { id: r.control.id, side });
  const selected = d.snapshot();
  d.replace('Typed');
  const bytes = await save(p, d), again = model(await DocxPackage.open(bytes));
  for (const current of [d, again]) {
    expect(current.text).toBe(ref.after.replace(/\r$/, '').replaceAll('\r', '\n'));
    const owner = ranges(current).find(r => title(r.control) === 'replace');
    expect(current.text.slice(owner.start, owner.end)).toBe(ref.text || '');
  }
  for (const [name, data] of Object.entries(p.parts)) if (name !== 'word/document.xml') expect(unzipSync(bytes)[name]).toEqual(data);
  d.undo(); expect(d.selection).toEqual(selected.selection);
  expect(unzipSync(await save(p, d))).toEqual(p.parts);
});

for (const name of ['start', 'middle', 'end', 'alone', 'left', 'right']) {
  for (const side of ['before', 'inside', 'after']) it(`retains ${name} ownership and neighboring wrappers when typing ${side}`, async () => {
    const p = await DocxPackage.open(readFileSync(root + 'control.docx')), d = model(p);
    const r = ranges(d).find(r => title(r.control) === name), at = r.start;
    d.select(at, at, { id: r.control.id, side });
    d.replace('X'); d.replace('Y');
    const bytes = await save(p, d), again = model(await DocxPackage.open(bytes));
    for (const current of [d, again]) {
      expect(ranges(current).map(r => title(r.control))).toEqual(['start', 'middle', 'end', 'alone', 'left', 'right']);
      for (const owner of ranges(current)) expect(current.text.slice(owner.start, owner.end)).toBe(side === 'inside' && title(owner.control) === name ? 'XY' : '');
      const owner = ranges(current).find(r => title(r.control) === name);
      expect(owner.start).toBe(at + (side === 'before' ? 2 : 0));
      if (name === 'right') expect(ranges(current).find(r => title(r.control) === 'left').start).toBe(at);
      if (name === 'left') expect(ranges(current).find(r => title(r.control) === 'right').start).toBe(at + 2);
    }
    d.undo(); d.undo(); expect(unzipSync(await save(p, d))).toEqual(p.parts);
  });
}

it('rejects stale owners, invalid sides and extended selections atomically', async () => {
  const p = await DocxPackage.open(readFileSync(root + 'control.docx')), d = model(p), id = ranges(d)[0].control.id;
  const before = d.snapshot();
  for (const [start, end, caret] of [[0, 0, { id: 'absent', side: 'inside' }], [0, 0, { id, side: 'invalid' }], [1, 1, { id, side: 'before' }], [0, 1, { id, side: 'inside' }]]) {
    expect(() => d.select(start, end, caret)).toThrow('Invalid inline content-control caret');
    expect(d.snapshot()).toEqual(before);
  }
});

for (const source of ['inside', 'clear-after-entry']) {
  for (const side of ['before', 'inside-start', 'inside-end', 'after']) it(`keeps ${source} text ownership at ${side}`, async () => {
    const p = await DocxPackage.open(readFileSync(root + `native/${source}.docx`)), d = model(p);
    const r = ranges(d).find(r => title(r.control) === 'replace'), original = d.text.slice(r.start, r.end);
    const at = side === 'after' || side === 'inside-end' ? r.end : r.start;
    d.select(at, at, { id: r.control.id, side: side.startsWith('inside') ? 'inside' : side });
    d.replace('X'); d.replace('Y');
    const again = model(await DocxPackage.open(await save(p, d)));
    const expected = !side.startsWith('inside') ? original : r.control.placeholder ? 'XY'
      : side === 'inside-start' ? 'XY' + original : original + 'XY';
    for (const current of [d, again]) {
      const owner = ranges(current).find(r => title(r.control) === 'replace');
      expect(current.text.slice(owner.start, owner.end)).toBe(expected);
      expect(owner.control.placeholder).toBe(!side.startsWith('inside') && r.control.placeholder);
    }
    d.undo(); d.undo(); expect(unzipSync(await save(p, d))).toEqual(p.parts);
  });
}
