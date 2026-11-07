import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strToU8 } from 'fflate';
import { parseXml } from '../src/engine/docx-xml.js';
import { readPageStories, pageStoryPath } from '../src/engine/page-stories.js';
import { DocxPackage } from '../src/engine/docx.js';

const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=mode=>unzipSync(readFileSync(`tests/fixtures/page-stories/footer-${mode}.docx`));
function setup(parts) {
  return { sections:[...parseXml(parts['word/document.xml']).getElementsByTagNameNS(W,'sectPr')], settings:parseXml(parts['word/settings.xml']).documentElement };
}
function read(parts) { const {sections,settings}=setup(parts);return readPageStories(parts,sections,settings); }

it.each([
  ['default',['default','default','default']],
  ['first-hidden',[null,'default','default']],
  ['variants',['first','even','default']],
])('selects the footer captured by the native reference for %s', (mode,expected)=>{
  const parts=source(mode),before=structuredClone(parts),definition=read(parts);
  expect([1,2,3].map(n=>pageStoryPath(definition,0,'footer',n,n===1))).toEqual(expected.map(v=>v?`word/footer-${v}.xml`:null));
  expect(parts).toEqual(before);
});
it('inherits each story independently and uses displayed page numbers for parity',()=>{
  const parts=source('variants'),{sections,settings}=setup(parts);
  const next=parseXml(`<w:sectPr xmlns:w="${W}"><w:titlePg/></w:sectPr>`).documentElement;
  const definition=readPageStories(parts,[...sections,next],settings);
  expect(pageStoryPath(definition,1,'footer',8,true)).toBe('word/footer-first.xml');
  expect(pageStoryPath(definition,1,'footer',8,false)).toBe('word/footer-even.xml');
  expect(pageStoryPath(definition,1,'footer',9,false)).toBe('word/footer-default.xml');
  expect(pageStoryPath(definition,1,'header',9,false)).toBeNull();
});
it('leaves missing even stories blank and ignores disabled first-page stories',()=>{
  const parts=source('first-hidden'),{sections}=setup(parts);
  sections[0].getElementsByTagNameNS(W,'titlePg')[0].setAttributeNS(W,'w:val','false');
  const settings=parseXml(`<w:settings xmlns:w="${W}"><w:evenAndOddHeaders/></w:settings>`).documentElement;
  const definition=readPageStories(parts,sections,settings);
  expect(pageStoryPath(definition,0,'footer',1,true)).toBe('word/footer-default.xml');
  expect(pageStoryPath(definition,0,'footer',2,false)).toBeNull();
});
it.each([
  ['external',p=>p['word/_rels/document.xml.rels']=strToU8(new TextDecoder().decode(p['word/_rels/document.xml.rels']).replace('Target="footer-default.xml"','TargetMode="External" Target="https://example.invalid/footer.xml"'))],
  ['missing part',p=>delete p['word/footer-default.xml']],
  ['wrong root',p=>p['word/footer-default.xml']=strToU8(`<w:hdr xmlns:w="${W}"/>`)],
  ['wrong type',p=>p['[Content_Types].xml']=strToU8(new TextDecoder().decode(p['[Content_Types].xml']).replace('wordprocessingml.footer+xml','wordprocessingml.header+xml'))],
])('rejects %s before attaching story content',(_,change)=>{
  const parts=source('default');change(parts);expect(()=>read(parts)).toThrow();
});
it('rejects duplicate variants and invalid boolean values',()=>{
  const parts=source('variants'),{sections,settings}=setup(parts),section=sections[0];
  section.appendChild(section.getElementsByTagNameNS(W,'footerReference')[0].cloneNode(true));
  expect(()=>readPageStories(parts,sections,settings)).toThrow(/duplicate/);
  section.removeChild(section.lastChild);section.getElementsByTagNameNS(W,'titlePg')[0].setAttributeNS(W,'w:val','yes');
  expect(()=>readPageStories(parts,sections,settings)).toThrow(/invalid titlePg/);
});
it('attaches supported retained stories while allowing body editing',async()=>{
  const pkg=await DocxPackage.open(readFileSync('tests/fixtures/page-stories/footer-variants.docx'),{bestEffort:true});
  expect(pkg.readOnly).not.toBe(true);
  expect(pageStoryPath(pkg.pageStories,0,'footer',2,false)).toBe('word/footer-even.xml');
  const paragraph=pkg.pageStories.stories['word/footer-even.xml'].paragraphs[0];
  expect(paragraph.runs.map(r=>r.text).join('')).toBe('Even \ufffc');
  expect(paragraph.runs[1]).toMatchObject({fontAscii:'Arial',fontSize:11,field:{type:'PAGE',cachedText:'99'}});
  expect(await pkg.export().arrayBuffer()).toBeInstanceOf(ArrayBuffer);
});
