import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument, boundaries } from '../src/engine/model.js';
import { contentControlRanges } from '../src/engine/content-controls.js';
import { moveInlineControlCaret } from '../src/engine/content-control-caret.js';

const root = 'tests/fixtures/inline-control-navigation/';
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
function move(d, direction) {
  const stops = boundaries(d.text), { focus, anchor } = d.selection;
  const target = anchor !== focus ? direction > 0 ? Math.max(anchor, focus) : Math.min(anchor, focus)
    : direction > 0 ? stops.find(p => p > focus) ?? d.text.length : [...stops].reverse().find(p => p < focus) ?? 0;
  const next = moveInlineControlCaret(d.paragraphs, d.selection, target, direction);
  if (next) d.select(next.anchor, next.focus, next.controlCaret); else d.select(target);
}
for (const ref of reference.cases) it(`matches native reference navigation ${ref.name}`, async () => {
  for (const [file, hash] of [[ref.source, ref.sourceSha256], [ref.result, ref.resultSha256]]) expect(createHash('sha256').update(readFileSync(root + file)).digest('hex')).toBe(hash);
  const p = await DocxPackage.open(readFileSync(root + ref.source)), d = model(p);
  const native = model(await DocxPackage.open(readFileSync(root + ref.result)));
  for (const key of ref.keys) {
    if (key === 'Control+Home') d.select(0);
    else if (key === 'Control+End') d.select(d.text.length);
    else move(d, key === 'ArrowRight' ? 1 : -1);
  }
  d.replace('X'); expect(d.text).toBe(native.text); expect(d.text).toBe(ref.text);
  const r = contentControlRanges(d.paragraphs)[0];
  expect(d.text.slice(r.start, r.end)).toBe(ref.controlText);
  expect(!!r.control.placeholder).toBe(ref.placeholder);
  d.undo(); expect(d.text).toBe('ABCD');
});

it('traverses the complete control in both directions without changing text', async () => {
  const d = model(await DocxPackage.open(readFileSync(root + 'inline.docx')));
  const forward = [];
  for (let i = 0; i < 6; i++) { move(d, 1); forward.push([d.selection.focus, d.selection.controlCaret?.side]); }
  expect(forward).toEqual([[1,'before'],[1,'inside'],[2,'inside'],[3,'inside'],[3,'after'],[4,undefined]]);
  const backward = [];
  for (let i = 0; i < 6; i++) { move(d, -1); backward.push([d.selection.focus, d.selection.controlCaret?.side]); }
  expect(backward).toEqual([[3,'after'],[3,'inside'],[2,'inside'],[1,'inside'],[1,'before'],[0,undefined]]);
  expect(d.text).toBe('ABCD'); expect(d.history).toHaveLength(0);
});

it('selects a placeholder on reverse entry and leaves it without replacing it', async () => {
  const d = model(await DocxPackage.open(readFileSync(root + 'placeholder.docx')));
  d.select(4); move(d,-1); move(d,-1);
  expect(d.selection).toEqual({anchor:3,focus:1});
  move(d,-1); expect(d.selection.controlCaret.side).toBe('before');
  d.replace('X'); expect(d.text).toBe('AXBCD');
  expect(contentControlRanges(d.paragraphs)[0].control.placeholder).toBe(true);
});

it('retains inside ownership after replacing a selected prompt', async () => {
  const d=model(await DocxPackage.open(readFileSync(root+'placeholder.docx')));
  move(d,1);move(d,1);d.replace('X');
  expect(d.selection.controlCaret.side).toBe('inside');
  move(d,1);d.replace('Y');expect(d.text).toBe('AXYD');
  const r=contentControlRanges(d.paragraphs)[0];expect(d.text.slice(r.start,r.end)).toBe('X');
  d.undo();d.undo();expect(d.text).toBe('ABCD');
});

it('keeps picture, plain-text, and temporary controls on their existing navigation path', () => {
  for (const properties of [{}, {persistent:true,plainText:true}, {persistent:true,picture:true}]) {
    expect(moveInlineControlCaret([{runs:[{text:'A'},{text:'BC',contentControl:{id:'c',...properties}},{text:'D'}]}],{anchor:0,focus:0},1,1)).toBeNull();
  }
});

it('keeps the current owner when approaching adjacent controls from an interior caret', () => {
  const paragraphs=[{runs:[{text:'AB',contentControl:{id:'left',persistent:true}},{text:'CD',contentControl:{id:'right',persistent:true}}]}];
  const end=moveInlineControlCaret(paragraphs,{anchor:1,focus:1},2,1);
  expect(end).toEqual({anchor:2,focus:2,controlCaret:{id:'left',side:'inside'}});
  const outside=moveInlineControlCaret(paragraphs,end,3,1);
  expect(outside.controlCaret).toEqual({id:'left',side:'after'});
  const next=moveInlineControlCaret(paragraphs,outside,3,1);
  expect(next).toEqual({anchor:2,focus:2,controlCaret:{id:'right',side:'inside'}});
  expect(moveInlineControlCaret(paragraphs,{anchor:3,focus:3},2,-1).controlCaret).toEqual({id:'right',side:'inside'});
});
