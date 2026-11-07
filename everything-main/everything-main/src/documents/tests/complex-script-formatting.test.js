import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { paragraph, TextDocument } from '../src/engine/model.js';
import { RUN_FORMAT } from '../src/engine/formatting.js';
import { textFontStyle } from '../src/engine/font-families.js';
import { layoutDocument, font } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());

it.each(['cs','rtl'])('resolves %s display formatting without mutating ordinary declarations', flag => {
  const source = { ...RUN_FORMAT, [flag]: true, fontAscii:'Arial', fontCs:'Courier New', fontSize:10, fontSizeCs:16, boldCs:true, italicCs:true };
  const snapshot = structuredClone(source), display = textFontStyle('ABC', source);
  expect(display).toMatchObject({fontFamily:'Courier New',fontSize:16,bold:true,italic:flag==='cs'});
  expect(!!display.syntheticItalic).toBe(flag==='rtl');
  expect(font(display).startsWith(flag==='rtl' ? 'normal 700' : 'italic 700')).toBe(true);
  expect(source).toEqual(snapshot);
});

it('keeps inactive complex-script declarations out of Latin display formatting', () => {
  expect(textFontStyle('ABC',{...RUN_FORMAT,fontAscii:'Arial',fontCs:'Courier New',fontSize:10,fontSizeCs:16,boldCs:true,italicCs:true})).toMatchObject({fontFamily:'Arial',fontSize:10,bold:false,italic:false});
});

it('retains direction flags through layout and keeps upright/sheared fragments separate', () => {
  const p = paragraph('');
  const base = {...RUN_FORMAT, fontAscii:'Arial',fontCs:'Arial',fontSize:10,fontSizeCs:16,rtl:true};
  p.runs = [{...base,text:'ABC',italicCs:false},{...base,text:'DEF',italicCs:true}];
  const original = structuredClone(p);
  const result = layoutDocument([p], (t,s) => ({width:t.length*s.fontSize,ascent:s.fontSize,descent:4}), pageGeometry());
  expect(result.lines[0].fragments.map(f=>[f.text,f.fontSize,f.italic,!!f.syntheticItalic])).toEqual([['ABC',16,false,false],['DEF',16,false,true]]);
  expect(p).toEqual(original);
});

it('opens explicit off flags and preserves them through insertion/export and exact undo', async () => {
  const parts = unzipSync(readFileSync('tests/fixtures/complex-script-properties/control.docx'));
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replaceAll('</w:rPr>','<w:rtl w:val="0"/><w:cs w:val="0"/></w:rPr>'));
  const pkg = await DocxPackage.open(zipSync(parts)), doc = model(pkg);
  const at = doc.text.indexOf('Direct')+3; doc.select(at); doc.replace('Typed');
  const reopened = model(await DocxPackage.open(await save(pkg,doc)));
  expect(reopened.text).toBe(doc.text);
  expect(reopened.paragraphs[3].runs.every(r=>r.cs===false&&r.rtl===false)).toBe(true);
  doc.undo(); expect(unzipSync(await save(pkg,doc))).toEqual(parts);
});

it('opens imported script formatting while keeping unsupported explicit direction commands guarded', async () => {
  expect((await DocxPackage.open(readFileSync('tests/fixtures/complex-script-formatting/control.docx'))).readOnly).not.toBe(true);
  const doc = model(await DocxPackage.open(readFileSync('tests/fixtures/complex-script-properties/control.docx')));
  doc.select(0,3); const initial = doc.snapshot();
  for (const flag of ['cs','rtl']) {
    expect(()=>doc.setRunFormat({[flag]:true})).toThrow();
    expect(doc.snapshot()).toEqual(initial);
  }
});
