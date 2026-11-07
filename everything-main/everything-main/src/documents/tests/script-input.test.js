import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DocxPackage, createDocx } from '../src/engine/docx.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { typedScriptRuns } from '../src/engine/script-input.js';

let dom; const groups = [];
beforeAll(async () => {
  dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
  for (const name of ['script-input','script-input-brackets','script-input-fonts']) {
    const root = `tests/fixtures/${name}/`, recording = JSON.parse(readFileSync(root+'native-recording.json','utf8'));
    for (const [file,hash] of Object.entries(recording.hashes)) expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
    groups.push({ name, cases:JSON.parse(readFileSync(root+'cases.json','utf8')),
      source:await DocxPackage.open(readFileSync(root+'control.docx'),{bestEffort:true}),
      native:await DocxPackage.open(readFileSync(root+'native.docx'),{bestEffort:true}) });
  }
},30000);
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const flags = p => p.runs.flatMap(r => Array(r.text.length).fill([!!r.cs,!!r.rtl]));

it('matches all native insertion flags, including bracketed numbers and font-independent script classification', () => {
  for (const group of groups) for (const [index,c] of group.cases.entries()) {
    const doc = new TextDocument([group.source.paragraphs[index]]);
    doc.select(1); const before = doc.snapshot(); doc.replace(c.text);
    expect(doc.text, `${group.name} ${index}`).toBe('A'+c.text+'B');
    expect(flags(doc.paragraphs[0]), `${group.name} ${index}`).toEqual(flags(group.native.paragraphs[index]));
    doc.undo(); expect(doc.snapshot()).toEqual(before);
    doc.redo(); expect(flags(doc.paragraphs[0])).toEqual(flags(group.native.paragraphs[index]));
  }
});

it('serializes split script overrides and reopens them without changing neighboring formatting', async () => {
  const p = paragraph('AB'); Object.assign(p.runs[0],{rtl:true,fontSize:10,fontSizeCs:16,boldCs:true});
  const doc = new TextDocument([p]); doc.select(1); doc.replace('Aא1');
  const pkg = createDocx(doc.paragraphs), bytes = new Uint8Array(await pkg.export().arrayBuffer());
  const reopened = await DocxPackage.open(bytes,{bestEffort:true});
  expect(reopened.readOnly).not.toBe(true);
  expect(flags(reopened.paragraphs[0])).toEqual(flags(doc.paragraphs[0]));
  expect(reopened.paragraphs[0].runs.map(r=>[r.text,r.fontSize,r.fontSizeCs,r.boldCs])).toEqual(doc.paragraphs[0].runs.map(r=>[r.text,r.fontSize,r.fontSizeCs,r.boldCs]));
});

it('preserves ordinary input, object metadata, and existing properties while adding only needed script overrides', () => {
  const ordinary = {bold:true,overrides:{bold:true},properties:'opaque'};
  expect(typedScriptRuns('אक🙂',ordinary)).toEqual([{...ordinary,text:'אक🙂'}]);
  const object = {...ordinary,rtl:true,image:{assetId:'image'}};
  expect(typedScriptRuns('\ufffc',object)).toEqual([{...object,text:'\ufffc'}]);
  const format = {...ordinary,rtl:true,fontSize:10,fontSizeCs:16};
  const before = structuredClone(format), runs = typedScriptRuns('Aא',format);
  expect(runs.map(r=>[r.text,r.cs,r.rtl])).toEqual([['A',false,false],['א',false,true]]);
  for (const run of runs) expect(run).toMatchObject({properties:'opaque',bold:true,fontSize:10,fontSizeCs:16,overrides:{bold:true}});
  expect(format).toEqual(before);
});

it('handles long and deeply nested input without splitting surrogate pairs or dropping text', () => {
  const text = '('.repeat(1000)+'1'+')'.repeat(1000)+'🙂𞤀';
  const runs = typedScriptRuns(text,{rtl:true});
  expect(runs.map(r=>r.text).join('')).toBe(text);
  for (const run of runs) expect(run.text.isWellFormed()).toBe(true);
});
